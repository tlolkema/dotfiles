import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, McpServerConfig, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { parse } from "smol-toml";

export function findManifest(cwd: string): string | undefined {
	let directory = resolve(cwd);
	while (true) {
		const file = join(directory, "agents.toml");
		if (existsSync(file)) return realpathSync(file);
		const parent = dirname(directory);
		if (existsSync(join(directory, ".git")) || parent === directory) return;
		directory = parent;
	}
}

export function serverConfig(entry: any, directory: string): McpServerConfig {
	if (typeof entry?.name !== "string") throw new Error("MCP entry needs a name");
	if (Boolean(entry.command) === Boolean(entry.url)) {
		throw new Error(`${entry.name}: specify either command or url`);
	}
	if (entry.url) return { url: entry.url, headers: entry.headers, exposure: "deferred" };
	const variables = entry.env ?? [];
	if (!Array.isArray(variables) || variables.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
		throw new Error(`${entry.name}: env must be an array of environment variable names`);
	}
	return {
		command: entry.command,
		args: entry.args,
		cwd: directory,
		env: Object.fromEntries(variables.map((name) => [name, `\${${name}}`])),
		exposure: "deferred",
	};
}

export default function agentsMcp(pi: ExtensionAPI, trust: Pick<ProjectTrustStore, "get">) {
	const registered = new Set<string>();
	function clear() {
		for (const name of registered) pi.unregisterMcpServer(name);
		registered.clear();
	}
	pi.on("session_shutdown", clear);
	pi.on("session_start", (_event, ctx) => {
		clear();
		try {
			const file = findManifest(ctx.cwd);
			if (!file) return;
			const directory = dirname(file);
			// Pi can report trusted when no native project resources exist. Require saved trust too.
			if (!ctx.isProjectTrusted() || trust.get(ctx.cwd) !== true || trust.get(directory) !== true) {
				ctx.ui.notify(`Skipped ${file} MCP servers. Save project trust with /trust, then /reload.`, "warning");
				return;
			}
			const entries = parse(readFileSync(file, "utf8")).mcp ?? [];
			if (!Array.isArray(entries)) throw new Error("mcp must contain [[mcp]] entries");
			for (const entry of entries) {
				try {
					const config = serverConfig(entry, directory);
					const name = (entry as { name: string }).name;
					pi.registerMcpServer(name, config);
					registered.add(name);
				} catch (error) {
					ctx.ui.notify(`agents.toml MCP: ${(error as Error).message}`, "error");
				}
			}
		} catch (error) {
			ctx.ui.notify(`agents.toml MCP: ${(error as Error).message}`, "error");
		}
	});
}
