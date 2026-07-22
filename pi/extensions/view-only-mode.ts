import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type Mode = "default" | "view-only";

function parseMode(args?: string): Mode | "toggle" | undefined {
	const value = args?.trim().toLowerCase();
	if (!value) return "toggle";
	if (value === "default") return "default";
	if (value === "view" || value === "view-only" || value === "view only") return "view-only";
	return undefined;
}

export default function viewOnlyModeExtension(pi: ExtensionAPI): void {
	let mode: Mode = "default";

	function updateUi(_ctx: ExtensionContext): void {
		pi.events.emit("view-only-mode:change", { enabled: mode === "view-only" });
	}

	function setMode(nextMode: Mode, ctx: ExtensionContext): void {
		mode = nextMode;
		updateUi(ctx);
		ctx.ui.notify(mode === "view-only" ? "View only mode enabled" : "Default mode restored", "info");
	}

	pi.registerCommand("view", {
		description: 'Set mode: /view "view only" or /view default',
		handler: async (args, ctx) => {
			const parsed = parseMode(args);
			if (!parsed) {
				ctx.ui.notify('Usage: /view "view only" or /view default', "warning");
				return;
			}

			if (parsed === "toggle") {
				setMode(mode === "view-only" ? "default" : "view-only", ctx);
				return;
			}

			setMode(parsed, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		updateUi(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (mode !== "view-only") {
			return undefined;
		}

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nView only mode is enabled. You must not call tools that modify files or write to disk. Read-only inspection and non-editing tools are allowed.",
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (mode !== "view-only") {
			return undefined;
		}

		if (event.toolName === "edit" || event.toolName === "write") {
			ctx.ui.notify(`Blocked ${event.toolName} in view only mode`, "warning");
			return { block: true, reason: `Tool ${event.toolName} is not allowed in view only mode` };
		}

		return undefined;
	});
}
