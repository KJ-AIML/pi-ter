import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { activeTask, type LogEntry, type LogStream, type TaskRecord, type TaskSource } from './types.ts';

const cyan = (s: string) => `\x1b[38;2;103;220;229m${s}\x1b[0m`;
const purple = (s: string) => `\x1b[38;2;201;149;245m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[38;2;146;151;166m${s}\x1b[0m`;
const streams: Array<'all' | LogStream> = ['all', 'stdout', 'stderr', 'agent', 'tool', 'system'];
interface DisplayLogLine { key: string; seq: number; text: string }

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

  constructor(private source: TaskSource, private requestRender: () => void, private close: () => void,
    private rows: () => number, initialId?: string) {
    this.selectedId = initialId ?? source.list()[0]?.id;
    this.mode = initialId && source.get(initialId) ? 'detail' : 'list';
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
    const lines = [cyan(' TASKS') + dim(`  ${all.length} total`),
      ` ${this.filter === 'all' ? purple('[ALL]') : dim(' all ')}  ${this.filter === 'terminal' ? purple('[TERMINAL]') : dim(` terminal ${counts('terminal')}`)}  ${this.filter === 'agent' ? purple('[AGENT]') : dim(` agent ${counts('agent')}`)}`];
    if (!tasks.length) lines.push('', dim('  No tasks in this view.'));
    const budget = Math.max(0, height - 3);
    const selected = Math.max(0, tasks.findIndex(t => t.id === this.selectedId));
    const start = Math.max(0, Math.min(selected - Math.floor(budget / 2), tasks.length - budget));
    for (const task of tasks.slice(start, start + budget)) {
      const marker = task.id === this.selectedId ? purple('›') : ' ';
      lines.push(` ${marker} ${cyan(task.kind === 'agent' ? '◆' : '▸')} ${oneLine(task.title)}  ${dim(`${task.status} · ${elapsed(task)} · ${task.id} · ${oneLine(task.latest)}`)}`);
    }
    const selectedTask = this.selectedId ? this.source.get(this.selectedId) : undefined;
    lines.push(this.confirmStop && selectedTask ? purple(` Stop ${oneLine(selectedTask.title)}? y confirm · n/Esc cancel`) :
      this.stopError ? purple(` Stop failed: ${oneLine(this.stopError)}`) : dim(' ↑↓ select · Tab filter · Enter details · x stop · Esc close'));
    return lines;
  }

  private renderDetail(_width: number, height: number): string[] {
    const task = this.selectedId ? this.source.get(this.selectedId) : undefined;
    if (!task) return [cyan(' TASKS'), '', dim('  Task is no longer available.'), dim(' Esc back')];
    const exit = task.exitCode !== undefined ? ` · exit ${task.exitCode ?? '—'}` : '';
    const lines = [
      `${cyan(' TASK')} ${purple(oneLine(task.title))} ${dim(`${task.status} · ${elapsed(task)}${exit}`)}`,
      dim(` ${task.id} · ${task.kind}${task.model ? ` · ${oneLine(task.model)}` : ''}`),
      dim(` cwd ${oneLine(task.cwd)} · path ${oneLine(task.logPath)}`),
      dim(` cmd ${oneLine(task.command)}`),
    ];
    if (task.error) lines.push(` ${purple('error')} ${oneLine(task.error)}`);
    else if (task.result) lines.push(` ${cyan('result')} ${oneLine(task.result)}`);
    if (task.dropped || task.diskTruncated) lines.push(dim(` ⚠ ${task.dropped ? `${task.dropped} live log entries dropped` : ''}${task.dropped && task.diskTruncated ? ' · ' : ''}${task.diskTruncated ? 'disk log cap reached' : ''}`));
    const footer = this.confirmStop ? purple(` Stop ${oneLine(task.title)}? y confirm · n/Esc cancel`) :
      this.searchMode ? purple(` /${safe(this.searchDraft)}█  Enter apply · Esc cancel`) :
      dim(` w wrap:${this.wrap ? 'on' : 'off'} · f stream:${this.stream} · ↑↓/Pg scroll · End tail · / search · x stop · Esc back`);
    const budget = Math.max(0, height - lines.length - 1);
    const logLines = this.logLines(task, Math.max(1, _width - 3));
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
    lines.push(...logLines.slice(start, end).map(line => ` ${line.text}`), footer);
    return lines;
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
        rendered.forEach((text, wrapIndex) => lines.push({ key: `${group.first}:${index}:${wrapIndex}`, seq: group.first, text }));
      });
    }
    if (!lines.length) {
      lines.push({ key: 'empty', seq: Number.MAX_SAFE_INTEGER, text: dim(query ? 'No matching log lines.' : 'No logs yet.') });
    }
    return lines;
  }

  handleInput(data: string): void {
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
      if (this.mode === 'detail') { this.mode = 'list'; this.search = ''; this.scroll = 0; } else this.close();
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
    else if (data === 'w') { this.wrap = !this.wrap; this.anchor = undefined; }
    else if (data === 'f') { this.stream = streams[(streams.indexOf(this.stream) + 1) % streams.length]; this.scroll = 0; this.anchor = undefined; }
    else if (matchesKey(data, Key.end)) { this.scroll = 0; this.anchor = undefined; }
    else if (matchesKey(data, Key.up)) { this.scroll++; this.anchor = undefined; }
    else if (matchesKey(data, Key.down)) { this.scroll = Math.max(0, this.scroll - 1); this.anchor = undefined; }
    else if (matchesKey(data, Key.pageUp)) { this.scroll += page; this.anchor = undefined; }
    else if (matchesKey(data, Key.pageDown)) { this.scroll = Math.max(0, this.scroll - page); this.anchor = undefined; }
  }
}
