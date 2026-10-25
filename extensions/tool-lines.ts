/**
 * Compact tool rows, ported from Tickloop/claude-mods `tool-lines`.
 * Collapsed: one line `● tool(subject)` (dot = state). Expanded (Ctrl+O): the tool's own full result.
 * Colors come from the active Pi theme, so piter-mono (or any theme) applies.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Component, TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui';
import { Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { copyToClipboard } from './tasks/clipboard.ts';

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

export function rawSubjectOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const f = input as Record<string, unknown>;
  const key = SUBJECT_KEYS.find(k => typeof f[k] === 'string' && f[k] !== '');
  return key !== undefined ? String(f[key]) : subjectOf(input);
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

type CopyState = 'idle' | 'copied' | 'failed';

class ToolLine implements Component {
  private tool = '';
  private subject = '';
  private meta = '';
  private copyText = '';
  private dot = '';
  private theme: any;
  private state: CopyState = 'idle';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hit: { start: number; end: number } | undefined;
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  update(tool: string, subject: string, meta: string, copyText: string, dot: string, theme: any): void {
    this.tool = tool;
    this.subject = subject;
    this.meta = meta;
    this.copyText = copyText;
    this.dot = dot;
    this.theme = theme;
  }

  private labelText(): string {
    if (this.state === 'copied') return this.theme.fg('success', '[copied]');
    if (this.state === 'failed') return this.theme.fg('error', '[copy failed]');
    return this.theme.fg('dim', '[copy]');
  }

  private lineText(): string {
    const meta = this.meta ? ' ' + this.theme.fg('error', `- ${this.meta}`) : '';
    return `${this.dot} ${this.theme.fg('dim', 'tool_call: ')}${this.theme.fg('toolTitle', this.theme.bold(this.tool))}${this.theme.fg('text', `(${this.subject})`)}${meta}`;
  }

  render(width: number): string[] {
    const prefix = this.lineText();
    const labelText = this.labelText();
    const full = ' ' + prefix + ' ' + labelText;
    if (width > 0 && visibleWidth(full) <= width) {
      const start = 1 + visibleWidth(prefix) + 1;
      this.hit = { start, end: start + visibleWidth(labelText) - 1 };
      return [full];
    }
    this.hit = undefined;
    return [truncateToWidth(' ' + prefix, width, '…')];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== 'click' || event.button !== 'left' || event.y !== 0) return undefined;
    const hit = this.hit;
    if (!hit || event.x < hit.start || event.x > hit.end || !this.copyText) return undefined;
    void copyToClipboard(this.copyText)
      .then(() => this.flash('copied'))
      .catch(() => this.flash('failed'));
    return { handled: true };
  }

  private flash(state: CopyState): void {
    this.state = state;
    this.requestRender();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.state = 'idle';
      this.requestRender();
    }, 1400);
    this.timer.unref?.();
  }

  invalidate(): void {}
}

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
        const line = ctx.lastComponent instanceof ToolLine ? ctx.lastComponent : new ToolLine(() => ctx.invalidate());
        line.update(p.tool, p.subject, p.meta, rawSubjectOf(args), dot, theme);
        return line as any;
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
