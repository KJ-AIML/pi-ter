import { spawn } from 'node:child_process';

export type ClipboardCommand = { command: string; args: string[] };

/** System clipboard writers to try in order. Linux uses the CLIPBOARD selection (what Ctrl+V pastes), never PRIMARY. */
export function clipboardCommands(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): ClipboardCommand[] {
  if (platform === 'darwin') return [{ command: 'pbcopy', args: [] }];
  if (platform === 'win32') return [{ command: 'clip', args: [] }];
  const x11 = [{ command: 'xclip', args: ['-selection', 'clipboard'] }, { command: 'xsel', args: ['--clipboard', '--input'] }];
  const wayland = [{ command: 'wl-copy', args: [] }];
  return env.WAYLAND_DISPLAY ? [...wayland, ...x11] : [...x11, ...wayland];
}

/**
 * Copy text with the first available clipboard tool. Resolves to the tool name, or rejects with a
 * readable message. Missing binaries are reported asynchronously by spawn, so 'error' is always handled.
 */
export async function copyToClipboard(text: string, commands: ClipboardCommand[] = clipboardCommands(), timeoutMs = 3000): Promise<string> {
  const failures: string[] = [];
  for (const candidate of commands) {
    const outcome = await new Promise<'ok' | string>(resolve => {
      let settled = false;
      const done = (value: 'ok' | string) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      let child;
      try { child = spawn(candidate.command, candidate.args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }); }
      catch (error: any) { done(error.code === 'ENOENT' ? 'missing' : String(error.message)); return; }
      // X11/Wayland writers may stay alive to serve the selection; do not block on them.
      const timer = setTimeout(() => { child.unref(); done('ok'); }, timeoutMs);
      child.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'ENOENT' ? 'missing' : error.message));
      child.once('close', code => done(code === 0 ? 'ok' : `exit ${code}`));
      child.stdin?.on('error', () => {});
      child.stdin?.end(text);
    });
    if (outcome === 'ok') return candidate.command;
    failures.push(`${candidate.command}: ${outcome}`);
  }
  const names = commands.map(c => c.command).join(', ');
  throw new Error(failures.every(f => f.endsWith(': missing')) ? `No clipboard tool found (install one of: ${names})` : `Clipboard copy failed (${failures.join('; ')})`);
}
