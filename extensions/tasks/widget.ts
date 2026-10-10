import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { cleanOutput } from './manager.ts';
import { activeTask, type TaskRecord } from './types.ts';

/** Todos-style panel: `● Tasks (done/total)` heading, tree rows, one status glyph per task. */
export type Paint = (color: string, text: string) => string;
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Finished tasks stay listed (dimmed) this long, then drop out like completed todos. */
export const KEEP_FINISHED_MS = 5 * 60_000;
export const MAX_ROWS = 6;

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
    const time = paint('dim', ` ${elapsed(task, now)}${note}`);
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
