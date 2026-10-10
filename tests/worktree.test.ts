import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktree, finishWorktree, sourceDirty } from '../extensions/tasks/worktree.ts';
import { tempRepo } from './helpers/git.ts';

const branches = (repo: string) => execFileSync('git', ['-C', repo, 'branch', '--list', 'piter/*'], { encoding: 'utf8' }).trim();

test('creates an isolated worktree on its own branch, keeping the sub-folder', t => {
  const repo = tempRepo(t);
  const w = createWorktree(join(repo, 'src'), 'abcd1234');
  assert.equal(w.branch, 'piter/abcd1234'); assert.match(w.path, /\.git[\\/]piter-worktrees[\\/]abcd1234$/);
  assert.equal(w.cwd, join(w.path, 'src')); assert.ok(existsSync(join(w.cwd, 'a.txt')));
  assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'source checkout stays clean');
  assert.deepEqual(finishWorktree(w), { text: 'Worktree: no changes; removed piter/abcd1234.', removed: true });
  assert.ok(!existsSync(w.path)); assert.equal(branches(repo), '');
});

test('changed worktrees are kept and reported with commits, diff and untracked files', t => {
  const repo = tempRepo(t); const w = createWorktree(repo, 'efgh5678');
  writeFileSync(join(w.path, 'src', 'a.txt'), 'a\nchanged\n'); writeFileSync(join(w.path, 'new.txt'), 'n');
  execFileSync('git', ['-C', w.path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'agent change']);
  writeFileSync(join(w.path, 'src', 'a.txt'), 'a\nchanged\nagain\n');
  const r = finishWorktree(w);
  assert.equal(r.removed, false); assert.ok(existsSync(w.path));
  assert.match(r.text, /branch piter\/efgh5678/); assert.match(r.text, /agent change/); assert.match(r.text, /Uncommitted changes: 2 file/);
  assert.match(r.text, /src\/a\.txt/); assert.match(r.text, /Untracked: new\.txt/); assert.match(r.text, /git merge piter\/efgh5678/);
});

test('clear errors outside git, for bad ids, and dirty source detection', t => {
  const plain = mkdtempSync(join(tmpdir(), 'piter-nogit-')); t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.throws(() => createWorktree(plain, 'abcd1234'), /needs a git repository/);
  const repo = tempRepo(t); assert.throws(() => createWorktree(repo, '../x'), /Invalid worktree id/);
  assert.equal(sourceDirty(repo), false); writeFileSync(join(repo, 'src', 'a.txt'), 'dirty'); assert.equal(sourceDirty(repo), true);
});
