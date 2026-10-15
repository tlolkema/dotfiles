/**
 * Custom Footer Extension
 *
 * Shows a configurable footer with:
 *   LEFT:  token usage · cost · context usage %
 *   RIGHT: cwd · thinking level · extension statuses · git branch · model + session limit
 *
 * Toggle with /footer. Configure which items appear by editing FOOTER_CONFIG below.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as path from "node:path";
import { fetchSessionLimit, formatSessionLimit, supportsSessionLimit, type SessionLimit } from "./usage.ts";

// ─── Configuration ────────────────────────────────────────────────────────────
// Set any item to `false` to hide it from the footer.
const FOOTER_CONFIG = {
  showTokens: true, // ↑in ↓out
  showCost: false, // $0.012
  showContextUsage: true, // 42% ctx
  showCwd: true, // ~/work/my-project
  showThinkingLevel: true, // thinking: low
  showMode: false,
  showStatuses: true, // extension status pills
  showGitBranch: true, // (main)
  showModel: true, // claude-sonnet-4-6
  showSessionLimit: true, // OpenAI/Codex: 70% 4h32m
};
// ─────────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let planModeEnabled = false;
  let planExecutionMode = false;
  let viewOnlyEnabled = false;
  let stopFooter = () => {};
  let refreshUsage = () => {};

  // Track plan mode state from the plan-mode extension via the event bus
  pi.events.on("plan-mode:change", (data) => {
    const d = data as { planModeEnabled: boolean; executionMode: boolean };
    planModeEnabled = d.planModeEnabled;
    planExecutionMode = d.executionMode;
  });

  pi.events.on("view-only-mode:change", (data) => {
    const d = data as { enabled: boolean };
    viewOnlyEnabled = d.enabled;
  });

  function applyFooter(ctx: ExtensionContext) {
    stopFooter();
    if (!ctx.hasUI) return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      const controller = new AbortController();
      let sessionLimit: SessionLimit | undefined;
      let pending = false;
      let lastRefresh = 0;
      const provider = ctx.model?.provider;
      const showLimit = FOOTER_CONFIG.showModel && FOOTER_CONFIG.showSessionLimit && supportsSessionLimit(provider);
      refreshUsage = () => {
        if (!showLimit || pending || controller.signal.aborted || Date.now() - lastRefresh < 15_000) return;
        pending = true;
        lastRefresh = Date.now();
        void fetchSessionLimit(
          provider,
          (name) => ctx.modelRegistry.getApiKeyForProvider(name),
          controller.signal,
        ).catch(() => undefined).then((limit) => {
          if (controller.signal.aborted) return;
          sessionLimit = limit;
          tui.requestRender();
        }).finally(() => { pending = false; });
      };
      // Fetch outside render and keep the quota/countdown current while idle.
      const timer = showLimit ? setInterval(refreshUsage, 60_000) : undefined;
      timer?.unref();
      refreshUsage();
      const dispose = () => {
        if (controller.signal.aborted) return;
        controller.abort();
        clearInterval(timer);
        unsub();
      };
      stopFooter = dispose;

      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const cfg = FOOTER_CONFIG;
          const accent = (s: string) => theme.fg("accent", s);
          const dim = (s: string) => theme.fg("dim", s);
          const muted = (s: string) => theme.fg("muted", s);

          // ── Token / cost stats ───────────────────────────────────────
          let inputTokens = 0,
            outputTokens = 0,
            cost = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              inputTokens += m.usage.input;
              outputTokens += m.usage.output;
              cost += m.usage.cost.total;
            }
          }
          const fmt = (n: number) =>
            n === 0 ? "0" : n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;

          // ── Context usage ────────────────────────────────────────────
          let ctxStr = "";
          if (cfg.showContextUsage) {
            const usage = ctx.getContextUsage();
            if (usage && usage.tokens !== null && usage.contextWindow > 0) {
              const pct = Math.round(
                (usage.tokens / usage.contextWindow) * 100,
              );
              const color =
                pct >= 80 ? "error" : pct >= 60 ? "warning" : "accent";
              ctxStr = theme.fg(color, `${pct}%`) + dim(" ctx");
            }
          }

          // ── Left side ────────────────────────────────────────────────
          const leftParts: string[] = [];

          if (cfg.showTokens) {
            leftParts.push(
              accent(`↑${fmt(inputTokens)}`) +
                dim(" in ") +
                accent(`↓${fmt(outputTokens)}`) +
                dim(" out"),
            );
          }
          if (cfg.showCost) {
            leftParts.push(accent(`$${cost.toFixed(3)}`));
          }
          if (ctxStr) {
            leftParts.push(ctxStr);
          }

          const left = leftParts.join(dim("  ·  "));

          // ── Right side ───────────────────────────────────────────────
          const rightParts: string[] = [];

          if (cfg.showCwd) {
            const home = process.env["HOME"] ?? "";
            let cwd = ctx.cwd;
            if (home && cwd.startsWith(home)) {
              cwd = "~" + cwd.slice(home.length);
            }
            // Only show last 2 path segments to keep it concise
            const segments = cwd.split(path.sep).filter(Boolean);
            const short =
              segments.length > 2
                ? "…" + path.sep + segments.slice(-2).join(path.sep)
                : cwd;
            rightParts.push(muted(short));
          }

          if (cfg.showThinkingLevel) {
            rightParts.push(muted(`thinking: ${pi.getThinkingLevel()}`));
          }

          if (cfg.showMode) {
            if (planExecutionMode) {
              rightParts.push(theme.fg("warning", "executing plan"));
            } else if (planModeEnabled) {
              rightParts.push(theme.fg("warning", "plan mode"));
            } else {
              rightParts.push(theme.fg("success", "normal mode"));
            }
          }

          if (cfg.showStatuses) {
            const statuses = footerData.getExtensionStatuses();
            for (const [, text] of statuses) {
              if (text) rightParts.push(text);
            }
          }

          if (cfg.showGitBranch) {
            const branch = footerData.getGitBranch();
            if (branch) rightParts.push(accent(`(${branch})`));
          }

          if (cfg.showModel) {
            const modelId = ctx.model?.id ?? "no-model";
            const limit = showLimit ? formatSessionLimit(sessionLimit) : "";
            rightParts.push(muted(modelId + (limit ? ` (${limit})` : "")));
          }

          if (viewOnlyEnabled) {
            rightParts.push(accent("view only"));
          }

          const right = rightParts.join(dim("  ·  "));

          // ── Compose line ─────────────────────────────────────────────
          const lw = visibleWidth(left);
          const rw = visibleWidth(right);
          const gap = Math.max(1, width - lw - rw);
          const line = left + " ".repeat(gap) + right;

          return [truncateToWidth(line, width)];
        },
      };
    });
  }

  // Install footer on session start
  pi.on("session_start", async (_event, ctx) => {
    if (enabled) applyFooter(ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    if (enabled) applyFooter(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    if (enabled) applyFooter(ctx);
  });

  pi.on("agent_end", async () => {
    if (enabled) refreshUsage();
  });

  pi.on("session_shutdown", async () => {
    stopFooter();
  });

  // Toggle command
  pi.registerCommand("footer", {
    description: "Toggle the custom footer on/off",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        applyFooter(ctx);
        ctx.ui.notify("Custom footer enabled", "info");
      } else {
        stopFooter();
        ctx.ui.setFooter(undefined);
        ctx.ui.notify("Default footer restored", "info");
      }
    },
  });
}
