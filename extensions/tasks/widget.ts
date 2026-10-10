import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { cleanOutput } from './manager.ts';
import { activeTask, type TaskRecord } from './types.ts';

/** Todos-style panel: `● Tasks (done/total)` heading, tree rows, one status glyph per task. */
export type Paint = (color: string, text: string) => string;
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Finished tasks stay listed (dimmed) this long, then drop out like completed todos. */
export const KEEP_FINISHED_MS = 5 * 60_000;
export const MAX_ROWS = 6;

const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
/** Agent counters for a row, e.g. "3 turns · 7 tools · 12.4k". Empty until there is something to show. */
export function progressText(task: TaskRecord): string {
  const p = task.progress; if (!p || (!p.turns && !p.tools && !p.tokens)) return '';
  const parts = [`${p.turns} turn${p.turns === 1 ? '' : 's'}`, `${p.tools} tool${p.tools === 1 ? '' : 's'}`];
  if (p.tokens) parts.push(compact(p.tokens));
  return parts.join(' · ');
}

/** Short default title: first line, cut at the first sentence end, then at a word boundary (≤48 chars). */
export function shortTitle(text: string, max = 48): string {
  const line = text.trim().split(/\r?\n/).find(l => l.trim())?.trim().replace(/\s+/g, ' ') ?? '';
  const sentence = /^(.{12,}?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1); const space = cut.lastIndexOf(' ');
  return (space >= max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

export const elapsed = (task: TaskRecord, now: number) => {
  const s = Math.max(0, Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

function glyph(task: TaskRecord, now: number, paint: Paint): string {
  if (activeTask(task)) return paint('accent', SPINNER[Math.floor(now / 120) % SPINNER.length]);
  if (task.status === 'completed') return paint('success', '✓');
  if (task.status === 'stopped') return paint('dim', '■');
  return paint('error', '✗');
}

/** Tasks shown in the panel: all running, plus recently finished, newest last. */
export function visibleTasks(tasks: TaskRecord[], now: number): TaskRecord[] {
  return tasks.filter(t => activeTask(t) || (t.endedAt !== undefined && now - t.endedAt < KEEP_FINISHED_MS));
}

export interface WidgetFrame { lines: string[]; rows: Array<string | undefined> }

/** Render the panel. rows[i] is the task id on line i (undefined for heading/summary). Empty when nothing to show. */
export function renderTaskWidget(tasks: TaskRecord[], width: number, now: number, paint: Paint, collapsed = false): WidgetFrame {
  const shown = visibleTasks(tasks, now);
  if (!shown.length || width <= 0) return { lines: [], rows: [] };
  const fit = (line: string) => truncateToWidth(line, width, '…');
  const running = shown.filter(activeTask).length;
  const done = shown.filter(t => t.status === 'completed').length;
  const tone = running ? 'accent' : 'dim';
  const heading = fit(`${paint(tone, running ? '●' : '○')} ${paint(tone, `Tasks (${done}/${shown.length})`)}`);
  if (collapsed) return { lines: [heading, fit(`${paint('dim', '└─')} ${paint('dim', `${running} running · F6 to open`)}`), ''], rows: [] };

  // Running tasks first, then most recently finished; overflow becomes a "+N more" row.
  const ordered = [...shown.filter(activeTask), ...shown.filter(t => !activeTask(t)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))];
  const visible = ordered.slice(0, MAX_ROWS);
  const hidden = ordered.length - visible.length;
  const lines = [heading]; const rows: Array<string | undefined> = [undefined];
  visible.forEach((task, i) => {
    const last = i === visible.length - 1 && !hidden;
    const live = activeTask(task);
    const kind = paint('muted', (task.kind === 'agent' ? 'Agent' : 'Run').padEnd(5));
    const failed = task.status === 'failed' || task.status === 'timed_out';
    const note = failed ? (task.exitCode != null ? ` · exit ${task.exitCode}` : task.status === 'timed_out' ? ' · timed out' : ' · failed') : '';
    // Stats are dropped on narrow terminals before the title is squeezed.
    const stats = width >= 70 ? progressText(task) : '';
    const time = paint('dim', ` ${elapsed(task, now)}${stats ? ` · ${stats}` : ''}${note}`);
    const prefix = `${paint('dim', last ? '└─' : '├─')} ${glyph(task, now, paint)} ${kind} `;
    const room = Math.max(4, width - visibleWidth(prefix) - visibleWidth(time));
    const plain = truncateToWidth(cleanOutput(task.title).replace(/\s+/g, ' ').trim(), room, '…');
    lines.push(fit(prefix + paint(live ? 'text' : 'dim', plain) + time));
    rows.push(task.id);
  });
  if (hidden) { lines.push(fit(`${paint('dim', '└─')} ${paint('dim', `+${hidden} more · F6 to open`)}`)); rows.push(undefined); }
  // Trailing spacer, like Todos, so the panel is not glued to the editor.
  lines.push(''); rows.push(undefined);
  return { lines, rows };
}
