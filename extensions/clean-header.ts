import { VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { randomInt } from 'node:crypto';
import type { TUI } from '@earendil-works/pi-tui';
import { accents, workspaceLines, type Resources } from './workspace-view.ts';
import { StartupResources } from './startup-resources.ts';
import { HelloPiSplash } from './hello-pi/splash.ts';

export class CleanHeader {
  private enabled = true;
  private expanded = true;
  private accent = accents[randomInt(accents.length)];
  private tui?: TUI;
  private adapter?: StartupResources;
  private splash?: HelloPiSplash;
  constructor(private pi: ExtensionAPI) {}
  attach(ctx: ExtensionContext): void {
    this.dispose();
    if (!ctx.hasUI || ctx.mode !== 'tui' || !this.enabled) return;
    this.expanded = !ctx.sessionManager.getBranch().some(entry => entry.type === 'message');
    this.accent = accents[randomInt(accents.length)];
    ctx.ui.setHeader((tui) => {
      this.tui = tui;
      const component = {
        render: (width: number): string[] => {
          this.adapter?.connect();
          const height = Math.max(2, tui.terminal.rows - (this.adapter?.remainingHeight(width) ?? 8));
          return workspaceLines(width, height, ctx.cwd, this.resources(), this.accent, VERSION, this.expanded);
        },
        invalidate() {},
        dispose: () => this.dispose(),
      };
      this.adapter = new StartupResources(tui, component, VERSION);
      this.splash = new HelloPiSplash(tui, width => this.adapter?.frame(width) || [], text => ctx.ui.setEditorText(ctx.ui.getEditorText() + text));
      return component;
    });
  }
  replay(): void { this.splash?.start(); }
  startSplash(): void { if (this.expanded) this.splash?.start(); }
  collapse(): void { this.splash?.dispose(); this.expanded = false; this.tui?.requestRender(); }
  resources(): Resources {
    const result = this.adapter?.snapshot() || { Skills: [], Extensions: [], Prompts: [], Context: [] };
    // quietStartup can omit Pi's rendered inventory; use actual registered commands.
    if (!result.Skills.length) result.Skills = this.pi.getCommands().filter(c => c.source === 'skill').map(c => c.name.replace(/^skill:/, ''));
    if (!result.Prompts.length) result.Prompts = this.pi.getCommands().filter(c => c.source === 'prompt').map(c => `/${c.name}`);
    return result;
  }
  async browse(args: string, ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== 'tui') return;
    const resources = this.resources();
    const key = Object.keys(resources).find(k => k.toLowerCase() === args.trim().toLowerCase()) as keyof Resources | undefined;
    const selected = key || await ctx.ui.select('Workspace resources', Object.keys(resources)) as keyof Resources | undefined;
    if (selected) await ctx.ui.select(`${selected} · ${resources[selected].length}`, resources[selected].length ? resources[selected] : ['None loaded']);
  }
  dispose(): void { this.splash?.dispose(); this.splash = undefined; this.adapter?.dispose(); this.adapter = undefined; }
  toggle(ctx: ExtensionContext): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.attach(ctx);
    else { this.dispose(); ctx.ui.setHeader(undefined); }
    this.tui?.requestRender();
    return this.enabled;
  }
  isEnabled(): boolean { return this.enabled; }
}
