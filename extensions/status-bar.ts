/**
 * Custom Status Bar for Pi
 *
 * Implements a powerline-style status bar in Pi's footer matching the reference design:
 * 🔖 › 🌸 Model + Thinking › 📁 Folder › ᚸ Branch + Changes › ⏱ Token/Context › 📦 Cache % › Agents: N › ❤️ YOLO
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";

// Truecolor ANSI color helpers matching the reference palette
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Hex to truecolor foreground
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
  glyphSeparator?: string;
  showAgents?: boolean;
  showYolo?: boolean;
}

export class CustomStatusBar {
  private pi: ExtensionAPI;
  private enabled = true;
  private gitChangedCount = 0;
  private lastGitCheck = 0;
  private currentTui: any = null;

  constructor(pi: ExtensionAPI, options: StatusBarOptions = {}) {
    this.pi = pi;
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
  }

  /**
   * Periodically check git dirty/changed files without blocking render
   */
  private async refreshGitStatus(): Promise<void> {
    const now = Date.now();
    // Cache git status for 3 seconds
    if (now - this.lastGitCheck < 3000) return;
    this.lastGitCheck = now;

    try {
      const res = await this.pi.exec("git", ["status", "--porcelain"], { timeout: 2000 });
      if (res && res.code === 0 && typeof res.stdout === "string") {
        const lines = res.stdout.trim().split("\n").filter((l) => l.trim().length > 0);
        this.gitChangedCount = lines.length;
      } else {
        this.gitChangedCount = 0;
      }
    } catch {
      this.gitChangedCount = 0;
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

    // Refresh git status initially
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
   * Toggle between custom status bar and default footer
   */
  public toggle(ctx: ExtensionContext): boolean {
    this.enabled = !this.enabled;
    if (this.currentTui) {
      this.currentTui.requestRender();
    }
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
    const branch = footerData.getGitBranch() || "no-git";
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

    // 8. YOLO / Safety Mode Segment (e.g. ❤️ YOLO)
    const isYolo = process.env.HELI_YOLO === "1" || process.env.PI_YOLO === "1";
    const segYolo = isYolo
      ? colors.hex(PALETTE.yolo, "❤️ YOLO")
      : colors.hex(PALETTE.strict, "🛡️ STRICT");

    // Build segments list in order
    const allSegments = [
      segBookmark,
      segModel,
      segFolder,
      segGit,
      segTokens,
      segCache,
      segAgents,
      segYolo,
    ];

    // Check if everything fits; if not, progressively drop less critical segments
    let segments = [...allSegments];
    let fullLine = segments.join(SEP);

    if (visibleWidth(fullLine) > width) {
      // Step 1: Drop Agents count
      segments = [segBookmark, segModel, segFolder, segGit, segTokens, segCache, segYolo];
      fullLine = segments.join(SEP);
    }
    if (visibleWidth(fullLine) > width) {
      // Step 2: Drop Cache %
      segments = [segBookmark, segModel, segFolder, segGit, segTokens, segYolo];
      fullLine = segments.join(SEP);
    }
    if (visibleWidth(fullLine) > width) {
      // Step 3: Drop YOLO tag
      segments = [segBookmark, segModel, segFolder, segGit, segTokens];
      fullLine = segments.join(SEP);
    }
    if (visibleWidth(fullLine) > width) {
      // Step 4: Drop Tokens
      segments = [segBookmark, segModel, segFolder, segGit];
      fullLine = segments.join(SEP);
    }

    // Final safety truncate to width so it never breaks terminal boundary
    const outputLine = truncateToWidth(fullLine, width, "");
    return [outputLine];
  }
}
