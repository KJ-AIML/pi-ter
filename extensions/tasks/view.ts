import { copyToClipboard } from './clipboard.ts';
import { progressText } from './widget.ts';
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { activeTask, type LogEntry, type LogStream, type TaskRecord, type TaskSource } from './types.ts';

import { accent, muted, text } from '../theme.ts';
// Neutral palette: titles in primary text, selection/active in the single accent.
const cyan = text;
const purple = accent;
const dim = muted;
const streams: Array<'all' | LogStream> = ['all', 'stdout', 'stderr', 'agent', 'tool', 'system'];
/** text is the rendered row; raw/logical identify the untruncated source line so copies are lossless. */
interface DisplayLogLine { key: string; seq: number; text: string; raw: string; logical: string }

// Task output is untrusted terminal input. Preserve printable text and line boundaries only.
const safe = (text: string) => text
  .replace(/\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)?|[()][0-2A-Z])/g, '')
  .replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '�');
const oneLine = (text: string) => safe(text).replace(/\n/g, ' ');
const fit = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width), '');
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
};
const elapsed = (task: TaskRecord) => {
  const seconds = Math.max(0, Math.floor(((task.endedAt ?? Date.now()) - task.startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};

export class TasksView {
  private mode: 'list' | 'detail';
  private mouseRows = new Map<number,string>();
  private filter: 'all' | 'terminal' | 'agent' = 'all';
  private selectedId?: string;
  private searchMode = false;
  private searchDraft = '';
  private search = '';
  private wrap = false;
  private stream: 'all' | LogStream = 'all';
  private scroll = 0;
  private confirmStop = false;
  private stopError = '';
  private anchor?: { key: string; seq: number };
  private disposed = false;
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval>;

  private modal = false;
  private selecting = false;
  private sel = 0;
  private bodyTop = 0;
  private bodyCount = 0;
  private dragFrom: { x: number; y: number } | undefined;
  private dragTo: { x: number; y: number } | undefined;
  /** Log rows exactly as last rendered, so mouse rows map to what the user sees. */
  private visible: DisplayLogLine[] = [];
  private notice = '';
  private frame = { top: 0, left: 0, inner: 0 };
  private source: TaskSource; private requestRender: () => void; private close: () => void;
  private rows: () => number; private quote?: (text: string) => void;
  private clipboard: (text: string) => Promise<unknown>;
  constructor(source: TaskSource, requestRender: () => void, close: () => void,
    rows: () => number, initialId?: string, quote?: (text: string) => void, clipboard: (text: string) => Promise<unknown> = text => copyToClipboard(text)) {
    this.source = source; this.requestRender = requestRender; this.close = close; this.rows = rows; this.quote = quote; this.clipboard = clipboard;
    this.selectedId = initialId ?? source.list()[0]?.id;
    this.mode = initialId && source.get(initialId) ? 'detail' : 'list';
    this.modal = this.mode === 'detail';
    this.unsubscribe = source.subscribe(() => { if (!this.disposed) this.requestRender(); });
    this.timer = setInterval(() => { if (!this.disposed) this.requestRender(); }, 1000);
    this.timer.unref?.();
  }

  invalidate() { this.requestRender(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    clearInterval(this.timer);
  }

  render(width: number): string[] {
    const height = Math.max(0, this.rows());
    const lines = this.mode === 'detail' ? this.renderDetail(width, height) : this.renderList(width, height);
    return lines.slice(0, height).concat(Array(Math.max(0, height - lines.length)).fill('')).map(line => fit(line, width));
  }

  private filteredTasks() { return this.source.list().filter(t => this.filter === 'all' || t.kind === this.filter); }

  private renderList(_width: number, height: number): string[] {
    const all = this.source.list();
    const tasks = this.filteredTasks();
    if (!tasks.some(t => t.id === this.selectedId)) this.selectedId = tasks[0]?.id;
    const counts = (kind: 'terminal' | 'agent') => all.filter(t => t.kind === kind).length;
    this.mouseRows.clear();
    const lines = [dim(' [Close]') + cyan(' TASKS') + dim(`  ${all.length} total`),
      ` ${this.filter === 'all' ? purple('[ALL]') : dim(' all ')}  ${this.filter === 'terminal' ? purple('[TERMINAL]') : dim(` terminal ${counts('terminal')}`)}  ${this.filter === 'agent' ? purple('[AGENT]') : dim(` agent ${counts('agent')}`)}`];
    if (!tasks.length) lines.push('', dim('  No tasks in this view.'));
    const budget = Math.max(0, height - 3);
    const selected = Math.max(0, tasks.findIndex(t => t.id === this.selectedId));
    const start = Math.max(0, Math.min(selected - Math.floor(budget / 2), tasks.length - budget));
    for (const task of tasks.slice(start, start + budget)) {
      const marker = task.id === this.selectedId ? purple('›') : ' ';
      this.mouseRows.set(lines.length,task.id);
      lines.push(` ${marker} ${cyan(task.kind === 'agent' ? '◆' : '▸')} ${oneLine(task.title)}  ${dim(`${task.status} · ${elapsed(task)} · ${task.id} · ${oneLine(task.latest)}`)}`);
    }
    const selectedTask = this.selectedId ? this.source.get(this.selectedId) : undefined;
    lines.push(this.confirmStop && selectedTask ? purple(` Stop ${oneLine(selectedTask.title)}? y confirm · n/Esc cancel`) :
      this.stopError ? purple(` Stop failed: ${oneLine(this.stopError)}`) : dim(' ↑↓ select · Tab filter · Enter details · x stop · Esc close'));
    return lines;
  }

  private renderDetail(width: number, height: number): string[] {
    const task = this.selectedId ? this.source.get(this.selectedId) : undefined;
    if (!task) return [cyan(' TASKS'), '', dim('  Task is no longer available.'), dim(' Esc back')];
    const exit = task.exitCode !== undefined ? ` · exit ${task.exitCode ?? '—'}` : '';
    const lines = [
      `${dim(' [x]')} ${cyan(oneLine(task.title))} ${dim(`${task.status} · ${elapsed(task)}${progressText(task) ? ` · ${progressText(task)}` : ''}${exit}`)}`,
      dim(` ${task.id} · ${task.kind} · cwd ${oneLine(task.cwd)} · ${oneLine(task.command)}`),
    ];
    if (task.error) lines.push(` ${purple('error')} ${oneLine(task.error)}`);
    else if (task.result) lines.push(` ${cyan('result')} ${oneLine(task.result)}`);
    if (task.dropped || task.diskTruncated) lines.push(dim(` ⚠ ${task.dropped ? `${task.dropped} live log entries dropped` : ''}${task.dropped && task.diskTruncated ? ' · ' : ''}${task.diskTruncated ? 'disk log cap reached' : ''}`));
    const footer = this.confirmStop ? purple(` Stop ${oneLine(task.title)}? y confirm · n/Esc cancel`) :
      this.searchMode ? purple(` /${safe(this.searchDraft)}█  Enter apply · Esc cancel`) :
      this.notice ? purple(` ${oneLine(this.notice)}`) :
      dim(` w wrap:${this.wrap ? 'on' : 'off'} · Esc:close · Enter:quote · /:search · f:filter · v:select · c:copy`);
    const compact = height < 16;
    const budget = Math.max(1, height - lines.length - (compact ? 3 : 6));
    const logLines = this.logLines(task, Math.max(1, width - 4));
    if (this.scroll > 0 && this.anchor) {
      let anchored = logLines.findIndex(line => line.key === this.anchor!.key);
      if (anchored < 0) anchored = logLines.findIndex(line => line.seq >= this.anchor!.seq);
      if (anchored >= 0) this.scroll = Math.max(0, logLines.length - (anchored + budget));
    }
    this.scroll = Math.min(this.scroll, Math.max(0, logLines.length - budget));
    const end = Math.max(0, logLines.length - this.scroll);
    const start = Math.max(0, end - budget);
    if (this.scroll > 0 && logLines[start]) this.anchor = { key: logLines[start].key, seq: logLines[start].seq };
    else this.anchor = undefined;
    const body = logLines.slice(start, end);
    this.visible = body;
    // Inset the frame so it does not sit on the terminal edge or cover a side panel.
    const marginX = !compact && width >= 48 ? 3 : 0;
    const marginY = compact ? 0 : 1;
    const inner = Math.max(8, width - marginX * 2);
    const barAt = body.length ? Math.round((1 - this.scroll / Math.max(1, logLines.length)) * (body.length - 1)) : 0;
    const close = ' [x]';
    const top = '╭' + '─'.repeat(Math.max(0, inner - 2 - close.length)) + close + '╮';
    const bottom = '╰' + '─'.repeat(Math.max(0, inner - 2)) + '╯';
    const row = (content: string, bar = false) => dim('│') + fit(content, inner - 2) + (bar ? purple('▐') : dim('│'));
    this.bodyTop = marginY + 1 + lines.length + (compact ? 0 : 1);
    this.frame = { top: marginY, left: marginX, inner };
    this.bodyCount = body.length;
    const markLine = (i: number, raw: string) => {
      const y = this.bodyTop + i;
      const on = this.dragFrom && this.dragTo && y >= Math.min(this.dragFrom.y, this.dragTo.y) && y <= Math.max(this.dragFrom.y, this.dragTo.y);
      const shown = on ? `\x1b[7m${raw}\x1b[27m` : raw;
      const mark = this.selecting && i === this.sel ? purple('▸') : ' ';
      return row(mark + shown, i === barAt);
    };
    const boxed = [
      ...Array(marginY).fill(''),
      top,
      ...lines.map(line => row(' ' + line)),
      ...(compact ? [] : [row('')]),
      ...body.map((line, i) => markLine(i, line.text)),
      bottom,
      ...(compact ? [] : ['']),
      footer,
    ].map(line => ' '.repeat(marginX) + line);
    return boxed;
  }

  private copySelection() {
    const body = this.selectedLogText();
    if (!body) return;
    const count = body.split('\n').length;
    void this.clipboard(body)
      .then(() => { this.notice = `Copied ${count} line${count === 1 ? '' : 's'}`; })
      .catch(error => { this.notice = `Copy failed: ${error instanceof Error ? error.message : String(error)}`; })
      .finally(() => { if (!this.disposed) this.requestRender(); });
  }

  /** Untruncated text of the given rows; wrapped rows of one source line are copied once. */
  private rawText(rows: DisplayLogLine[]): string {
    const seen = new Set<string>(); const out: string[] = [];
    for (const row of rows) if (row.logical && !seen.has(row.logical)) { seen.add(row.logical); out.push(row.raw); }
    return out.join('\n');
  }

  private selectedLogText(): string {
    const task = this.selectedId ? this.source.get(this.selectedId) : undefined;
    if (!task) return '';
    if (this.dragFrom && this.dragTo) {
      const lo = Math.min(this.dragFrom.y, this.dragTo.y) - this.bodyTop;
      const hi = Math.max(this.dragFrom.y, this.dragTo.y) - this.bodyTop;
      return this.rawText(this.visible.slice(Math.max(0, lo), hi + 1));
    }
    if (this.selecting) return this.rawText(this.visible.slice(Math.min(this.sel, this.visible.length - 1)).slice(0, 1));
    return this.rawText(this.logLines(task, 200));
  }

  private logLines(task: TaskRecord, width: number): DisplayLogLine[] {
    const query = this.search.toLocaleLowerCase();
    const groups: Array<{ stream: LogStream; first: number; last: number; text: string }> = [];
    for (const log of task.logs) {
      if (this.stream !== 'all' && log.stream !== this.stream) continue;
      const previous = groups.at(-1);
      if (previous?.stream === log.stream) { previous.text += safe(log.text); previous.last = log.seq; }
      else groups.push({ stream: log.stream, first: log.seq, last: log.seq, text: safe(log.text) });
    }
    const lines: DisplayLogLine[] = [];
    for (const group of groups) {
      const logical = group.text.split('\n');
      if (logical.at(-1) === '') logical.pop();
      logical.forEach((raw, index) => {
        if (query && !raw.toLocaleLowerCase().includes(query)) return;
        const prefix = dim(`[${group.stream}] `);
        const rendered = this.wrap ? wrapTextWithAnsi(prefix + raw, width) : [truncateToWidth(prefix + raw, width, '')];
        const logical = `${group.first}:${index}`;
        rendered.forEach((text, wrapIndex) => lines.push({ key: `${logical}:${wrapIndex}`, seq: group.first, text, raw, logical }));
      });
    }
    if (!lines.length) {
      lines.push({ key: 'empty', seq: Number.MAX_SAFE_INTEGER, text: dim(query ? 'No matching log lines.' : 'No logs yet.'), raw: '', logical: '' });
    }
    return lines;
  }

  handleMouse(event:TuiMouseEvent) {
    if(event.type==='wheel'&&this.mode==='detail'){
      this.scroll=Math.max(0,this.scroll-(event.wheelDelta??0));this.anchor=undefined;this.requestRender();return {handled:true};
    }
    if(this.mode==='detail' && (event.type==='press'||event.type==='drag'||event.type==='release') && event.button==='left'){
      const inBody = event.y>=this.bodyTop && event.y<this.bodyTop+this.bodyCount;
      if(event.type==='press' && inBody){ this.dragFrom={x:event.x,y:event.y}; this.dragTo={x:event.x,y:event.y}; return {handled:true,capture:true}; }
      if(event.type==='drag' && this.dragFrom){ this.dragTo={x:event.x,y:event.y}; return {handled:true,capture:true,render:true}; }
      if(event.type==='release' && this.dragFrom){
        // A click without movement is not a selection; only real drags copy.
        const moved=!!this.dragTo&&(this.dragTo.x!==this.dragFrom.x||this.dragTo.y!==this.dragFrom.y);
        if(moved)this.copySelection();
        this.dragFrom=undefined;this.dragTo=undefined;
        return {handled:true,render:true};
      }
    }
    if(event.button!=='left'||!['press','release','click'].includes(event.type))return;
    if(event.type!=='click')return {handled:true};
    if(this.confirmStop||this.searchMode)return {handled:true};
    if(this.mode==='detail'){
      // Close only on the two [x] buttons (top border right, title row left) or the very first row.
      const {top,left,inner}=this.frame;
      const borderX=event.y===top&&event.x>=left+inner-6&&event.x<left+inner;
      const titleX=event.y===top+1&&event.x>=left&&event.x<left+6;
      if(event.y===0||borderX||titleX){ this.close(); return {handled:true}; }
    }
    if(event.y===0){
      if(this.mode==='list'&&event.x>=1&&event.x<8)this.close();
    }else if(this.mode==='list'){
      const id=this.mouseRows.get(event.y);
      if(id&&this.source.get(id)){this.selectedId=id;this.mode='detail';this.search='';this.scroll=0;}
    }
    this.requestRender();return {handled:true};
  }

  handleInput(data: string): void {
    this.notice = '';
    if (this.confirmStop) {
      if (data.toLowerCase() === 'y') {
        this.confirmStop = false;
        const id = this.selectedId;
        const task = id ? this.source.get(id) : undefined;
        if (id && task && activeTask(task)) void this.source.stop(id)
          .then(() => { this.stopError = ''; })
          .catch(error => { this.stopError = error instanceof Error ? error.message : String(error); })
          .finally(() => this.requestRender());
      }
      else if (data.toLowerCase() === 'n' || matchesKey(data, Key.escape)) this.confirmStop = false;
      this.requestRender(); return;
    }
    if (this.searchMode) {
      if (matchesKey(data, Key.enter)) { this.search = this.searchDraft; this.searchMode = false; this.scroll = 0; }
      else if (matchesKey(data, Key.escape)) this.searchMode = false;
      else if (matchesKey(data, Key.backspace)) this.searchDraft = this.searchDraft.slice(0, -1);
      else if (/^[\x20-\x7e]+$/.test(data)) this.searchDraft += data;
      this.requestRender(); return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.mode === 'detail' && !this.modal) { this.mode = 'list'; this.search = ''; this.scroll = 0; } else this.close();
      this.requestRender(); return;
    }
    if (data === 'x') {
      const selected = this.selectedId ? this.source.get(this.selectedId) : undefined;
      if (selected && activeTask(selected)) { this.confirmStop = true; this.stopError = ''; }
    } else if (this.mode === 'list') this.handleListInput(data);
    else this.handleDetailInput(data);
    this.requestRender();
  }

  private handleListInput(data: string) {
    if (matchesKey(data, Key.tab)) {
      const order = ['all', 'terminal', 'agent'] as const;
      this.filter = order[(order.indexOf(this.filter) + 1) % order.length]; this.selectedId = this.filteredTasks()[0]?.id;
    } else if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      const tasks = this.filteredTasks(); if (!tasks.length) return;
      const at = Math.max(0, tasks.findIndex(t => t.id === this.selectedId));
      this.selectedId = tasks[Math.max(0, Math.min(tasks.length - 1, at + (matchesKey(data, Key.up) ? -1 : 1)))].id;
    } else if (matchesKey(data, Key.enter) && this.selectedId) this.mode = 'detail';
  }

  private handleDetailInput(data: string) {
    const page = Math.max(1, this.rows() - 5);
    if (data === '/') { this.searchMode = true; this.searchDraft = this.search; }
    else if (data === 'v') this.selecting = !this.selecting;
    else if (data === 'c') this.copySelection();
    else if (matchesKey(data, Key.enter)) this.quote?.(this.selectedLogText());
    else if (data === 'w') { this.wrap = !this.wrap; this.anchor = undefined; }
    else if (data === 'f') { this.stream = streams[(streams.indexOf(this.stream) + 1) % streams.length]; this.scroll = 0; this.anchor = undefined; }
    else if (matchesKey(data, Key.end)) { this.scroll = 0; this.anchor = undefined; }
    else if (matchesKey(data, Key.up)) { this.scroll++; this.anchor = undefined; }
    else if (matchesKey(data, Key.down)) { this.scroll = Math.max(0, this.scroll - 1); this.anchor = undefined; }
    else if (matchesKey(data, Key.pageUp)) { this.scroll += page; this.anchor = undefined; }
    else if (matchesKey(data, Key.pageDown)) { this.scroll = Math.max(0, this.scroll - page); this.anchor = undefined; }
  }
}
