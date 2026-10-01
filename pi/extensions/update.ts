import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";

const valueOptions = new Set([
	"--mode", "--provider", "--model", "--api-key", "--system-prompt", "--append-system-prompt",
	"--name", "-n", "--session", "--session-id", "--fork", "--session-dir", "--models",
	"--tools", "-t", "--exclude-tools", "-xt", "--thinking", "--extension", "-e", "--skill",
	"--prompt-template", "--theme", "--use-theme", "--tui-mode",
]);
const booleanOptions = new Set([
	"--continue", "-c", "--resume", "-r", "--no-session", "--no-tools", "-nt",
	"--no-builtin-tools", "-nbt", "--no-extensions", "-ne", "--no-skills", "-ns",
	"--no-prompt-templates", "-np", "--no-themes", "--no-context-files", "-nc",
	"--verbose", "--approve", "-a", "--no-approve", "-na", "--offline",
]);
const replacedOptions = new Set([
	"--continue", "-c", "--resume", "-r", "--no-session", "--session", "--session-id",
	"--fork", "--session-dir", "--name", "-n", "--provider", "--model", "--thinking",
]);

function getRestartOptions(args: string[]): string[] {
	const options: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") break;
		// Do not replay initial prompts or @file inputs after restarting.
		if (!arg.startsWith("-")) continue;

		const next = args[i + 1];
		const hasValue = valueOptions.has(arg) || (
			arg.startsWith("--") && !arg.includes("=") && !booleanOptions.has(arg) &&
			next !== undefined && !next.startsWith("-") && !next.startsWith("@")
		);
		if (hasValue) i++;
		if (replacedOptions.has(arg)) continue;
		options.push(arg);
		if (hasValue && next !== undefined) options.push(next);
	}
	return options;
}

export default function updateExtension(pi: ExtensionAPI): void {
	pi.registerCommand("update", {
		description: "Update pi and extensions, then restart in the same session",
		handler: async (_args, ctx) => {
			const execve = process.execve;
			if (ctx.mode !== "tui" || !execve || !process.argv[1]) {
				ctx.ui.notify("Run `pi update --all` outside Pi, then restart. Automatic restart requires a POSIX terminal and Node.js 22.15+.", "warning");
				return;
			}
			if (!ctx.sessionManager.getSessionFile()) {
				ctx.ui.notify("Update skipped: this session is not saved and would be lost on restart. Run `pi update --all` after exiting.", "warning");
				return;
			}
			if (ctx.hasPendingMessages()) {
				ctx.ui.notify("Finish queued messages before running /update.", "warning");
				return;
			}

			await ctx.waitForIdle();
			const sessionFile = ctx.sessionManager.getSessionFile()!;
			const options = getRestartOptions(process.argv.slice(2));
			options.push("--session-dir", ctx.sessionManager.getSessionDir());
			if (existsSync(sessionFile)) {
				options.push("--session", sessionFile);
			} else {
				// A fresh session has no file until its first conversation message.
				options.push("--session-id", ctx.sessionManager.getSessionId());
			}
			if (ctx.model) options.push("--provider", ctx.model.provider, "--model", ctx.model.id);
			options.push("--thinking", pi.getThinkingLevel());
			const argv = [process.execPath, ...process.execArgv, process.argv[1], ...options];

			ctx.ui.notify("Updating pi and extensions…", "info");
			try {
				const result = await pi.exec("pi", ["update", "--all"], { cwd: ctx.cwd });
				if (result.code !== 0 || result.killed) {
					throw new Error(result.stderr.trim() || result.stdout.trim() || `Exit code ${result.code}`);
				}
			} catch (error) {
				ctx.ui.notify(`Update failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			ctx.ui.notify("Updated. Restarting pi in the same session…", "info");
			// /reload only replaces resources. Updating Pi replaces lazy-loaded bundle
			// chunks, so the old process cannot safely make another model request.
			// Wait for graceful shutdown to restore the terminal and clean up extensions,
			// then replace the process, preserving its PID and terminal ownership.
			process.once("exit", (code) => {
				if (code !== 0) return;
				try {
					execve(process.execPath, argv, process.env);
				} catch (error) {
					process.stderr.write(`Could not restart pi: ${error instanceof Error ? error.message : String(error)}\nRun pi --session ${JSON.stringify(sessionFile)} to resume.\n`);
				}
			});
			ctx.shutdown();
		},
	});
}
