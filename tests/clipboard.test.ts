import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipboardCommands, copyToClipboard } from '../extensions/tasks/clipboard.ts';

test('Linux copies to the CLIPBOARD selection and prefers wl-copy on Wayland', () => {
  assert.deepEqual(clipboardCommands('linux', {})[0], { command: 'xclip', args: ['-selection', 'clipboard'] });
  assert.equal(clipboardCommands('linux', { WAYLAND_DISPLAY: 'wayland-0' })[0].command, 'wl-copy');
  assert.ok(clipboardCommands('linux', {}).some(c => c.command === 'xsel' && c.args.includes('--clipboard')));
  assert.equal(clipboardCommands('darwin', {})[0].command, 'pbcopy');
});

test('missing clipboard tools are reported instead of crashing, and later tools are tried', async t => {
  await assert.rejects(copyToClipboard('x', [{ command: 'piter-no-clip-a', args: [] }, { command: 'piter-no-clip-b', args: [] }]), /No clipboard tool found/);
  const dir = mkdtempSync(join(tmpdir(), 'piter-clip-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'clip.txt');
  const writer = { command: process.execPath, args: ['-e', `process.stdin.pipe(require('fs').createWriteStream(${JSON.stringify(out)}))`] };
  assert.equal(await copyToClipboard('hello\nworld', [{ command: 'piter-no-clip', args: [] }, writer]), process.execPath);
  assert.equal(readFileSync(out, 'utf8'), 'hello\nworld');
  await assert.rejects(copyToClipboard('x', [{ command: process.execPath, args: ['-e', 'process.exit(3)'] }]), /exit 3/);
});
