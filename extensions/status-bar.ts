/**
 * Custom Status Bar for Pi
 *
 * Minimal monochrome footer: model · folder · branch · tokens · cache · mode.
 * Neutral greys with a single accent; see theme.ts.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { awakeController } from "./awake.ts";
import { THEME, accent, bold, faint, muted, rgb, text } from "./theme.ts";

const SEP = ` ${faint("│")} `;

// Helper to format token numbers (e.g. 52.2K, 360k)
function formatTokens(count: number): string {
  if (!count || count <= 0) return "0";
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) {
    const k = (count / 1000).toFixed(1);
    return `${k.endsWith(".0") ? k.slice(0, -2) : k}K`;
  }
  const m = (count / 1_000_000).toFixed(1);
  return `${m.endsWith(".0") ? m.slice(0, -2) : m}M`;
}

export interface StatusBarOptions {
  enabled?: boolean;
}

export class CustomStatusBar {
  private pi: ExtensionAPI;
  private enabled = true;
  private gitChangedCount = 0;
  private gitBranchFallback = "";
  private lastGitCheck = 0;
  private currentTui: any = null;

  constructor(pi: ExtensionAPI, options: StatusBarOptions = {}) {
    this.pi = pi;
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
  }

  /**
   * Check git dirty/changed files and branch (with target fallback)
   */
  public async refreshGitStatus(): Promise<void> {
    const now = Date.now();
    // Cache git status for 2.5 seconds
    if (now - this.lastGitCheck < 2500) return;
    this.lastGitCheck = now;

    try {
      // 1. Try local git in cwd
      const res = await this.pi.exec("git", ["status", "--porcelain"], { timeout: 2000 });
      if (res && res.code === 0 && typeof res.stdout === "string") {
        const lines = res.stdout.trim().split("\n").filter((l) => l.trim().length > 0);
        this.gitChangedCount = lines.length;
        const bRes = await this.pi.exec("git", ["branch", "--show-current"], { timeout: 1500 });
        if (bRes && bRes.code === 0 && bRes.stdout.trim()) {
          this.gitBranchFallback = bRes.stdout.trim();
        }
      } else {
        // 2. Fallback to target repo under repos/pi-ter
        const targetRes = await this.pi.exec("git", ["-C", "repos/pi-ter", "status", "--porcelain"], { timeout: 2000 });
        if (targetRes && targetRes.code === 0 && typeof targetRes.stdout === "string") {
          const lines = targetRes.stdout.trim().split("\n").filter((l) => l.trim().length > 0);
          this.gitChangedCount = lines.length;
          const targetBranch = await this.pi.exec("git", ["-C", "repos/pi-ter", "branch", "--show-current"], { timeout: 1500 });
          if (targetBranch && targetBranch.code === 0 && targetBranch.stdout.trim()) {
            this.gitBranchFallback = targetBranch.stdout.trim();
          }
        }
      }
    } catch {
      // ignore
    }

    if (this.currentTui) {
      this.currentTui.requestRender();
    }
  }

  /**
   * Attach the status bar to Pi's footer
   */
  public attach(ctx: ExtensionContext): void {
    if (!ctx.hasUI || ctx.mode !== "tui") return;

    void this.refreshGitStatus();

    ctx.ui.setFooter((tui, _theme, footerData) => {
      this.currentTui = tui;
      const unsubBranch = footerData.onBranchChange(() => {
        void this.refreshGitStatus();
        tui.requestRender();
      });

      return {
        dispose: () => {
          unsubBranch();
          this.currentTui = null;
        },
        invalidate() {},
        render: (width: number): string[] => {
          if (!this.enabled) {
            return [];
          }
          return this.renderStatusBar(ctx, footerData, width);
        },
      };
    });
  }

  /**
   * Request TUI to re-render status bar
   */
  public requestRender(): void {
    if (this.currentTui) {
      this.currentTui.requestRender();
    }
  }

  /**
   * Toggle between custom status bar and default footer
   */
  public toggle(ctx: ExtensionContext): boolean {
    this.enabled = !this.enabled;
    this.requestRender();
    return this.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Render the full powerline line
   */
  private renderStatusBar(ctx: ExtensionContext, footerData: any, width: number): string[] {
    // Model + thinking level
    const modelName = ctx.model?.name || ctx.model?.id || "Pi Model";
    const thinking = ctx.thinkingLevel && ctx.thinkingLevel !== "off" ? ` (${ctx.thinkingLevel})` : "";
    const segModel = `${accent(modelName)}${muted(thinking)}`;

    // Folder
    const segFolder = text(basename(ctx.cwd || process.cwd()));

    // Git branch + changed-file count
    const rawBranch = footerData.getGitBranch();
    const branch = rawBranch && rawBranch !== "no-git" ? rawBranch : (this.gitBranchFallback || "no-git");
    const segGit = muted(branch) + (this.gitChangedCount > 0 ? ` ${text(`+${this.gitChangedCount}`)}` : "");

    // Tokens: active context tokens vs context window, plus cumulative session total
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let latestContextTokens = 0;

    const sessionBranch = ctx.sessionManager.getBranch();
    for (let i = sessionBranch.length - 1; i >= 0; i--) {
      const entry = sessionBranch[i];
      if (entry.type === "message" && (entry.message as any)?.role === "assistant" && (entry.message as any)?.usage) {
        const u = (entry.message as any).usage;
        const ctxTokens = u.totalTokens || ((u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0));
        if (ctxTokens > 0) {
          latestContextTokens = ctxTokens;
          break;
        }
      }
    }

    for (const entry of sessionBranch) {
      if (entry.type === "message" && (entry.message as any)?.usage) {
        const u = (entry.message as any).usage;
        totalInput += u.input || 0;
        totalOutput += u.output || 0;
        totalCacheRead += u.cacheRead || 0;
      }
    }

    const sessionTotal = totalInput + totalOutput;
    if (latestContextTokens === 0) {
      latestContextTokens = sessionTotal;
    }

    const contextLimit = ctx.model?.contextWindow || 200_000;
    const segContext = `${text(formatTokens(latestContextTokens))}${muted(` / ${formatTokens(contextLimit)}`)}`;
    const segTotal = muted(`total ${formatTokens(sessionTotal)}`);

    // Cache hit rate, else context usage
    let pct = 0;
    let label = "ctx";
    if (totalCacheRead > 0 && totalInput > 0) {
      pct = Math.round((totalCacheRead / (totalInput + totalCacheRead)) * 100);
      label = "cache";
    } else if (contextLimit > 0) {
      pct = Math.round((latestContextTokens / contextLimit) * 100);
    }
    const segCache = muted(`${label} ${pct}%`);

    // Mode: only non-default states get color
    let segMode: string;
    if (awakeController.isOnFire()) {
      segMode = bold(rgb(THEME.warn, "ON FIRE"));
    } else if (process.env.HELI_YOLO === "1" || process.env.PI_YOLO === "1") {
      segMode = rgb(THEME.danger, "YOLO");
    } else {
      segMode = muted("strict");
    }

    const allSegments = [segModel, segFolder, segGit, segContext, segTotal, segCache, segMode];

    // Responsive truncation: drop lowest-value segments first
    const tiers = [
      allSegments,
      [segModel, segFolder, segGit, segContext, segTotal, segMode],
      [segModel, segFolder, segGit, segContext, segMode],
      [segModel, segFolder, segContext, segMode],
      [segModel, segFolder, segMode],
    ];
    let fullLine = tiers[tiers.length - 1].join(SEP);
    for (const tier of tiers) {
      const line = tier.join(SEP);
      if (visibleWidth(line) <= width) { fullLine = line; break; }
    }

    return [truncateToWidth(fullLine, width, "")];
  }
}
