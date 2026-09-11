import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { workspaceLines, emptyResources, plain } from '../extensions/workspace-view.ts';
import { StartupResources } from '../extensions/startup-resources.ts';
import { splashFrame, HelloPiSplash } from '../extensions/hello-pi/splash.ts';

test('welcome fits narrow, short, wide and resized terminals', () => {
  const resources = { Skills: ['design', 'review', 'test', 'extra'], Extensions: ['heli-harness'], Prompts: ['/help'], Context: ['AGENTS.md'] };
  for (const [w, h] of [[40, 12], [80, 24], [120, 32], [180, 50]]) {
    const frame = workspaceLines(w, h, '/project/Piter', resources, '#c995f5', '0.85.1');
    assert.ok(frame.length <= h);
    assert.ok(frame.every(s => visibleWidth(s) === w));
    assert.ok(frame.join('').includes('4 skills'));
  }
  const frame = workspaceLines(120, 32, '/project/Piter', resources, '#c995f5', '0.85.1');
  assert.match(plain(frame.join('\n')), /WORKSPACE \/ PITER/);
  assert.match(plain(frame.join('\n')), /Heli-Harness active/);
  assert.doesNotMatch(workspaceLines(120, 32, '/p', emptyResources(), '#c995f5', '0.85.1').join(''), /Heli-Harness active/);
});

const container = (children: any[] = []): any => ({ children, render(w: number) { return this.children.flatMap((c: any) => c.render(w)); } });
const text = (s: string): any => ({ render: () => [s] });
const section = (s: string): any => ({ ...text(s), getCollapsedText: () => s });
test('resource adapter replaces inventory but preserves diagnostics and restores original rendering', () => {
  const header = text('HEADER');
  const resources = container([section('[Skills]\n  a, b'), text(''), text('[Skill conflicts] Important warning')]);
  const original = resources.render;
  const doc = container([container([header]), resources, container()]);
  const root = container([doc, text('EDITOR'), text('STATUS')]);
  const adapter = new StartupResources(root, header, '0.85.1');
  assert.equal(adapter.connect(), true);
  assert.deepEqual(adapter.snapshot().Skills, ['a', 'b']);
  assert.deepEqual(resources.render(120), ['[Skill conflicts] Important warning']);
  resources.children.push(section('[Extensions]\n  real-extension'));
  assert.deepEqual(adapter.snapshot().Extensions, ['real-extension']);
  assert.deepEqual(adapter.chrome(120), ['EDITOR', 'STATUS']);
  adapter.dispose();
  assert.equal(resources.render, original);
  const unsupported = new StartupResources(root, header, '0.86.0');
  assert.equal(unsupported.connect(), false);
  assert.equal(resources.render, original);
});

test('splash covers every cell, resolves Hello PI and reveals destination', () => {
  for (const [w, h] of [[80, 24], [120, 32]]) {
    const frame = splashFrame(4.8, w, h);
    assert.equal(frame.length, h);
    assert.ok(frame.every(s => s.startsWith('\x1b[40m') && visibleWidth(s) === w));
    assert.match(plain(frame.join('\n')), /Hello PI/);
    const base = Array.from({ length: h }, (_, i) => `workspace row ${i}`);
    const final = splashFrame(6, w, h, base);
    assert.ok(final.every((s, i) => plain(s).trim() === base[i]));
  }
});

test('splash typing skips without losing text and cleanup closes overlay', () => {
  let component: any;
  let hidden = 0;
  let typed = '';
  const tui: any = { terminal: { rows: 24 }, requestRender() {}, showOverlay(c: any) { component = c; return { hide() { hidden++; } }; } };
  const splash = new HelloPiSplash(tui, () => [], s => { typed += s; });
  const oldTerm = process.env.TERM;
  const oldNoColor = process.env.NO_COLOR;
  process.env.TERM = 'xterm-256color';
  delete process.env.NO_COLOR;
  splash.start();
  if (oldTerm === undefined) delete process.env.TERM; else process.env.TERM = oldTerm;
  if (oldNoColor !== undefined) process.env.NO_COLOR = oldNoColor;
  component.handleInput('h');
  assert.equal(typed, 'h');
  assert.equal(hidden, 1);
  splash.dispose();
  assert.equal(hidden, 1);
});

test('rendered splash paints every terminal cell black, including ANSI reset padding', async () => {
  const { default: headless } = await import('@xterm/headless');
  const terminal = new headless.Terminal({ cols: 120, rows: 32, allowProposedApi: true });
  await new Promise<void>(resolve => terminal.write('\x1b[H' + splashFrame(4.8, 120, 32).join('\r\n'), resolve));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 120; x++) {
    const cell = terminal.buffer.active.getLine(y)!.getCell(x)!;
    assert.ok(cell.isBgPalette() && cell.getBgColor() === 0, `background at ${x},${y}`);
  }
  terminal.dispose();
});

test('non-TUI sessions install no header or splash', async () => {
  const { CleanHeader } = await import('../extensions/clean-header.ts');
  const header = new CleanHeader({ getCommands: () => [] } as any);
  for (const mode of ['rpc', 'json', 'print']) {
    header.attach({ hasUI: true, mode, ui: { setHeader() { assert.fail('must not attach'); } } } as any);
    header.startSplash();
  }
  header.dispose();
});
