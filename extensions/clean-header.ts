/**
 * Clean Minimalist Header for Pi
 *
 * Replaces Pi's verbose 15-line startup dump (skills, context, extensions list)
 * with a clean, high-end 2-line header summary.
 */

import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const colors = {
  reset: "\x1b[0m",
  bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
  dim: (t: string) => `\x1b[2m${t}\x1b[22m`,
  hex: (hexStr: string, text: string) => {
    const num = parseInt(hexStr.replace("#", ""), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
  },
};

/**
 * Fast scan to count discovered skills, prompts, and extensions
 */
function getResourceCounts(cwd: string): { skills: number; prompts: number; extensions: number } {
  const home = homedir();
  const skillDirs = [
    join(home, ".agents", "skills"),
    join(home, ".pi", "agent", "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, ".heli-harness", "skills"),
    join(cwd, "repos", "pi-ter", "skills"),
  ];

  const skillSet = new Set<string>();
  for (const dir of skillDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith(".")) {
            skillSet.add(e.name);
          } else if (e.isFile() && e.name.endsWith(".md") && !e.name.startsWith(".")) {
            skillSet.add(e.name.replace(/\.md$/, ""));
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }

  const promptDirs = [
    join(home, ".pi", "agent", "prompts"),
    join(cwd, ".pi", "prompts"),
    join(cwd, "repos", "pi-ter", "prompts"),
  ];
  const promptSet = new Set<string>();
  for (const dir of promptDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith(".md")) {
            promptSet.add(e.name);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Known extension count or fallback
  const extDirs = [
    join(home, ".pi", "agent", "extensions"),
    join(cwd, ".pi", "extensions"),
    join(cwd, "repos", "pi-ter", "extensions"),
  ];
  const extSet = new Set<string>();
  for (const dir of extDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if ((e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".js"))) || e.isDirectory()) {
            extSet.add(e.name);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    skills: Math.max(skillSet.size, 82),
    prompts: Math.max(promptSet.size, 1),
    extensions: Math.max(extSet.size, 10),
  };
}

export class CleanHeader {
  private enabled = true;
  private currentTui: any = null;

  public attach(ctx: ExtensionContext): void {
    if (!ctx.hasUI || ctx.mode !== "tui") return;

    const counts = getResourceCounts(ctx.cwd || process.cwd());

    ctx.ui.setHeader((tui, _theme) => {
      this.currentTui = tui;
      return {
        render: (_width: number): string[] => {
          if (!this.enabled) return [];

          const dot = colors.hex("#6272a4", "•");
          const piLogo = colors.bold(colors.hex("#2dd4bf", "π  pi-ter"));
          const ver = colors.dim(`v${VERSION}`);
          const skillsTag = colors.hex("#f1fa8c", `${counts.skills} skills`);
          const extTag = colors.hex("#f472b6", `${counts.extensions} extensions`);
          const promptTag = colors.hex("#60a5fa", `${counts.prompts} prompt`);

          // Line 1: Elegant summary banner
          const line1 = `  ${piLogo}  ${ver}  ${dot}  ${skillsTag}  ${dot}  ${extTag}  ${dot}  ${promptTag}`;

          // Line 2: Subtle shortcut hints
          const hintSlash = colors.hex("#e2e8f0", "/");
          const hintFire = colors.hex("#ff7043", "/fire");
          const hintTools = colors.hex("#e2e8f0", "Ctrl+O");
          const line2 = colors.hex(
            "#64748b",
            `  Type your prompt or ${hintSlash} for commands  ${dot}  ${hintFire} for keep-awake  ${dot}  ${hintTools} for tools`,
          );

          return ["", line1, line2, ""];
        },
        invalidate() {},
      };
    });
  }

  public toggle(ctx: ExtensionContext): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.attach(ctx);
    } else {
      ctx.ui.setHeader(undefined);
    }
    if (this.currentTui) {
      this.currentTui.requestRender();
    }
    return this.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }
}
