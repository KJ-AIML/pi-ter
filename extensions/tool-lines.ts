/**
 * Compact tool rows, ported from Tickloop/claude-mods `tool-lines`.
 * Collapsed: one line `● tool(subject)` (dot = state). Expanded (Ctrl+O): the tool's own full result.
 * Colors come from the active Pi theme, so piter-mono (or any theme) applies.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';

const MAX_SUBJECT = 60;

// Input fields that name what a call acts on, most telling first.
const SUBJECT_KEYS = ['command', 'path', 'file_path', 'pattern', 'url', 'query', 'skill', 'description', 'action', 'task', 'prompt', 'topic'];

export function subjectOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const f = input as Record<string, unknown>;
  const key = SUBJECT_KEYS.find(k => typeof f[k] === 'string' && f[k] !== '');
  const raw = key !== undefined ? String(f[key]) : Object.keys(f).length ? JSON.stringify(f) : '';
  return raw.replace(/\s+/g, ' ').trim();
}

export function clip(text: string, room: number): string {
  if (text.length <= room) return text;
  return room <= 1 ? '…' : text.slice(0, room - 1) + '…';
}

export const shortPath = (s: string) => s.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');

export function lineParts(tool: string, args: unknown, isError: boolean) {
  let subject = subjectOf(args);
  if (/^(read|write|edit|ls|find)$/.test(tool)) subject = shortPath(subject);
  return { tool, subject: clip(subject, MAX_SUBJECT), meta: isError ? 'error' : '' };
}

const textOf = (result: any): string =>
  (result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();

export function registerToolLines(pi: ExtensionAPI): void {
  // registerToolRenderer exists from Pi 1.x; older Pi (e.g. 0.85.1) keeps its built-in rows.
  const api = pi as unknown as { registerToolRenderer?: (r: (toolName: string, next: () => any) => any) => void };
  if (typeof api.registerToolRenderer !== 'function') return;
  api.registerToolRenderer((toolName: string, next: () => any) => {
    const original = next();
    return {
      // No tinted box: the row is a single line, state is carried by the dot.
      renderShell: 'self',
      renderCall(args: any, theme: any, ctx: any) {
        const done = !ctx.isPartial;
        const p = lineParts(toolName, args, !!ctx.isError);
        // tool-lines style: white dot, dim "tool_call:" prefix, bold tool name, plain subject.
        const dot = ctx.isError ? theme.fg('error', '●') : done ? theme.fg('text', '●') : theme.fg('warning', '●');
        const meta = p.meta ? ' ' + theme.fg('error', `- ${p.meta}`) : '';
        const line = `${dot} ${theme.fg('dim', 'tool_call: ')}${theme.fg('toolTitle', theme.bold(p.tool))}${theme.fg('text', `(${p.subject})`)}${meta}`;
        return { render: (w: number) => [truncateToWidth(' ' + line, w, '…')], invalidate() {} } as any;
      },
      renderResult(result: any, opts: any, theme: any, ctx: any) {
        if (opts.isPartial) return new Text('', 0, 0);
        if (opts.expanded) {
          const full = original?.renderResult?.(result, opts, theme, ctx);
          if (full) return full;
          const body = textOf(result);
          return new Text(body ? theme.fg('toolOutput', body) : '', 2, 0);
        }
        // Collapsed: only surface failures, one line.
        if (ctx.isError) {
          const first = textOf(result).split('\n')[0] ?? '';
          return new Text(first ? '  ' + theme.fg('error', clip(first, 120)) : '', 0, 0);
        }
        return new Text('', 0, 0);
      },
    };
  });
}
