import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** A private git worktree for one writer subagent, on its own branch off the source HEAD. */
export interface AgentWorktree { repo: string; path: string; branch: string; base: string; cwd: string }

const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim();

/**
 * Create `<git-common-dir>/piter-worktrees/<id>` on branch `piter/<id>` from HEAD. Living inside the
 * git directory keeps it out of the user's working tree, status and editor search.
 * The child's cwd keeps the same sub-folder it would have had in the source checkout.
 */
export function createWorktree(cwd: string, id: string): AgentWorktree {
  if (!/^[A-Za-z0-9-]{4,64}$/.test(id)) throw new Error(`Invalid worktree id: ${id}`);
  let repo: string;
  try { repo = git(cwd, ['rev-parse', '--show-toplevel']); }
  catch { throw new Error(`worktree needs a git repository; ${cwd} is not inside one`); }
  let base: string;
  try { base = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']); }
  catch { throw new Error('worktree needs at least one commit in the repository'); }
  const common = resolve(repo, git(repo, ['rev-parse', '--git-common-dir']));
  const root = join(common, 'piter-worktrees'); mkdirSync(root, { recursive: true });
  const path = join(root, id); const branch = `piter/${id}`;
  try { git(repo, ['worktree', 'add', '-q', '-b', branch, path, base]); }
  catch (error: any) { throw new Error(`git worktree add failed: ${String(error.stderr || error.message).trim()}`); }
  const sub = relative(repo, resolve(cwd));
  const inside = sub && !sub.startsWith('..') && !isAbsolute(sub) ? join(path, sub) : path;
  return { repo, path, branch, base, cwd: existsSync(inside) ? inside : path };
}

/** True when the source checkout has uncommitted changes the worktree will not see. */
export function sourceDirty(repo: string): boolean {
  try { return git(repo, ['status', '--porcelain', '--untracked-files=no']).length > 0; } catch { return false; }
}

/**
 * Summarise what the agent changed. A worktree with no commits and no changes is removed together
 * with its branch; anything else is kept for the user to review and merge.
 */
export function finishWorktree(w: AgentWorktree): { text: string; removed: boolean } {
  try {
    const commits = git(w.path, ['log', '--oneline', `${w.base}..HEAD`]);
    const status = git(w.path, ['status', '--porcelain']);
    if (!commits && !status) {
      git(w.repo, ['worktree', 'remove', '--force', w.path]);
      git(w.repo, ['branch', '-D', w.branch]);
      return { text: `Worktree: no changes; removed ${w.branch}.`, removed: true };
    }
    const stat = git(w.path, ['diff', '--stat', w.base]);
    const untracked = status.split('\n').filter(l => l.startsWith('??')).map(l => l.slice(3));
    const lines = [`Worktree: branch ${w.branch} at ${w.path}`];
    if (commits) lines.push(`Commits:\n${commits.split('\n').slice(0, 20).join('\n')}`);
    if (status) lines.push(`Uncommitted changes: ${status.split('\n').length} file(s)`);
    if (stat) lines.push(`Diff vs base:\n${stat.split('\n').slice(-25).join('\n')}`);
    if (untracked.length) lines.push(`Untracked: ${untracked.slice(0, 20).join(', ')}`);
    lines.push(`Review: git -C "${w.path}" diff ${w.base.slice(0, 12)}`);
    lines.push(`Merge (after committing in the worktree): git merge ${w.branch}`);
    lines.push(`Discard: git worktree remove --force "${w.path}" && git branch -D ${w.branch}`);
    return { text: lines.join('\n'), removed: false };
  } catch (error: any) {
    return { text: `Worktree ${w.branch} at ${w.path}: could not summarise changes (${String(error.stderr || error.message).trim()})`, removed: false };
  }
}
