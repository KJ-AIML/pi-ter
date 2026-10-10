import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { TasksView } from '../extensions/tasks/view.ts';
import type { TaskRecord, TaskSource } from '../extensions/tasks/types.ts';

const clean = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
const task = (id: string, kind: 'terminal' | 'agent', title: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({
  id, kind, title, cwd: `/work/${id}`, command: `run ${id}`, status: 'running', startedAt: Date.now() - 65_000,
  latest: `latest ${id}`, logPath: `/tmp/${id}.log`, logs: [], dropped: 0, diskTruncated: false, ...extra,
});

class Source implements TaskSource {
  listeners = new Set<() => void>();
  stopped: string[] = [];
  tasks: TaskRecord[];
  constructor(tasks: TaskRecord[]) { this.tasks = tasks; }
  list() { return this.tasks; }
  get(id: string) { return this.tasks.find(t => t.id === id); }
  async stop(id: string) { this.stopped.push(id); return this.get(id)!; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }
}

class RejectingSource extends Source {
  override async stop(id: string): Promise<TaskRecord> { this.stopped.push(id); throw new Error('permission denied'); }
}

test('navigates and filters task kinds, opens the selected task, and escapes in stages', () => {
  const source = new Source([task('term-1', 'terminal', 'Build'), task('agent-1', 'agent', 'Research')]);
  let closed = 0;
  const view = new TasksView(source, () => {}, () => closed++, () => 12);
  assert.match(clean(view.render(60)), /Build[\s\S]*Research/);
  view.handleInput('\t');
  assert.match(clean(view.render(60)), /TERMINAL[\s\S]*Build/);
  assert.doesNotMatch(clean(view.render(60)), /Research/);
  view.handleInput('\t');
  assert.match(clean(view.render(60)), /AGENT[\s\S]*Research/);
  view.handleInput('\r');
  assert.match(clean(view.render(60)), /Research[\s\S]*agent-1[\s\S]*\/work\/agent-1/);
  view.handleInput('\x1b');
  assert.match(clean(view.render(60)), /TASKS/);
  view.handleInput('\x1b');
  assert.equal(closed, 1);
  view.dispose();
});

test('searches sanitized log text and supports stream cycling and wrapping', () => {
  const source = new Source([task('a', 'agent', 'Agent', { logs: [
    { seq: 1, time: Date.now(), stream: 'stdout', text: 'alpha\x1b[31m RED\x07' },
    { seq: 2, time: Date.now(), stream: 'stderr', text: 'beta failure' },
  ] })]);
  const view = new TasksView(source, () => {}, () => {}, () => 10, 'a');
  view.handleInput('/'); view.handleInput('bEtA'); view.handleInput('\r');
  const searched = clean(view.render(32));
  assert.match(searched, /beta failure/i);
  assert.doesNotMatch(searched, /alpha|\x07|\x1b/);
  view.handleInput('f');
  assert.doesNotMatch(clean(view.render(32)), /beta failure/i);
  view.handleInput('f');
  assert.match(clean(view.render(32)), /beta failure/i);
  view.handleInput('w');
  assert.match(clean(view.render(32)), /wrap:on/);
  view.dispose();
});

test('scrolling leaves tail and End resumes it when new logs arrive', () => {
  const logs = Array.from({ length: 20 }, (_, i) => ({ seq: i, time: Date.now(), stream: 'stdout' as const, text: `line-${i}\n` }));
  const source = new Source([task('t', 'terminal', 'Tail', { logs })]);
  let renders = 0;
  const view = new TasksView(source, () => renders++, () => {}, () => 9, 't');
  view.handleInput('\x1b[5~');
  assert.match(clean(view.render(50)), /line-1[0-8]/);
  source.tasks[0].logs.push({ seq: 20, time: Date.now(), stream: 'stdout', text: 'NEW-LINE\n' }); source.emit();
  assert.doesNotMatch(clean(view.render(50)), /NEW-LINE/);
  view.handleInput('\x1b[F');
  assert.match(clean(view.render(50)), /NEW-LINE/);
  assert.ok(renders >= 3);
  view.dispose();
});

test('only stops an active selected task after explicit confirmation', async () => {
  const source = new Source([task('done', 'terminal', 'Done', { status: 'completed' }), task('live', 'terminal', 'Live')]);
  const view = new TasksView(source, () => {}, () => {}, () => 10);
  view.handleInput('x'); view.handleInput('y');
  assert.deepEqual(source.stopped, []);
  view.handleInput('\x1b[B'); view.handleInput('x');
  assert.match(clean(view.render(50)), /Stop Live\?/);
  view.handleInput('n'); view.handleInput('x'); view.handleInput('y');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(source.stopped, ['live']);
  view.dispose();
});

test('bounds every rendered line after resize and disposes subscriptions without stopping tasks', () => {
  const source = new Source([task('tiny', 'terminal', 'A very long title that must be clipped')]);
  let height = 5; let renders = 0;
  const view = new TasksView(source, () => renders++, () => {}, () => height);
  for (const width of [8, 17, 43]) {
    const frame = view.render(width);
    assert.equal(frame.length, height);
    assert.ok(frame.every(line => visibleWidth(line) <= width));
  }
  height = 2;
  assert.equal(view.render(12).length, 2);
  view.dispose(); source.emit();
  assert.equal(source.listeners.size, 0);
  assert.deepEqual(source.stopped, []);
});

test('contains a failed stop and shows its error without changing task state', async () => {
  const source = new RejectingSource([task('live', 'terminal', 'Live')]);
  const view = new TasksView(source, () => {}, () => {}, () => 9);
  view.handleInput('x'); view.handleInput('y');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(clean(view.render(60)), /Stop failed: permission denied/);
  assert.equal(source.tasks[0].status, 'running');
  view.dispose();
});

test('keeps the same visible log anchor while scrolled as new output arrives', () => {
  const logs = Array.from({ length: 15 }, (_, i) => ({ seq: i, time: Date.now(), stream: 'stdout' as const, text: `line-${i}\n` }));
  const source = new Source([task('stable', 'terminal', 'Stable', { logs })]);
  const view = new TasksView(source, () => {}, () => {}, () => 10, 'stable');
  view.handleInput('\x1b[5~');
  const before = clean(view.render(50)).split('\n').find(line => /line-\d/.test(line));
  source.tasks[0].logs.push({ seq: 15, time: Date.now(), stream: 'stdout', text: 'appended\n' }); source.emit();
  const after = clean(view.render(50)).split('\n').find(line => /line-\d/.test(line));
  assert.equal(after, before);
  assert.doesNotMatch(clean(view.render(50)), /appended/);
  view.dispose();
});

test('joins adjacent stream fragments into logical lines before search and display', () => {
  const source = new Source([task('chunks', 'agent', 'Chunks', { logs: [
    { seq: 1, time: Date.now(), stream: 'agent', text: 'Hello' },
    { seq: 2, time: Date.now(), stream: 'agent', text: ' world\n' },
  ] })]);
  const view = new TasksView(source, () => {}, () => {}, () => 9, 'chunks');
  view.handleInput('/'); for (const c of 'hello world') view.handleInput(c); view.handleInput('\r');
  const output = clean(view.render(60));
  assert.match(output, /\[agent\] Hello world/);
  assert.equal(output.match(/\[agent\]/g)?.length, 1);
  view.dispose();
});

test('multiline task metadata never escapes a rendered terminal row', () => {
 const source=new Source([task('a','agent','title\nsecond',{result:'line1\nline2',command:'echo a\necho b',latest:'one\ntwo'})]);
 const view=new TasksView(source,()=>{},()=>{},()=>20);
 assert.ok(view.render(100).every(row=>!/[\r\n]/.test(row)));
 view.handleInput('\r');
 assert.ok(view.render(100).every(row=>!/[\r\n]/.test(row)));
 view.dispose();
});

test('mouse opens a task row and closes details without typing a command',()=>{
 const source=new Source([task('a','terminal','Build')]);let closed=0;
 const view=new TasksView(source,()=>{},()=>closed++,()=>20);
 view.render(100);
 view.handleMouse({type:'click',button:'left',x:10,y:2} as any);
 assert.match(clean(view.render(100)),/cwd/);
 view.handleMouse({type:'click',button:'left',x:9,y:0} as any);
 assert.equal(closed,1);view.dispose();
});

test('drag-copy copies the rows on screen (not the start of the log); clicks do not copy',async()=>{
 const logs=Array.from({length:100},(_,i)=>({seq:i,time:Date.now(),stream:'stdout' as const,text:`line-${i} ${'x'.repeat(i===98?150:0)}\n`}));
 const copied:string[]=[];const view=new TasksView(new Source([task('t','terminal','Long',{logs})]),()=>{},()=>{},()=>24,'t',undefined,async text=>{copied.push(text);});
 const rows=clean(view.render(80)).split('\n');
 const y=rows.findIndex(r=>/\[stdout\] line-\d+/.test(r));const first=Number(/line-(\d+)/.exec(rows[y])![1]);
 assert.ok(first>50,'view is tailing the log');
 view.handleMouse({type:'press',button:'left',x:10,y} as any);view.handleMouse({type:'release',button:'left',x:10,y} as any);
 await new Promise(r=>setTimeout(r,0));assert.equal(copied.length,0,'a plain click does not copy');
 const at98=rows.findIndex(r=>r.includes('line-98'));
 view.handleMouse({type:'press',button:'left',x:10,y:at98} as any);view.handleMouse({type:'drag',button:'left',x:20,y:at98+1} as any);view.handleMouse({type:'release',button:'left',x:20,y:at98+1} as any);
 await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(copied,[`line-98 ${'x'.repeat(150)}\nline-99 `],'exact untruncated rows under the drag');
 assert.match(clean(view.render(80)),/Copied 2 lines/);
 assert.doesNotMatch(view.render(80).join(''),/\x1b\[7m/,'highlight cleared after copy');
 view.dispose();
});

test('copy failure is shown in the footer',async()=>{
 const view=new TasksView(new Source([task('t','terminal','T',{logs:[{seq:1,time:Date.now(),stream:'stdout',text:'hello\n'}]})]),()=>{},()=>{},()=>20,'t',undefined,async()=>{throw new Error('No clipboard tool found');});
 view.render(80);view.handleInput('c');await new Promise(r=>setTimeout(r,0));
 assert.match(clean(view.render(80)),/Copy failed: No clipboard tool found/);view.dispose();
});

test('detail view closes only on its [x] buttons, not anywhere near the right edge',()=>{
 let closed=0;const logs=Array.from({length:30},(_,i)=>({seq:i,time:Date.now(),stream:'stdout' as const,text:`line-${i}\n`}));
 const view=new TasksView(new Source([task('t','terminal','T',{logs})]),()=>{},()=>closed++,()=>24,'t');
 const rows=clean(view.render(80)).split('\n');const body=rows.findIndex(r=>r.includes('line-'));
 view.handleMouse({type:'click',button:'left',x:78,y:body,width:80} as any);
 view.handleMouse({type:'click',button:'left',x:2,y:body,width:80} as any);
 assert.equal(closed,0);
 const border=rows.findIndex(r=>r.includes('╭'));const x=rows[border].indexOf('[x]');
 view.handleMouse({type:'click',button:'left',x,y:border,width:80} as any);assert.equal(closed,1);
 view.dispose();
});
