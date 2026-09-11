/**
 * Sleep Prevention Utility ("ON FIRE" mode)
 *
 * Keeps the computer and display awake while active:
 * - Windows: Uses kernel32.dll SetThreadExecutionState (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
 * - macOS: Uses caffeinate
 * - Linux: Uses systemd-inhibit
 */

import { spawn, type ChildProcess } from "node:child_process";

class AwakeController {
  private process: ChildProcess | null = null;
  private onFire = false;
  private autoAwakeOnRun = true;
  private isBusy = false;

  constructor() {
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

  private syncState(): void {
    const needAwake = this.shouldKeepAwake();
    if (needAwake && !this.process) {
      this.startAwakeProcess();
    } else if (!needAwake && this.process) {
      this.killAwakeProcess();
    }
  }

  private startAwakeProcess(): void {
    try {
      if (process.platform === "win32") {
        // PowerShell script calling SetThreadExecutionState(0x80000003)
        // 0x80000000 (ES_CONTINUOUS) | 0x00000001 (ES_SYSTEM_REQUIRED) | 0x00000002 (ES_DISPLAY_REQUIRED)
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
while ($true) { Start-Sleep -Seconds 60 }
`;
        this.process = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
          windowsHide: true,
          stdio: "ignore",
        });
        this.process.unref();
      } else if (process.platform === "darwin") {
        this.process = spawn("caffeinate", ["-d", "-i", "-m"], {
          stdio: "ignore",
        });
        this.process.unref();
      } else {
        // Linux fallback
        this.process = spawn(
          "systemd-inhibit",
          ["--what=idle:sleep", "--who=pi", "--why=pi-on-fire", "sleep", "infinity"],
          { stdio: "ignore" },
        );
        this.process.unref();
      }
    } catch {
      this.process = null;
    }
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
