import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTasks } from "./tasks/index.ts";
import { awakeController } from "./awake.ts";
import { CleanHeader } from "./clean-header.ts";
import { CustomStatusBar } from "./status-bar.ts";

export default function (pi: ExtensionAPI) {
  registerTasks(pi);
  const statusBar = new CustomStatusBar(pi);
  const cleanHeader = new CleanHeader(pi);

  // Attach clean header and status bar on session start
  pi.on("session_start", async (_event, ctx) => {
    cleanHeader.attach(ctx);
    statusBar.attach(ctx);
    cleanHeader.startSplash();
  });

  pi.on("input", async () => { cleanHeader.collapse(); return { action: "continue" as const }; });
  pi.on("before_agent_start", async () => { cleanHeader.collapse(); });
  pi.registerCommand("workspace", {
    description: "Browse loaded skills, extensions, prompts and context",
    handler: async (args, ctx) => cleanHeader.browse(args, ctx),
  });
  pi.registerCommand("hello-pi", {
    description: "Replay the Hello PI startup animation",
    handler: async (_args, ctx) => { cleanHeader.replay(); },
  });

  // Keep computer awake while Pi is actively thinking, tool-calling, or streaming
  pi.on("turn_start", async (_event, _ctx) => {
    awakeController.setBusy(true);
    statusBar.requestRender();
  });

  pi.on("turn_end", async (_event, _ctx) => {
    awakeController.setBusy(false);
    void statusBar.refreshGitStatus();
    statusBar.requestRender();
  });

  // Ensure sleep locks are released when session ends
  pi.on("session_shutdown", async (_event, _ctx) => {
    cleanHeader.dispose();
    awakeController.dispose();
  });

  // Command to toggle ON FIRE mode (keep computer awake continuously)
  pi.registerCommand("fire", {
    description: "Toggle ON FIRE mode (prevents computer from sleeping)",
    handler: async (_args, ctx) => {
      const active = awakeController.toggleOnFire();
      statusBar.requestRender();
      if (active) {
        ctx.ui.notify("🔥 ON FIRE mode ACTIVATED: Sleep prevented while active!", "info");
      } else {
        ctx.ui.notify("❄️ ON FIRE mode DEACTIVATED: Normal sleep restored.", "info");
      }
    },
  });

  // Command to toggle custom powerline status bar
  pi.registerCommand("statusbar", {
    description: "Toggle custom powerline status bar (on/off)",
    handler: async (_args, ctx) => {
      const active = statusBar.toggle(ctx);
      ctx.ui.notify(`Custom status bar: ${active ? "enabled" : "disabled"}`, "info");
    },
  });

  // Command to toggle clean minimalist header
  pi.registerCommand("header", {
    description: "Toggle Workspace welcome screen vs built-in header",
    handler: async (_args, ctx) => {
      const active = cleanHeader.toggle(ctx);
      ctx.ui.notify(`Clean header: ${active ? "enabled (Workspace)" : "disabled (built-in)"}`, "info");
    },
  });

  // Register the piter root command
  pi.registerCommand("piter", {
    description: "Inspect or test pi-ter plugin status",
    handler: async (args, ctx) => {
      const subcommand = (args || "").trim();
      if (subcommand === "ping") {
        ctx.ui.notify("pi-ter: pong!", "info");
        return;
      }
      if (subcommand === "fire") {
        const active = awakeController.toggleOnFire();
        statusBar.requestRender();
        ctx.ui.notify(`🔥 ON FIRE mode: ${active ? "ON (awake lock active)" : "OFF"}`, "info");
        return;
      }
      if (subcommand === "statusbar") {
        const active = statusBar.toggle(ctx);
        ctx.ui.notify(`Custom status bar: ${active ? "enabled" : "disabled"}`, "info");
        return;
      }
      if (subcommand === "header") {
        const active = cleanHeader.toggle(ctx);
        ctx.ui.notify(`Clean header: ${active ? "enabled" : "disabled"}`, "info");
        return;
      }
      ctx.ui.notify(
        `pi-ter active. Subcommands: header, statusbar, fire (awake: ${awakeController.isOnFire() ? "ON" : "OFF"}), ping`,
        "info",
      );
    },
  });

  // Register an experimental custom tool
  pi.registerTool({
    name: "piter_inspect",
    label: "Piter Inspect",
    description: "Inspection helper for pi-ter experiments",
    parameters: Type.Object({
      topic: Type.String({ description: "Topic or experiment identifier to inspect" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return {
        content: [
          {
            type: "text",
            text: `[pi-ter] Inspection topic: ${params.topic} - ready for experimentation.`,
          },
        ],
        details: {
          topic: params.topic,
          onFire: awakeController.isOnFire(),
          timestamp: new Date().toISOString(),
        },
      };
    },
  });
}
