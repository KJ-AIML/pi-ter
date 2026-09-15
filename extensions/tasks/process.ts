import { spawn, type ChildProcess } from 'node:child_process';

export type ShellKind = 'auto' | 'powershell' | 'cmd' | 'bash' | 'sh';
export function terminalLaunch(command: string, shell: ShellKind = 'auto', platform = process.platform): { executable: string; args: string[] } {
  const selected = shell === 'auto' ? (platform === 'win32' ? 'powershell' : 'sh') : shell;
  if (selected === 'powershell') return { executable: platform === 'win32' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo','-NoProfile','-NonInteractive','-Command',command] };
  if (selected === 'cmd') return { executable: 'cmd.exe', args: ['/d','/s','/c',command] };
  return { executable: selected === 'bash' ? 'bash' : platform === 'win32' ? 'sh' : '/bin/sh', args: ['-c',command] };
}

/** Stop the captured process tree, never an arbitrary user-supplied PID. */
export async function signalTree(child: ChildProcess, force = false): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    // Windows has no portable SIGTERM tree semantics. taskkill /T /F is explicit.
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve,reject) => {
      const killer = spawn('taskkill.exe', ['/PID',String(pid),'/T','/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error',reject);
      killer.once('close',code => code === 0 || child.exitCode !== null || child.signalCode !== null ? resolve() : reject(new Error(`taskkill failed (${code})`)));
    });
  } else {
    try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM'); }
    catch (error: any) { if (error.code !== 'ESRCH') throw error; }
  }
}
