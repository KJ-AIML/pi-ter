// Own and forward the foreground command until its output pipes close.
// Windows detached commands that outlive their shell are not managed tasks.
import { spawn } from 'node:child_process';
const [executable, ...args] = process.argv.slice(2);
const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
process.stdin.pipe(child.stdin);
child.stdin.on('error', () => {});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('close', code => { process.stdin.destroy(); process.exitCode = code ?? 1; });
