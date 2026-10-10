import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomStatusBar, usageTotals } from '../extensions/status-bar.ts';

const msg = (role: string, usage: any) => ({ type: 'message', message: { role, usage } });

test('usage totals sum the branch and keep the newest assistant context size', () => {
  const t = usageTotals([msg('assistant', { input: 100, output: 10, cacheRead: 50, totalTokens: 160 }), { type: 'other' }, msg('user', { input: 5 }), msg('assistant', { input: 20, output: 5, cacheRead: 0, cacheWrite: 1 })]);
  assert.deepEqual(t, { input: 125, output: 15, cacheRead: 50, latestContext: 26 });
});

function harness(gitOk: boolean) {
  const calls: string[][] = []; let footer: any; let reads = 0;
  const entry = (n: number) => ({ type: 'message', get message() { reads++; return { role: 'assistant', usage: { input: n, output: 1, totalTokens: n + 1 } }; } });
  const branch: any[] = [entry(10), entry(20)];
  const pi: any = { exec: async (_c: string, args: string[]) => { calls.push(args); return gitOk ? { code: 0, stdout: args[0] === 'status' ? ' M a\n' : 'main\n' } : { code: 128, stdout: '' }; } };
  const ctx: any = { hasUI: true, mode: 'tui', cwd: '/x/proj', model: { id: 'm', contextWindow: 1000 }, sessionManager: { getBranch: () => branch.slice() }, ui: { setFooter: (f: any) => { footer = f({ requestRender() {} }, {}, { onBranchChange: () => () => {}, getGitBranch: () => 'no-git' }); } } };
  const bar = new CustomStatusBar(pi); bar.attach(ctx);
  return { bar, calls, branch, entry, render: () => footer.render(200).join(''), reads: () => reads };
}

test('outside a git repo the status bar never probes another hard-coded repo', async () => {
  const h = harness(false); await h.bar.refreshGitStatus();
  assert.ok(h.calls.length > 0); assert.ok(h.calls.every(a => !a.includes('-C')), JSON.stringify(h.calls));
  assert.match(h.render(), /no-git/);
});

test('usage is re-summed only when the session branch changes', () => {
  const h = harness(true);
  h.render(); const first = h.reads(); assert.ok(first > 0);
  for (let i = 0; i < 20; i++) h.render();
  assert.equal(h.reads(), first, 'spinner redraws do not rescan the session');
  h.branch.push(h.entry(30)); assert.match(h.render(), /total 63/); assert.ok(h.reads() > first);
});
