/**
 * Turns Markdown code fences into a compact code card: the language sits on the
 * left, a clickable [copy] sits on the right, and the block gets a subtle panel
 * background. Pi's Markdown component renders to strings, so this version-guarded
 * adapter marks the block during renderToken and turns those marks into hit
 * ranges and backgrounds during render.
 */
import { Markdown, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { copyToClipboard } from './tasks/clipboard.ts';

const PATCHED = Symbol.for('pi-ter.code-copy');
const HEADER = '\x1b_pi:pitercopy:h:';
const END = '\x1b_pi:pitercopy:e\x07';
const HEADER_RE = /\x1b_pi:pitercopy:h:([^\x07]+)\x07/;
const FLASH_MS = 1400;

type BlockHit = { y: number; start: number; end: number; id: string; text: string };
type CopyFlash = { id: string; until: number; ok: boolean };
type ThemeLike = {
  bg: (color: string, text: string) => string;
  fg: (color: string, text: string) => string;
};
type CopyState = {
  themeProvider?: () => ThemeLike | undefined;
  redraw?: () => void;
  copy?: (text: string) => Promise<unknown>;
};

// State lives on the prototype so /reload (which re-evaluates this module)
// keeps feeding the already-installed patch.
const STATE = Symbol.for('pi-ter.code-copy.state');

function stateOf(proto: any): CopyState {
  return (proto[STATE] ??= {});
}

/** Wired from session_start; the getter keeps theme switches live. */
export function setCodeCopyTheme(provider: () => ThemeLike | undefined): void {
  stateOf(Markdown.prototype as any).themeProvider = provider;
}

/** Markdown has no render callback, so borrow the status bar's TUI handle. */
export function setCodeCopyRenderer(render: () => void): void {
  stateOf(Markdown.prototype as any).redraw = render;
}

function requestRedraw(state: CopyState): void {
  try {
    state.redraw?.();
  } catch {
    // The session may be shutting down.
  }
}

function tint(theme: ThemeLike | undefined, color: string, text: string, fallback: (text: string) => string): string {
  try {
    return theme ? theme.fg(color, text) : fallback(text);
  } catch {
    return fallback(text);
  }
}

function paintLine(line: string, width: number, theme: ThemeLike | undefined, hasUserBackground: boolean): string {
  if (hasUserBackground || !theme) return line;
  const padded = line + ' '.repeat(Math.max(0, width - visibleWidth(line)));
  try {
    return theme.bg('customMessageBg', padded);
  } catch {
    return padded;
  }
}

function blockKey(index: number, text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${index}:${(hash >>> 0).toString(36)}`;
}

function copyLabel(
  flash: CopyFlash | undefined,
  id: string,
  theme: ThemeLike | undefined,
  fallback: (text: string) => string,
): string {
  const active = flash?.id === id && flash.until > Date.now();
  if (!active) return tint(theme, 'muted', '[copy]', fallback);
  return tint(theme, flash.ok ? 'success' : 'error', flash.ok ? '[copied]' : '[copy failed]', fallback);
}

export function installCodeCopy(copy: (text: string) => Promise<unknown> = copyToClipboard): void {
  const proto = Markdown.prototype as any;
  const state = stateOf(proto);
  state.copy = copy;
  if (proto[PATCHED]) return;
  if (typeof proto.render !== 'function' || typeof proto.renderToken !== 'function') return;

  const originalRender = proto.render;
  const originalRenderToken = proto.renderToken;
  let nextId = 0;

  proto.renderToken = function (token: any, width: number, nextTokenType?: string, styleContext?: any) {
    const lines = originalRenderToken.call(this, token, width, nextTokenType, styleContext);
    if (token?.type !== 'code' || typeof token.text !== 'string' || !Array.isArray(lines) || lines.length < 2) return lines;
    const id = blockKey(nextId++, token.text);
    const blocks: Map<string, string> = (this.__piterCodeBlocks ??= new Map());
    blocks.set(id, token.text);
    const closeIndex = nextTokenType && nextTokenType !== 'space' ? lines.length - 2 : lines.length - 1;
    if (closeIndex < 1) return lines;
    const indent = this.theme?.codeBlockIndent ?? '  ';
    const border = this.theme?.codeBlockBorder ?? ((text: string) => text);
    const out = [...lines];
    out[0] = `${indent}${border(token.lang || 'code')}${HEADER}${id}\x07`;
    out[closeIndex] = END;
    return out;
  };

  proto.render = function (width: number) {
    // Positional ids plus a text hash keep a block stable across re-renders (including the flash).
    nextId = 0;
    if (this.__piterText !== this.text || this.__piterWidth !== width) {
      this.__piterText = this.text;
      this.__piterWidth = width;
      this.__piterCodeBlocks = new Map();
    } else {
      this.__piterCodeBlocks ??= new Map();
    }
    const lines = originalRender.call(this, width);
    const blocks: Map<string, string> | undefined = this.__piterCodeBlocks;
    if (!blocks || !Array.isArray(lines)) return lines;

    let theme: ThemeLike | undefined;
    try { theme = state.themeProvider?.(); } catch { theme = undefined; }
    const hasUserBackground = Boolean(this.defaultTextStyle?.bgColor);
    const fallback = this.theme?.codeBlockBorder ?? ((text: string) => text);
    const hits: BlockHit[] = [];
    const out: string[] = [];
    let inCode = false;

    for (let y = 0; y < lines.length; y++) {
      const raw = lines[y];
      if (typeof raw !== 'string') { out.push(raw); continue; }

      if (raw.includes(END)) {
        inCode = false;
        continue;
      }

      const marker = HEADER_RE.exec(raw);
      if (marker) {
        const id = marker[1];
        const text = blocks.get(id);
        const clean = raw.replace(HEADER_RE, '');
        inCode = true;
        if (text === undefined) { out.push(paintLine(clean, width, theme, hasUserBackground)); continue; }

        const label = copyLabel(this.__piterCopyFlash, id, theme, fallback);
        const labelWidth = visibleWidth(label);
        if (width < labelWidth + 2) {
          out.push(paintLine(clean, width, theme, hasUserBackground));
          continue;
        }

        let line: string;
        let start: number;
        if (hasUserBackground) {
          const room = width - labelWidth - 1;
          const prefix = truncateToWidth(clean, room, '');
          line = prefix + ' ' + label;
          start = visibleWidth(prefix) + 1;
        } else {
          const content = clean.replace(/ +$/, '');
          const prefix = truncateToWidth(content, width - labelWidth - 1, '');
          const gap = Math.max(1, width - visibleWidth(prefix) - labelWidth);
          line = prefix + ' '.repeat(gap) + label;
          start = width - labelWidth - 1;
        }
        line += ' '.repeat(Math.max(0, width - visibleWidth(line)));
        hits.push({ y, start: Math.max(0, start), end: width - 1, id, text });
        out.push(paintLine(line, width, theme, hasUserBackground));
        continue;
      }

      if (inCode) {
        out.push(paintLine(raw, width, theme, hasUserBackground));
        continue;
      }

      out.push(raw);
    }

    this.__piterCopyHits = hits;
    return out;
  };

  proto.handleMouse = function (event: any) {
    if (event?.type !== 'click' || event?.button !== 'left') return undefined;
    const hits: BlockHit[] | undefined = this.__piterCopyHits;
    const hit = hits?.find(h => h.y === event.y && event.x >= h.start && event.x <= h.end);
    if (!hit) return undefined;
    // Show the confirmation on the click's own render; downgrade if the copy rejects.
    this.__piterFlashCopy(hit.id, true);
    const doCopy = state.copy ?? copy;
    void Promise.resolve()
      .then(() => doCopy(hit.text))
      .then(() => undefined, () => this.__piterFlashCopy(hit.id, false));
    return { handled: true };
  };

  proto.__piterFlashCopy = function (id: string, ok: boolean) {
    if (this.__piterCopyTimer) clearTimeout(this.__piterCopyTimer);
    this.__piterCopyFlash = { id, until: Date.now() + FLASH_MS, ok };
    this.invalidate();
    requestRedraw(state);
    this.__piterCopyTimer = setTimeout(() => {
      if (this.__piterCopyFlash?.id !== id) return;
      this.__piterCopyFlash = undefined;
      this.invalidate();
      requestRedraw(state);
    }, FLASH_MS);
    this.__piterCopyTimer.unref?.();
  };

  proto[PATCHED] = true;
}
