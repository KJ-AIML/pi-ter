/**
 * Sleep Prevention Utility ("ON FIRE" mode)
 *
 * Keeps the computer and display awake while active:
 * - Windows: Uses kernel32.dll SetThreadExecutionState (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
 * - macOS: Uses caffeinate
 * - Linux: Uses systemd-inhibit
 *
 * Every helper watches Pi's PID and exits on its own if Pi is killed, so a crash cannot leave the machine awake.
 */

import { spawn, type ChildProcess } from "node:child_process";

/** Platform command that keeps the machine awake until `pid` exits (or the helper is killed). */
export function awakeCommand(platform: NodeJS.Platform, pid: number): { command: string; args: string[] } {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid parent pid: ${pid}`);
  if (platform === "win32") {
    // SetThreadExecutionState(0x80000003) = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED.
    // The state is released when this PowerShell process exits.
    const script = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class Awake {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint f);
  public static uint KeepAwake() { return SetThreadExecutionState(0x80000003); }
}
';
[Awake]::KeepAwake() | Out-Null;
while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }
`;
    return { command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
  }
  if (platform === "darwin") return { command: "caffeinate", args: ["-d", "-i", "-m", "-w", String(pid)] };
  return {
    command: "systemd-inhibit",
    args: ["--what=idle:sleep", "--who=pi", "--why=pi-on-fire", "sh", "-c", `while kill -0 ${pid} 2>/dev/null; do sleep 5; done`],
  };
}

export class AwakeController {
  private process: ChildProcess | null = null;
  private onFire = false;
  private autoAwakeOnRun = true;
  private isBusy = false;
  /** Set once the helper binary is missing, so we do not retry (and fail) on every turn. */
  private unavailable = false;
  private spawner: typeof spawn;
  private platform: NodeJS.Platform;

  constructor(options: { spawner?: typeof spawn; platform?: NodeJS.Platform; registerExit?: boolean } = {}) {
    this.spawner = options.spawner ?? spawn;
    this.platform = options.platform ?? process.platform;
    if (options.registerExit === false) return;
    // Ensure cleanup on Node exit
    process.on("exit", () => {
      this.killAwakeProcess();
    });
  }

  public setOnFire(enable: boolean): boolean {
    this.onFire = enable;
    this.syncState();
    return this.onFire;
  }

  public toggleOnFire(): boolean {
    return this.setOnFire(!this.onFire);
  }

  public isOnFire(): boolean {
    return this.onFire;
  }

  public setBusy(busy: boolean): void {
    this.isBusy = busy;
    this.syncState();
  }

  public setAutoAwakeOnRun(enable: boolean): void {
    this.autoAwakeOnRun = enable;
    this.syncState();
  }

  private shouldKeepAwake(): boolean {
    // Keep awake if ON FIRE is explicitly active OR if Pi is busy with autoAwakeOnRun
    return this.onFire || (this.autoAwakeOnRun && this.isBusy);
  }

  /** True when a keep-awake helper process is currently owned. */
  public isHolding(): boolean {
    return this.process !== null;
  }

  public isUnavailable(): boolean {
    return this.unavailable;
  }

  private syncState(): void {
    const needAwake = this.shouldKeepAwake();
    if (needAwake && !this.process && !this.unavailable) {
      this.startAwakeProcess();
    } else if (!needAwake && this.process) {
      this.killAwakeProcess();
    }
  }

  private startAwakeProcess(): void {
    let child: ChildProcess;
    try {
      const { command, args } = awakeCommand(this.platform, process.pid);
      child = this.spawner(command, args, { windowsHide: true, stdio: "ignore" });
    } catch {
      this.process = null;
      return;
    }
    this.process = child;
    // A missing binary is reported asynchronously; without a listener Node crashes Pi.
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") this.unavailable = true;
      if (this.process === child) this.process = null;
    });
    // If the helper dies on its own, forget it so the next sync can start a new one.
    child.once("exit", () => {
      if (this.process === child) this.process = null;
    });
    child.unref();
  }

  private killAwakeProcess(): void {
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // ignore
      }
      this.process = null;
    }
  }

  public dispose(): void {
    this.killAwakeProcess();
  }
}

export const awakeController = new AwakeController();
