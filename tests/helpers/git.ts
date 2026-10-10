import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Temporary git repo with one commit (src/a.txt), removed after the test. */
export function tempRepo(t: any): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'piter-wt-'))); t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  git('init', '-q'); mkdirSync(join(repo, 'src')); writeFileSync(join(repo, 'src', 'a.txt'), 'a\n'); git('add', '-A'); git('commit', '-qm', 'init');
  return repo;
}
