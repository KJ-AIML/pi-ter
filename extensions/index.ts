import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CustomStatusBar } from "./status-bar.ts";

export default function (pi: ExtensionAPI) {
  const statusBar = new CustomStatusBar(pi);

  // Announce extension and attach status bar on session start
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("pi-ter extension & custom status bar loaded", "info");
    statusBar.attach(ctx);
  });

  // Re-render status bar when model changes
  pi.on("model_select", async (_event, _ctx) => {
    // Model change triggers auto re-render in TUI
  });

  // Register command to toggle custom status bar
  pi.registerCommand("statusbar", {
    description: "Toggle custom powerline status bar (on/off)",
    handler: async (_args, ctx) => {
      const active = statusBar.toggle(ctx);
      ctx.ui.notify(`Custom status bar: ${active ? "enabled" : "disabled"}`, "info");
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
      if (subcommand === "statusbar") {
        const active = statusBar.toggle(ctx);
        ctx.ui.notify(`Custom status bar: ${active ? "enabled" : "disabled"}`, "info");
        return;
      }
      ctx.ui.notify(
        `pi-ter is active. Subcommands: ping, statusbar (current: ${statusBar.isEnabled() ? "on" : "off"})`,
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
        details: { topic: params.topic, timestamp: new Date().toISOString() },
      };
    },
  });
}
