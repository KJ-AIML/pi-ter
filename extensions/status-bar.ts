/**
 * Custom Status Bar for Pi
 *
 * Implements a powerline-style status bar in Pi's footer matching the reference design:
 * 🔖 › 🌸 Model + Thinking › 📁 Folder › ᚸ Branch + Changes › ⏱ Token/Context › 📦 Cache % › Agents: N › 🔥 ON FIRE / ❤️ YOLO / 🛡️ STRICT
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { awakeController } from "./awake.ts";

// Truecolor ANSI color helpers matching the reference palette
const colors = {
  reset: "\x1b[0m",
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
  hex: (hexStr: string, text: string) => {
    const num = parseInt(hexStr.replace("#", ""), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
  },
};

// Color palette definitions
const PALETTE = {
  bookmark: "#f59e0b",  // Gold / Amber
  separator: "#6272a4", // Dim slate gray
  model: "#ff79c6",     // Vibrant Pink / Magenta
  folder: "#2dd4bf",    // Cyan / Teal
  branch: "#f1fa8c",    // Soft Yellow
  gitCount: "#60a5fa",  // Sky Blue
  tokens: "#f8f8f2",    // Bright White
  cache: "#bd93f9",     // Lavender / Purple
  agents: "#e2e8f0",    // Off-white
  onFire: "#ff4500",    // Fiery Orange-Red
  yolo: "#ff5555",      // Coral Red
  strict: "#10b981",    // Emerald Green
};

// Separator glyph
const SEP = ` ${colors.hex(PALETTE.separator, "›")} `;

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
    // 1. Bookmark Segment
    const segBookmark = colors.hex(PALETTE.bookmark, "🔖");

    // 2. Model + Thinking Segment (e.g. 🌸 GPT-5.6 Sol High)
    const modelName = ctx.model?.name || ctx.model?.id || "Pi Model";
    const thinking = ctx.thinkingLevel && ctx.thinkingLevel !== "off"
      ? ` ${ctx.thinkingLevel.charAt(0).toUpperCase() + ctx.thinkingLevel.slice(1)}`
      : "";
    const segModel = colors.hex(PALETTE.model, `🌸 ${modelName}${thinking}`);

    // 3. Folder Segment (e.g. 📁 mimwb)
    const folderName = basename(ctx.cwd || process.cwd());
    const segFolder = colors.hex(PALETTE.folder, `📁 ${folderName}`);

    // 4. Git Branch + Change count Segment (e.g. ᚸ main 72)
    const rawBranch = footerData.getGitBranch();
    const branch = rawBranch && rawBranch !== "no-git"
      ? rawBranch
      : (this.gitBranchFallback || "no-git");
    const branchText = colors.hex(PALETTE.branch, `ᚸ ${branch}`);
    const changeCountText = this.gitChangedCount > 0
      ? ` ${colors.hex(PALETTE.gitCount, String(this.gitChangedCount))}`
      : "";
    const segGit = `${branchText}${changeCountText}`;

    // 5. Token Usage vs Context Window (e.g. ⏱ 52.2K/360k)
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && (entry.message as any)?.usage) {
        const u = (entry.message as any).usage;
        totalInput += u.input || 0;
        totalOutput += u.output || 0;
        totalCacheRead += u.cacheRead || 0;
      }
    }
    const currentTokens = totalInput + totalOutput;
    const contextLimit = ctx.model?.contextWindow || 200_000;
    const segTokens = colors.hex(
      PALETTE.tokens,
      `⏱ ${formatTokens(currentTokens)}/${formatTokens(contextLimit).toLowerCase()}`,
    );

    // 6. Cache Hit or Context Percentage Segment (e.g. 📦 ĸќ 95%)
    let pct = 0;
    let label = "ctx";
    if (totalCacheRead > 0 && totalInput > 0) {
      pct = Math.round((totalCacheRead / (totalInput + totalCacheRead)) * 100);
      label = "ĸќ";
    } else if (contextLimit > 0) {
      pct = Math.round((currentTokens / contextLimit) * 100);
      label = "cap";
    }
    const segCache = colors.hex(PALETTE.cache, `📦 ${label} ${pct}%`);

    // 7. Agents Count Segment (e.g. Agents: 1)
    const segAgents = colors.hex(PALETTE.agents, "Agents: 1");

    // 8. Mode Segment: ON FIRE (awake lock) vs YOLO vs STRICT
    let segMode: string;
    if (awakeController.isOnFire()) {
      segMode = colors.bold(colors.hex(PALETTE.onFire, "🔥 ON FIRE"));
    } else if (process.env.HELI_YOLO === "1" || process.env.PI_YOLO === "1") {
      segMode = colors.hex(PALETTE.yolo, "❤️ YOLO");
    } else {
      segMode = colors.hex(PALETTE.strict, "🛡️ STRICT");
    }

    // Build segments list in order
    const allSegments = [
      segBookmark,
      segModel,
      segFolder,
      segGit,
      segTokens,
      segCache,
      segAgents,
      segMode,
    ];

    // Responsive truncation
    let segments = [...allSegments];
    let fullLine = segments.join(SEP);

    if (visibleWidth(fullLine) > width) {
      // Drop Agents count
      segments = [segBookmark, segModel, segFolder, segGit, segTokens, segCache, segMode];
      fullLine = segments.join(SEP);
    }
    if (visibleWidth(fullLine) > width) {
      // Drop Cache %
      segments = [segBookmark, segModel, segFolder, segGit, segTokens, segMode];
      fullLine = segments.join(SEP);
    }
    if (visibleWidth(fullLine) > width) {
      // Drop Tokens
      segments = [segBookmark, segModel, segFolder, segGit, segMode];
      fullLine = segments.join(SEP);
    }
    if (visibleWidth(fullLine) > width) {
      // Minimal: Bookmark, Model, Folder, Mode
      segments = [segBookmark, segModel, segFolder, segMode];
      fullLine = segments.join(SEP);
    }

    return [truncateToWidth(fullLine, width, "")];
  }
}
