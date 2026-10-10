import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { AwakeController, awakeCommand } from '../extensions/awake.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) assert.fail('condition timed out'); await sleep(25); } }

test('missing keep-awake binary does not crash Pi and is not retried every turn', async () => {
  let spawns = 0;
  const spawner = ((_cmd: string, args: string[], options: any) => { spawns++; return spawn('piter-no-such-awake-binary', args, options); }) as typeof spawn;
  const c = new AwakeController({ spawner, registerExit: false });
  c.setBusy(true);
  await until(() => c.isUnavailable());
  assert.equal(c.isHolding(), false);
  c.setBusy(false); c.setBusy(true); c.setOnFire(true);
  assert.equal(spawns, 1, 'no respawn after ENOENT');
  c.dispose();
});

test('a helper that exits on its own is forgotten and restarted on the next busy turn', async () => {
  let spawns = 0;
  const spawner = ((_cmd: string, _args: string[], options: any) => { spawns++; return spawn(process.execPath, ['-e', ''], options); }) as typeof spawn;
  const c = new AwakeController({ spawner, registerExit: false });
  c.setBusy(true); assert.equal(c.isHolding(), true);
  await until(() => !c.isHolding());
  c.setBusy(false); c.setBusy(true);
  assert.equal(spawns, 2); c.dispose();
});

test('helpers watch the parent pid on every platform', () => {
  assert.deepEqual(awakeCommand('darwin', 42), { command: 'caffeinate', args: ['-d', '-i', '-m', '-w', '42'] });
  const linux = awakeCommand('linux', 42);
  assert.equal(linux.command, 'systemd-inhibit'); assert.match(linux.args.at(-1)!, /kill -0 42/); assert.ok(!linux.args.includes('infinity'));
  assert.match(awakeCommand('win32', 42).args.at(-1)!, /Get-Process -Id 42/);
  assert.throws(() => awakeCommand('darwin', 0), /pid/);
});

test('helper exits by itself when the watched process dies', { skip: process.platform === 'win32' ? 'PowerShell watcher not exercised in CI' : false, timeout: 20000 }, async () => {
  const parent = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const { command, args } = awakeCommand(process.platform, parent.pid!);
  // On Linux run only the watcher; systemd-inhibit needs logind, which CI containers lack.
  const helper = process.platform === 'darwin' ? spawn(command, args, { stdio: 'ignore' }) : spawn(args.at(-3)!, args.slice(-2), { stdio: 'ignore' });
  let exited = false; helper.once('exit', () => { exited = true; });
  await sleep(300); assert.equal(exited, false, 'helper stays while parent lives');
  parent.kill('SIGKILL');
  try { await until(() => exited, 15000); } finally { if (!exited) helper.kill('SIGKILL'); }
});
