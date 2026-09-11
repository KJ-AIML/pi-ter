import type { TUI, OverlayHandle } from '@earendil-works/pi-tui';
import { terminalFrame } from './terminal-render.mjs';
import { fit } from '../workspace-view.ts';

export const blackLine = (line: string, width: number): string => '\x1b[40m' + fit(line, width).replaceAll('\x1b[0m', '\x1b[0m\x1b[40m') + '\x1b[0m';
export function splashFrame(time: number, width: number, rows: number, underlying: string[] = [], mode = 'braille'): string[] {
  const animation = terminalFrame(Math.min(time, 6), width, rows, { color: true, mode });
  const revealed = time >= 5.35 && underlying.length ? Math.floor(Math.min(1, (time - 5.35) / .65) * rows) : 0;
  return Array.from({ length: rows }, (_, i) => blackLine(i < revealed ? underlying[i] || '' : animation[i] || '', width));
}

export class HelloPiSplash {
  private timer?: ReturnType<typeof setInterval>;
  private handle?: OverlayHandle;
  constructor(private tui: TUI, private base: (width: number) => string[], private type: (text: string) => void) {}
  start(): void {
    this.dispose();
    if (process.env.PI_SPLASH === '0' || process.env.TERM === 'dumb' || process.env.NO_COLOR !== undefined) return;
    const requested = Number(process.env.PI_SPLASH_DURATION || 6);
    const duration = Number.isFinite(requested) ? Math.max(.2, Math.min(30, requested)) : 6;
    const start = performance.now();
    this.handle = this.tui.showOverlay({
      render: width => {
        const time = ((performance.now() - start) / 1000) * 6 / duration;
        return splashFrame(time, width, this.tui.terminal.rows, time >= 5.35 ? this.base(width) : [], process.env.PI_SPLASH_MODE === 'ascii' ? 'ascii' : 'braille');
      },
      invalidate() {},
      handleInput: data => {
        this.dispose();
        // A first typed prompt must not disappear into the loading screen.
        if (data && !/[\x00-\x1f\x7f]/.test(data)) this.type(data);
      },
    }, { width: '100%', maxHeight: '100%', row: 0, col: 0, margin: 0 });
    this.timer = setInterval(() => {
      if (performance.now() - start >= duration * 1000) this.dispose();
      else this.tui.requestRender();
    }, 1000 / 24);
    this.tui.requestRender();
  }
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.handle?.hide();
    this.handle = undefined;
    this.tui.requestRender();
  }
}
