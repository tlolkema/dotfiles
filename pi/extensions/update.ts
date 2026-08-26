import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export default function updateExtension(pi: ExtensionAPI): void {
	pi.registerCommand("update", {
		description: "Update pi and extensions, then reload resources",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Updating pi and extensions…", "info");

			try {
				await exec("pi", ["update", "--all"]);
			} catch (error) {
				ctx.ui.notify(`Update failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			await ctx.reload();
			return;
		},
	});
}
