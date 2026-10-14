import assert from "node:assert/strict";
import { test } from "node:test";
import sessionNaming, { conversationText, firstPrompt, normalizeTitle } from "./index.ts";

function message(role: string, content: unknown, id = role) {
	return { type: "message", id, message: { role, content } };
}

function setup() {
	const handlers = new Map<string, Function>();
	const commands = new Map<string, { handler: Function }>();
	const requests: { model: unknown; context: any; options: any; resolve: Function; reject: Function }[] = [];
	const notifications: { text: string; level: string }[] = [];
	let name: string | undefined;
	let id = "session-a";
	let entries: any[] = [];
	let selection: string | undefined;
	let input: string | undefined;
	let idleWaits = 0;
	let selections = 0;
	const pi: any = {
		on: (event: string, handler: Function) => handlers.set(event, handler),
		registerCommand: (command: string, definition: any) => commands.set(command, definition),
		getSessionName: () => name,
		setSessionName: (value: string) => {
			name = value;
			handlers.get("session_info_changed")?.({ name }, ctx);
		},
	};
	const ctx: any = {
		hasUI: true,
		model: { provider: "openai-codex", id: "test-model", contextWindow: 128_000 },
		sessionManager: { getSessionId: () => id, getBranch: () => entries },
		ui: {
			select: async (_title: string, options: string[]) => {
				selections++;
				assert.deepEqual(options, ["Custom title", "Auto from whole conversation"]);
				return selection;
			},
			input: async () => input,
			notify: (text: string, level: string) => notifications.push({ text, level }),
		},
		waitForIdle: async () => { idleWaits++; },
		modelRegistry: {
			streamSimple: (model: unknown, context: any, options: any) => ({
				result: () => new Promise((resolve, reject) => requests.push({ model, context, options, resolve, reject })),
			}),
		},
	};
	sessionNaming(pi);
	const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); };
	return {
		pi, ctx, requests, notifications, flush,
		get name() { return name; },
		get idleWaits() { return idleWaits; },
		get selections() { return selections; },
		set entries(value: any[]) { entries = value; },
		set selection(value: string | undefined) { selection = value; },
		set input(value: string | undefined) { input = value; },
		start: (prompt = "Fix login redirect") => handlers.get("before_agent_start")?.({ messageType: "user", prompt }, ctx),
		customStart: () => handlers.get("before_agent_start")?.({ messageType: "custom" }, ctx),
		event: (event: string) => handlers.get(event)?.({}, ctx),
		switchSession: () => { id = "session-b"; name = undefined; handlers.get("session_start")?.({}, ctx); },
		rename: (args = "") => commands.get("rename")!.handler(args, ctx),
		finish: async (title = "Fix login redirect", index = 0, extra = {}) => {
			requests[index].resolve({ content: [{ type: "text", text: title }], stopReason: "stop", ...extra });
			await flush();
		},
	};
}

test("title normalization removes formatting, controls and extra lines", () => {
	assert.equal(normalizeTitle('Title: **Fix login redirects.**\nExplanation'), "Fix login redirects");
	assert.equal(normalizeTitle('  "Improve\t authentication"  '), "Improve authentication");
	assert.equal(normalizeTitle(""), "");
	assert.equal(Array.from(normalizeTitle("🧪".repeat(100))).length, 80);
});

test("first prompt excludes later user prompts and assistant text", () => {
	assert.equal(firstPrompt([
		message("assistant", [{ type: "text", text: "Intro" }]),
		message("user", [{ type: "text", text: "First task" }, { type: "image", data: "secret" }]),
		message("user", "Later task"),
	] as any), "First task");
});

test("whole conversation includes pre-compaction history, tools and summaries, not system/thinking/images", () => {
	const text = conversationText([
		message("system", "SYSTEM_SECRET"),
		message("user", "Original goal", "first"),
		message("assistant", [
			{ type: "thinking", thinking: "THINKING_SECRET" },
			{ type: "text", text: "Implemented fix" },
			{ type: "toolCall", name: "bash", arguments: { command: "npm test" } },
			{ type: "image", data: "IMAGE_SECRET" },
		]),
		message("toolResult", [{ type: "text", text: "Tests passed" }]),
		{ type: "compaction", summary: "Compacted goal" },
		{ type: "branch_summary", summary: "Earlier approach" },
		{ type: "custom_message", customType: "context", content: "Extra context" },
		{ type: "message", message: { role: "bashExecution", command: "pwd", output: "/project" } },
		message("user", "Latest task", "last"),
	] as any);
	for (const expected of ["Original goal", "Implemented fix", "npm test", "Tests passed", "Compacted goal", "Earlier approach", "Extra context", "/project", "Latest task"]) {
		assert.ok(text.includes(expected), expected);
	}
	assert.ok(!text.includes("SECRET"));
});

test("context edits omit and replace original sensitive content", () => {
	const text = conversationText([
		message("user", "OMITTED_SECRET", "one"),
		message("assistant", [{ type: "text", text: "REPLACED_SECRET" }], "two"),
		{ type: "context_edit", targetId: "one", replacement: null },
		{ type: "context_edit", targetId: "two", replacement: { content: "Safe replacement" } },
	] as any);
	assert.equal(text, "assistant: Safe replacement");
});

test("long histories are bounded while preserving early and late sections", () => {
	const text = conversationText([
		message("user", "FIRST " + "a".repeat(10_000) + " first end"),
		message("assistant", [{ type: "text", text: "MIDDLE " + "b".repeat(10_000) }]),
		message("user", "LAST " + "c".repeat(10_000) + " last end"),
	] as any, 900);
	assert.ok(text.length <= 900);
	for (const expected of ["FIRST", "first end", "MIDDLE", "LAST", "last end"]) assert.ok(text.includes(expected));
});

test("clipping stays within budget even with a one-character tail budget", () => {
	for (const budget of [1, 12, 13, 14, 15, 16, 20]) {
		assert.ok(conversationText([message("user", "x".repeat(100))] as any, budget).length <= budget);
	}
});

test("automatic naming is non-blocking and runs once using the first prompt", async () => {
	const s = setup();
	s.entries = [message("user", "First task")];
	assert.equal(s.start("Second task"), undefined);
	s.start("Third task");
	assert.equal(s.requests.length, 1);
	assert.ok(s.requests[0].context.messages[0].content[0].text.includes("First task"));
	assert.equal(s.requests[0].model, s.ctx.model);
	assert.equal(s.requests[0].options.reasoning, "minimal");
	await s.finish('"Improve authentication"');
	assert.equal(s.name, "Improve authentication");
	assert.equal(s.notifications.length, 0);
});

test("existing titles, blank prompts and custom turns are not auto-named", () => {
	const s = setup();
	s.customStart();
	s.start("  ");
	s.pi.setSessionName("My existing title");
	s.start();
	assert.equal(s.requests.length, 0);
});

test("manual /name wins over an in-flight auto title", async () => {
	const s = setup();
	s.start();
	s.pi.setSessionName("Manual title");
	assert.equal(s.requests[0].options.signal.aborted, true);
	await s.finish();
	assert.equal(s.name, "Manual title");
});

test("session replacement discards stale results and allows a fresh title", async () => {
	const s = setup();
	s.start();
	s.switchSession();
	await s.finish("Old session title");
	assert.equal(s.name, undefined);
	s.start("New task");
	assert.equal(s.requests.length, 2);
	await s.finish("New session title", 1);
	assert.equal(s.name, "New session title");
});

test("shutdown cancels background naming", async () => {
	const s = setup();
	s.start();
	s.event("session_shutdown");
	assert.equal(s.requests[0].options.signal.aborted, true);
	await s.finish();
	assert.equal(s.name, undefined);
});

test("/rename presents multiple choice and saves a custom title", async () => {
	const s = setup();
	s.selection = "Custom title";
	s.input = "  My chosen title  ";
	await s.rename();
	assert.equal(s.selections, 1);
	assert.equal(s.name, "My chosen title");
	assert.equal(s.requests.length, 0);
});

test("cancelled selections and blank custom titles do not change the name", async () => {
	const s = setup();
	s.pi.setSessionName("Keep this title");
	await s.rename();
	s.selection = "Custom title";
	s.input = " ";
	await s.rename();
	assert.equal(s.name, "Keep this title");
});

test("auto rename waits for idle and includes the entire active conversation", async () => {
	const s = setup();
	s.pi.setSessionName("Original title");
	s.entries = [message("user", "First goal"), message("assistant", [{ type: "text", text: "Progress" }]), message("user", "Changed goal")];
	s.selection = "Auto from whole conversation";
	const pending = s.rename();
	await s.flush();
	assert.equal(s.idleWaits, 1);
	const source = s.requests[0].context.messages[0].content[0].text;
	for (const expected of ["First goal", "Progress", "Changed goal"]) assert.ok(source.includes(expected));
	await s.finish("Broader conversation title");
	await pending;
	assert.equal(s.name, "Broader conversation title");
});

test("direct custom and auto arguments work without opening the menu", async () => {
	const s = setup();
	await s.rename("Direct title");
	assert.equal(s.name, "Direct title");
	s.entries = [message("user", "Task")];
	const pending = s.rename("auto");
	await s.flush();
	await s.finish("Generated title");
	await pending;
	assert.equal(s.name, "Generated title");
	assert.equal(s.selections, 0);
});

test("auto rename on an empty session warns without a model request", async () => {
	const s = setup();
	await s.rename("auto");
	assert.equal(s.requests.length, 0);
	assert.match(s.notifications[0].text, /No conversation yet/);
});

test("generation errors and empty output preserve the old title", async () => {
	for (const response of [{ stopReason: "error", errorMessage: "Provider unavailable" }, {}]) {
		const s = setup();
		s.pi.setSessionName("Keep title");
		s.entries = [message("user", "Task")];
		const pending = s.rename("auto");
		await s.flush();
		await s.finish("", 0, response);
		await pending;
		assert.equal(s.name, "Keep title");
		assert.ok(s.notifications.some((n) => n.level === "warning"));
	}
});

test("a manual rename supersedes a pending background title", async () => {
	const s = setup();
	s.start();
	await s.rename("Manual title");
	await s.finish("Stale title");
	assert.equal(s.name, "Manual title");
});

test("timeouts warn and leave the current name unchanged", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const s = setup();
	s.start();
	t.mock.timers.tick(60_000);
	assert.equal(s.requests[0].options.signal.aborted, true);
	await s.finish("Late title");
	assert.equal(s.name, undefined);
	assert.match(s.notifications[0].text, /timed out/);
});

test("rejected requests are caught even for background naming", async () => {
	const s = setup();
	s.start();
	s.requests[0].reject(new Error("Network unavailable"));
	await s.flush();
	assert.equal(s.name, undefined);
	assert.match(s.notifications[0].text, /Network unavailable/);
});
