/**
 * This extension stores todo items as files under <todo-dir> (defaults to ~/.pi/todos,
 * or the path in PI_TODO_PATH).  Each todo is a standalone markdown file named
 * <id>.md and an optional <id>.lock file is used while a session is editing it.
 *
 * File format in ~/.pi/todos:
 * - The file starts with a JSON object (not YAML) containing the front matter:
 *   { id, title, tags, status, created_at, assigned_to_session }
 * - After the JSON block comes optional markdown body text separated by a blank line.
 * - Example:
 *   {
 *     "id": "deadbeef",
 *     "title": "Add tests",
 *     "tags": ["qa"],
 *     "status": "open",
 *     "created_at": "2026-01-25T17:00:00.000Z",
 *     "assigned_to_session": "session.json"
 *   }
 *
 *   Notes about the work go here.
 *
 * Todo storage settings are kept in <todo-dir>/settings.json.
 * Defaults:
 * {
 *   "gc": true,   // delete closed todos older than gcDays on startup
 *   "gcDays": 7   // age threshold for GC (days since created_at)
 * }
 *
 * Use `/todos` to bring up the visual todo manager or just let the LLM use them
 * naturally.
 *
 * Actions available from the /todos UI:
 *   start  — claim the todo (assign it to this session) and load it into the editor
 *            so the agent starts working on it immediately.
 *   refine — open a multi-line editor to add notes / acceptance criteria, then send
 *            everything to the agent so it can update the todo body interactively.
 *   view   — scroll through the todo's body in an overlay
 *   close/reopen/release/delete — status management
 */
import {
    DynamicBorder,
    copyToClipboard,
    getMarkdownTheme,
    keyHint,
    type ExtensionAPI,
    type ExtensionContext,
    type Theme,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";
import {
    Container,
    type Focusable,
    Input,
    Key,
    Markdown,
    SelectList,
    Spacer,
    type SelectItem,
    Text,
    TUI,
    fuzzyMatch,
    getKeybindings,
    matchesKey,
    truncateToWidth,
    visibleWidth,
} from "@mariozechner/pi-tui";

// ─── Constants ────────────────────────────────────────────────────────────────

const TODO_DIR_DEFAULT = path.join(os.homedir(), ".pi", "todos");
const TODO_PATH_ENV = "PI_TODO_PATH";
const TODO_SETTINGS_NAME = "settings.json";
const TODO_ID_PREFIX = "TODO-";
const TODO_ID_PATTERN = /^[a-f0-9]{8}$/i;
const DEFAULT_TODO_SETTINGS: TodoSettings = { gc: true, gcDays: 7 };
const LOCK_TTL_MS = 30 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodoFrontMatter {
    id: string;
    title: string;
    tags: string[];
    status: string;
    created_at: string;
    assigned_to_session?: string;
}

interface TodoRecord extends TodoFrontMatter {
    body: string;
}

interface LockInfo {
    id: string;
    pid: number;
    session?: string | null;
    created_at: string;
}

interface TodoSettings {
    gc: boolean;
    gcDays: number;
}

type TodoAction =
    | "list"
    | "list-all"
    | "get"
    | "create"
    | "update"
    | "append"
    | "delete"
    | "claim"
    | "release";

type TodoOverlayAction = "back" | "work";

type TodoMenuAction =
    | "start"
    | "work"
    | "refine"
    | "close"
    | "reopen"
    | "release"
    | "delete"
    | "copyPath"
    | "copyText"
    | "view";

type TodoToolDetails =
    | { action: "list" | "list-all"; todos: TodoFrontMatter[]; currentSessionId?: string; error?: string }
    | {
          action: "get" | "create" | "update" | "append" | "delete" | "claim" | "release";
          todo: TodoRecord;
          error?: string;
      };

const TodoParams = Type.Object({
    action: StringEnum([
        "list",
        "list-all",
        "get",
        "create",
        "update",
        "append",
        "delete",
        "claim",
        "release",
    ] as const),
    id: Type.Optional(Type.String({ description: "Todo id (TODO-<hex> or raw hex filename)" })),
    title: Type.Optional(Type.String({ description: "Short summary shown in lists" })),
    status: Type.Optional(Type.String({ description: "Todo status" })),
    tags: Type.Optional(Type.Array(Type.String({ description: "Todo tag" }))),
    body: Type.Optional(Type.String({ description: "Long-form details (markdown). Update replaces; append adds." })),
    force: Type.Optional(Type.Boolean({ description: "Override another session's assignment" })),
});

// ─── ID helpers ───────────────────────────────────────────────────────────────

function formatTodoId(id: string): string {
    return `${TODO_ID_PREFIX}${id}`;
}

function normalizeTodoId(id: string): string {
    let s = id.trim();
    if (s.startsWith("#")) s = s.slice(1);
    if (s.toUpperCase().startsWith(TODO_ID_PREFIX)) s = s.slice(TODO_ID_PREFIX.length);
    return s;
}

function validateTodoId(id: string): { id: string } | { error: string } {
    const normalized = normalizeTodoId(id);
    if (!normalized || !TODO_ID_PATTERN.test(normalized))
        return { error: "Invalid todo id. Expected TODO-<hex>." };
    return { id: normalized.toLowerCase() };
}

function displayTodoId(id: string): string {
    return formatTodoId(normalizeTodoId(id));
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function isTodoClosed(status: string): boolean {
    return ["closed", "done"].includes(status.toLowerCase());
}

function clearAssignmentIfClosed(todo: TodoFrontMatter): void {
    if (isTodoClosed(getTodoStatus(todo))) todo.assigned_to_session = undefined;
}

function getTodoStatus(todo: TodoFrontMatter): string {
    return todo.status || "open";
}

function getTodoTitle(todo: TodoFrontMatter): string {
    return todo.title || "(untitled)";
}

// ─── Sorting / filtering ──────────────────────────────────────────────────────

function sortTodos(todos: TodoFrontMatter[]): TodoFrontMatter[] {
    return [...todos].sort((a, b) => {
        const aClosed = isTodoClosed(a.status);
        const bClosed = isTodoClosed(b.status);
        if (aClosed !== bClosed) return aClosed ? 1 : -1;
        const aAssigned = !aClosed && Boolean(a.assigned_to_session);
        const bAssigned = !bClosed && Boolean(b.assigned_to_session);
        if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
        return (a.created_at || "").localeCompare(b.created_at || "");
    });
}

function buildTodoSearchText(todo: TodoFrontMatter): string {
    const tags = todo.tags.join(" ");
    const assignment = todo.assigned_to_session ? `assigned:${todo.assigned_to_session}` : "";
    return `${formatTodoId(todo.id)} ${todo.id} ${todo.title} ${tags} ${todo.status} ${assignment}`.trim();
}

function filterTodos(todos: TodoFrontMatter[], query: string): TodoFrontMatter[] {
    const trimmed = query.trim();
    if (!trimmed) return todos;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const matches: { todo: TodoFrontMatter; score: number }[] = [];
    for (const todo of todos) {
        const text = buildTodoSearchText(todo);
        let total = 0;
        let ok = true;
        for (const token of tokens) {
            const r = fuzzyMatch(token, text);
            if (!r.matches) { ok = false; break; }
            total += r.score;
        }
        if (ok) matches.push({ todo, score: total });
    }
    return matches
        .sort((a, b) => {
            const aClosed = isTodoClosed(a.todo.status);
            const bClosed = isTodoClosed(b.todo.status);
            if (aClosed !== bClosed) return aClosed ? 1 : -1;
            const aAssigned = !aClosed && Boolean(a.todo.assigned_to_session);
            const bAssigned = !bClosed && Boolean(b.todo.assigned_to_session);
            if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
            return a.score - b.score;
        })
        .map((m) => m.todo);
}

function splitTodosByAssignment(todos: TodoFrontMatter[]): {
    assignedTodos: TodoFrontMatter[];
    openTodos: TodoFrontMatter[];
    closedTodos: TodoFrontMatter[];
} {
    const assignedTodos: TodoFrontMatter[] = [];
    const openTodos: TodoFrontMatter[] = [];
    const closedTodos: TodoFrontMatter[] = [];
    for (const todo of todos) {
        if (isTodoClosed(getTodoStatus(todo))) { closedTodos.push(todo); continue; }
        if (todo.assigned_to_session) assignedTodos.push(todo);
        else openTodos.push(todo);
    }
    return { assignedTodos, openTodos, closedTodos };
}

// ─── Directory / path helpers ─────────────────────────────────────────────────

function getTodosDir(): string {
    const override = process.env[TODO_PATH_ENV];
    if (override?.trim()) return path.resolve(override.trim());
    return TODO_DIR_DEFAULT;
}

function getTodosDisplayPath(): string {
    const override = process.env[TODO_PATH_ENV];
    if (override?.trim()) return path.resolve(override.trim());
    return "~/.pi/todos";
}

function getTodoPath(todosDir: string, id: string): string {
    return path.join(todosDir, `${id}.md`);
}

function getLockPath(todosDir: string, id: string): string {
    return path.join(todosDir, `${id}.lock`);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function readTodoSettings(todosDir: string): Promise<TodoSettings> {
    try {
        const raw = await fs.readFile(path.join(todosDir, TODO_SETTINGS_NAME), "utf8");
        const data = JSON.parse(raw) as Partial<TodoSettings>;
        return {
            gc: data.gc ?? DEFAULT_TODO_SETTINGS.gc,
            gcDays: Number.isFinite(data.gcDays) ? Math.max(0, Math.floor(data.gcDays!)) : DEFAULT_TODO_SETTINGS.gcDays,
        };
    } catch {
        return { ...DEFAULT_TODO_SETTINGS };
    }
}

// ─── GC ───────────────────────────────────────────────────────────────────────

async function garbageCollectTodos(todosDir: string, settings: TodoSettings): Promise<void> {
    if (!settings.gc) return;
    let entries: string[] = [];
    try { entries = await fs.readdir(todosDir); } catch { return; }
    const cutoff = Date.now() - settings.gcDays * 86_400_000;
    await Promise.all(
        entries.filter((e) => e.endsWith(".md")).map(async (entry) => {
            const id = entry.slice(0, -3);
            const filePath = path.join(todosDir, entry);
            try {
                const content = await fs.readFile(filePath, "utf8");
                const { frontMatter } = splitFrontMatter(content);
                const parsed = parseFrontMatter(frontMatter, id);
                if (!isTodoClosed(parsed.status)) return;
                const created = Date.parse(parsed.created_at);
                if (Number.isFinite(created) && created < cutoff) await fs.unlink(filePath);
            } catch { /* ignore */ }
        }),
    );
}

// ─── File parsing ─────────────────────────────────────────────────────────────

function findJsonObjectEnd(content: string): number {
    let depth = 0, inStr = false, escaped = false;
    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (inStr) {
            if (escaped) { escaped = false; continue; }
            if (c === "\\") { escaped = true; continue; }
            if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === "{") { depth++; continue; }
        if (c === "}") { if (--depth === 0) return i; }
    }
    return -1;
}

function splitFrontMatter(content: string): { frontMatter: string; body: string } {
    if (!content.startsWith("{")) return { frontMatter: "", body: content };
    const end = findJsonObjectEnd(content);
    if (end === -1) return { frontMatter: "", body: content };
    return {
        frontMatter: content.slice(0, end + 1),
        body: content.slice(end + 1).replace(/^\r?\n+/, ""),
    };
}

function parseFrontMatter(text: string, idFallback: string): TodoFrontMatter {
    const data: TodoFrontMatter = { id: idFallback, title: "", tags: [], status: "open", created_at: "" };
    const trimmed = text.trim();
    if (!trimmed) return data;
    try {
        const p = JSON.parse(trimmed) as Partial<TodoFrontMatter> | null;
        if (!p || typeof p !== "object") return data;
        if (typeof p.id === "string" && p.id) data.id = p.id;
        if (typeof p.title === "string") data.title = p.title;
        if (typeof p.status === "string" && p.status) data.status = p.status;
        if (typeof p.created_at === "string") data.created_at = p.created_at;
        if (typeof p.assigned_to_session === "string" && p.assigned_to_session.trim())
            data.assigned_to_session = p.assigned_to_session;
        if (Array.isArray(p.tags)) data.tags = p.tags.filter((t): t is string => typeof t === "string");
    } catch { /* ignore */ }
    return data;
}

function parseTodoContent(content: string, idFallback: string): TodoRecord {
    const { frontMatter, body } = splitFrontMatter(content);
    const parsed = parseFrontMatter(frontMatter, idFallback);
    return { ...parsed, id: idFallback, body: body ?? "" };
}

function serializeTodo(todo: TodoRecord): string {
    const fm = JSON.stringify(
        {
            id: todo.id,
            title: todo.title,
            tags: todo.tags ?? [],
            status: todo.status,
            created_at: todo.created_at,
            assigned_to_session: todo.assigned_to_session || undefined,
        },
        null,
        2,
    );
    const body = (todo.body ?? "").replace(/^\n+/, "").replace(/\s+$/, "");
    return body ? `${fm}\n\n${body}\n` : `${fm}\n`;
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

async function ensureTodosDir(todosDir: string): Promise<void> {
    await fs.mkdir(todosDir, { recursive: true });
}

async function readTodoFile(filePath: string, idFallback: string): Promise<TodoRecord> {
    const content = await fs.readFile(filePath, "utf8");
    return parseTodoContent(content, idFallback);
}

async function writeTodoFile(filePath: string, todo: TodoRecord): Promise<void> {
    await fs.writeFile(filePath, serializeTodo(todo), "utf8");
}

async function generateTodoId(todosDir: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
        const id = crypto.randomBytes(4).toString("hex");
        if (!existsSync(getTodoPath(todosDir, id))) return id;
    }
    throw new Error("Failed to generate unique todo id");
}

async function ensureTodoExists(filePath: string, idFallback: string): Promise<TodoRecord | null> {
    if (!existsSync(filePath)) return null;
    return readTodoFile(filePath, idFallback);
}

async function appendTodoBody(filePath: string, todo: TodoRecord, text: string): Promise<TodoRecord> {
    const spacer = todo.body.trim().length ? "\n\n" : "";
    todo.body = `${todo.body.replace(/\s+$/, "")}${spacer}${text.trim()}\n`;
    await writeTodoFile(filePath, todo);
    return todo;
}

// ─── Locking ──────────────────────────────────────────────────────────────────

async function readLockInfo(lockPath: string): Promise<LockInfo | null> {
    try { return JSON.parse(await fs.readFile(lockPath, "utf8")) as LockInfo; }
    catch { return null; }
}

async function acquireLock(
    todosDir: string,
    id: string,
    ctx: ExtensionContext,
): Promise<(() => Promise<void>) | { error: string }> {
    const lockPath = getLockPath(todosDir, id);
    const now = Date.now();
    const session = ctx.sessionManager.getSessionFile();

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await fs.open(lockPath, "wx");
            const info: LockInfo = { id, pid: process.pid, session, created_at: new Date(now).toISOString() };
            await handle.writeFile(JSON.stringify(info, null, 2), "utf8");
            await handle.close();
            return async () => { try { await fs.unlink(lockPath); } catch { /* ignore */ } };
        } catch (err: any) {
            if (err?.code !== "EEXIST") return { error: `Failed to acquire lock: ${err?.message ?? "unknown"}` };
            const stats = await fs.stat(lockPath).catch(() => null);
            const age = stats ? now - stats.mtimeMs : LOCK_TTL_MS + 1;
            if (age <= LOCK_TTL_MS) {
                const info = await readLockInfo(lockPath);
                const owner = info?.session ? ` (session ${info.session})` : "";
                return { error: `Todo ${displayTodoId(id)} is locked${owner}. Try again later.` };
            }
            if (!ctx.hasUI) return { error: `Todo ${displayTodoId(id)} lock is stale; rerun in interactive mode to steal it.` };
            const ok = await ctx.ui.confirm("Todo locked", `Todo ${displayTodoId(id)} appears locked. Steal the lock?`);
            if (!ok) return { error: `Todo ${displayTodoId(id)} remains locked.` };
            await fs.unlink(lockPath).catch(() => undefined);
        }
    }
    return { error: `Failed to acquire lock for todo ${displayTodoId(id)}.` };
}

async function withTodoLock<T>(
    todosDir: string,
    id: string,
    ctx: ExtensionContext,
    fn: () => Promise<T>,
): Promise<T | { error: string }> {
    const lock = await acquireLock(todosDir, id, ctx);
    if (typeof lock === "object" && "error" in lock) return lock;
    try { return await fn(); } finally { await lock(); }
}

// ─── List helpers ─────────────────────────────────────────────────────────────

async function listTodos(todosDir: string): Promise<TodoFrontMatter[]> {
    let entries: string[] = [];
    try { entries = await fs.readdir(todosDir); } catch { return []; }
    const todos: TodoFrontMatter[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const id = entry.slice(0, -3);
        try {
            const content = await fs.readFile(path.join(todosDir, entry), "utf8");
            const { frontMatter } = splitFrontMatter(content);
            const parsed = parseFrontMatter(frontMatter, id);
            todos.push({ id, title: parsed.title, tags: parsed.tags ?? [], status: parsed.status, created_at: parsed.created_at, assigned_to_session: parsed.assigned_to_session });
        } catch { /* ignore */ }
    }
    return sortTodos(todos);
}

function listTodosSync(todosDir: string): TodoFrontMatter[] {
    let entries: string[] = [];
    try { entries = readdirSync(todosDir); } catch { return []; }
    const todos: TodoFrontMatter[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const id = entry.slice(0, -3);
        try {
            const content = readFileSync(path.join(todosDir, entry), "utf8");
            const { frontMatter } = splitFrontMatter(content);
            const parsed = parseFrontMatter(frontMatter, id);
            todos.push({ id, title: parsed.title, tags: parsed.tags ?? [], status: parsed.status, created_at: parsed.created_at, assigned_to_session: parsed.assigned_to_session });
        } catch { /* ignore */ }
    }
    return sortTodos(todos);
}

// ─── CRUD helpers (used by both tool and UI) ──────────────────────────────────

async function updateTodoStatus(
    todosDir: string,
    id: string,
    status: string,
    ctx: ExtensionContext,
): Promise<TodoRecord | { error: string }> {
    const v = validateTodoId(id);
    if ("error" in v) return v;
    const filePath = getTodoPath(todosDir, v.id);
    if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };
    return withTodoLock(todosDir, v.id, ctx, async () => {
        const existing = await ensureTodoExists(filePath, v.id);
        if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
        existing.status = status;
        clearAssignmentIfClosed(existing);
        await writeTodoFile(filePath, existing);
        return existing;
    }) as Promise<TodoRecord | { error: string }>;
}

async function claimTodoAssignment(
    todosDir: string,
    id: string,
    ctx: ExtensionContext,
    force = false,
): Promise<TodoRecord | { error: string }> {
    const v = validateTodoId(id);
    if ("error" in v) return v;
    const filePath = getTodoPath(todosDir, v.id);
    if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };
    const sessionId = ctx.sessionManager.getSessionId();
    return withTodoLock(todosDir, v.id, ctx, async () => {
        const existing = await ensureTodoExists(filePath, v.id);
        if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
        if (isTodoClosed(existing.status)) return { error: `Todo ${displayTodoId(id)} is closed` } as const;
        const assigned = existing.assigned_to_session;
        if (assigned && assigned !== sessionId && !force)
            return { error: `Todo ${displayTodoId(id)} is already assigned to session ${assigned}. Use force to override.` } as const;
        if (assigned !== sessionId) {
            existing.assigned_to_session = sessionId;
            await writeTodoFile(filePath, existing);
        }
        return existing;
    }) as Promise<TodoRecord | { error: string }>;
}

async function releaseTodoAssignment(
    todosDir: string,
    id: string,
    ctx: ExtensionContext,
    force = false,
): Promise<TodoRecord | { error: string }> {
    const v = validateTodoId(id);
    if ("error" in v) return v;
    const filePath = getTodoPath(todosDir, v.id);
    if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };
    const sessionId = ctx.sessionManager.getSessionId();
    return withTodoLock(todosDir, v.id, ctx, async () => {
        const existing = await ensureTodoExists(filePath, v.id);
        if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
        if (!existing.assigned_to_session) return existing;
        if (existing.assigned_to_session !== sessionId && !force)
            return { error: `Todo ${displayTodoId(id)} is assigned to session ${existing.assigned_to_session}. Use force to release.` } as const;
        existing.assigned_to_session = undefined;
        await writeTodoFile(filePath, existing);
        return existing;
    }) as Promise<TodoRecord | { error: string }>;
}

async function deleteTodo(
    todosDir: string,
    id: string,
    ctx: ExtensionContext,
): Promise<TodoRecord | { error: string }> {
    const v = validateTodoId(id);
    if ("error" in v) return v;
    const filePath = getTodoPath(todosDir, v.id);
    if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };
    return withTodoLock(todosDir, v.id, ctx, async () => {
        const existing = await ensureTodoExists(filePath, v.id);
        if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
        await fs.unlink(filePath);
        return existing;
    }) as Promise<TodoRecord | { error: string }>;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildWorkPrompt(todoId: string, title: string): string {
    return `work on todo ${formatTodoId(todoId)} "${title}"`;
}

/**
 * Build the refine prompt that is sent to the agent after the user has written
 * their notes in the editor.  The agent will ask follow-up questions and then
 * update the todo body with the agreed-upon description.
 */
function buildRefinePrompt(todoId: string, title: string, userNotes: string): string {
    const notesSection = userNotes.trim()
        ? `\n\nHere are my initial notes:\n\n${userNotes.trim()}`
        : "";
    return (
        `Let's refine todo ${formatTodoId(todoId)} "${title}".${notesSection}\n\n` +
        "Please ask me any clarifying questions you need to write a clear, complete description. " +
        "Do not rewrite the todo yet — ask questions first and wait for my answers. " +
        "Once we've agreed on the details, update the todo body using the todo tool."
    );
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function renderAssignmentSuffix(theme: Theme, todo: TodoFrontMatter, currentSessionId?: string): string {
    if (!todo.assigned_to_session) return "";
    const isCurrent = todo.assigned_to_session === currentSessionId;
    return theme.fg(isCurrent ? "success" : "dim", ` (assigned${isCurrent ? ": you" : `: ${todo.assigned_to_session}`})`);
}

function renderTodoHeading(theme: Theme, todo: TodoFrontMatter, currentSessionId?: string): string {
    const closed = isTodoClosed(getTodoStatus(todo));
    const tagText = todo.tags.length ? theme.fg("dim", ` [${todo.tags.join(", ")}]`) : "";
    const assignmentText = renderAssignmentSuffix(theme, todo, currentSessionId);
    return (
        theme.fg("accent", formatTodoId(todo.id)) +
        " " +
        theme.fg(closed ? "dim" : "text", getTodoTitle(todo)) +
        tagText +
        assignmentText
    );
}

function renderTodoDetail(theme: Theme, todo: TodoRecord, expanded: boolean): string {
    const summary = renderTodoHeading(theme, todo);
    if (!expanded) return summary;
    const tags = todo.tags.length ? todo.tags.join(", ") : "none";
    const bodyText = todo.body?.trim() || "No details yet.";
    return [
        summary,
        theme.fg("muted", `Status: ${getTodoStatus(todo)}`),
        theme.fg("muted", `Tags: ${tags}`),
        theme.fg("muted", `Created: ${todo.created_at || "unknown"}`),
        "",
        theme.fg("muted", "Body:"),
        ...bodyText.split("\n").map((l) => theme.fg("text", `  ${l}`)),
    ].join("\n");
}

function renderTodoList(theme: Theme, todos: TodoFrontMatter[], expanded: boolean, currentSessionId?: string): string {
    if (!todos.length) return theme.fg("dim", "No todos");
    const { assignedTodos, openTodos, closedTodos } = splitTodosByAssignment(todos);
    const lines: string[] = [];
    const pushSection = (label: string, sectionTodos: TodoFrontMatter[]) => {
        lines.push(theme.fg("muted", `${label} (${sectionTodos.length})`));
        if (!sectionTodos.length) { lines.push(theme.fg("dim", "  none")); return; }
        const max = expanded ? sectionTodos.length : Math.min(sectionTodos.length, 3);
        for (let i = 0; i < max; i++) lines.push(`  ${renderTodoHeading(theme, sectionTodos[i], currentSessionId)}`);
        if (!expanded && sectionTodos.length > max) lines.push(theme.fg("dim", `  … ${sectionTodos.length - max} more`));
    };
    pushSection("Assigned todos", assignedTodos);
    lines.push("");
    pushSection("Open todos", openTodos);
    lines.push("");
    pushSection("Closed todos", closedTodos);
    return lines.join("\n");
}

function appendExpandHint(theme: Theme, text: string): string {
    return `${text}\n${theme.fg("dim", `(${keyHint("expandTools", "to expand")})`)}`;
}

function serializeTodoForAgent(todo: TodoRecord): string {
    return JSON.stringify({ ...todo, id: formatTodoId(todo.id) }, null, 2);
}

function serializeTodoListForAgent(todos: TodoFrontMatter[]): string {
    const { assignedTodos, openTodos, closedTodos } = splitTodosByAssignment(todos);
    const map = (t: TodoFrontMatter) => ({ ...t, id: formatTodoId(t.id) });
    return JSON.stringify({ assigned: assignedTodos.map(map), open: openTodos.map(map), closed: closedTodos.map(map) }, null, 2);
}

function formatTodoList(todos: TodoFrontMatter[]): string {
    if (!todos.length) return "No todos.";
    const { assignedTodos, openTodos, closedTodos } = splitTodosByAssignment(todos);
    const lines: string[] = [];
    const pushSection = (label: string, sectionTodos: TodoFrontMatter[]) => {
        lines.push(`${label} (${sectionTodos.length}):`);
        if (!sectionTodos.length) { lines.push("  none"); return; }
        for (const t of sectionTodos) {
            const tags = t.tags.length ? ` [${t.tags.join(", ")}]` : "";
            const assignment = t.assigned_to_session ? ` (assigned: ${t.assigned_to_session})` : "";
            lines.push(`  ${formatTodoId(t.id)} ${getTodoTitle(t)}${tags}${assignment}`);
        }
    };
    pushSection("Assigned todos", assignedTodos);
    pushSection("Open todos", openTodos);
    pushSection("Closed todos", closedTodos);
    return lines.join("\n");
}

// ─── TUI Components ───────────────────────────────────────────────────────────

class TodoSelectorComponent extends Container implements Focusable {
    private searchInput: Input;
    private listContainer: Container;
    private allTodos: TodoFrontMatter[];
    private filteredTodos: TodoFrontMatter[];
    private selectedIndex = 0;
    private onSelectCb: (todo: TodoFrontMatter) => void;
    private onCancelCb: () => void;
    private tui: TUI;
    private theme: Theme;
    private headerText: Text;
    private hintText: Text;
    private currentSessionId?: string;
    private _focused = false;

    get focused(): boolean { return this._focused; }
    set focused(v: boolean) { this._focused = v; this.searchInput.focused = v; }

    constructor(
        tui: TUI,
        theme: Theme,
        todos: TodoFrontMatter[],
        onSelect: (todo: TodoFrontMatter) => void,
        onCancel: () => void,
        initialSearch?: string,
        currentSessionId?: string,
        private onQuickAction?: (todo: TodoFrontMatter, action: "start" | "refine") => void,
    ) {
        super();
        this.tui = tui;
        this.theme = theme;
        this.currentSessionId = currentSessionId;
        this.allTodos = todos;
        this.filteredTodos = todos;
        this.onSelectCb = onSelect;
        this.onCancelCb = onCancel;

        this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
        this.addChild(new Spacer(1));

        this.headerText = new Text("", 1, 0);
        this.addChild(this.headerText);
        this.addChild(new Spacer(1));

        this.searchInput = new Input();
        if (initialSearch) this.searchInput.setValue(initialSearch);
        this.searchInput.onSubmit = () => {
            const sel = this.filteredTodos[this.selectedIndex];
            if (sel) this.onSelectCb(sel);
        };
        this.addChild(this.searchInput);
        this.addChild(new Spacer(1));

        this.listContainer = new Container();
        this.addChild(this.listContainer);
        this.addChild(new Spacer(1));

        this.hintText = new Text("", 1, 0);
        this.addChild(this.hintText);
        this.addChild(new Spacer(1));
        this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

        this.updateHeader();
        this.updateHints();
        this.applyFilter(this.searchInput.getValue());
    }

    setTodos(todos: TodoFrontMatter[]): void {
        this.allTodos = todos;
        this.updateHeader();
        this.applyFilter(this.searchInput.getValue());
        this.tui.requestRender();
    }

    getSearchValue(): string { return this.searchInput.getValue(); }

    private updateHeader(): void {
        const open = this.allTodos.filter((t) => !isTodoClosed(t.status)).length;
        const closed = this.allTodos.length - open;
        this.headerText.setText(this.theme.fg("accent", this.theme.bold(`Todos (${open} open, ${closed} closed)`)));
    }

    private updateHints(): void {
        this.hintText.setText(
            this.theme.fg("dim", "Type to search • ↑↓ select • Enter actions • Ctrl+Shift+S start • Ctrl+Shift+R refine • Esc close"),
        );
    }

    private applyFilter(query: string): void {
        this.filteredTodos = filterTodos(this.allTodos, query);
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredTodos.length - 1));
        this.updateList();
    }

    private updateList(): void {
        this.listContainer.clear();
        if (!this.filteredTodos.length) {
            this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching todos"), 0, 0));
            return;
        }
        const maxVisible = 10;
        const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredTodos.length - maxVisible));
        const end = Math.min(start + maxVisible, this.filteredTodos.length);
        for (let i = start; i < end; i++) {
            const todo = this.filteredTodos[i];
            if (!todo) continue;
            const isSelected = i === this.selectedIndex;
            const closed = isTodoClosed(todo.status);
            const prefix = isSelected ? this.theme.fg("accent", "→ ") : "  ";
            const statusColor = closed ? "dim" : "success";
            const line =
                prefix +
                this.theme.fg("accent", formatTodoId(todo.id)) +
                " " +
                this.theme.fg(isSelected ? "accent" : closed ? "dim" : "text", getTodoTitle(todo)) +
                (todo.tags.length ? this.theme.fg("muted", ` [${todo.tags.join(", ")}]`) : "") +
                renderAssignmentSuffix(this.theme, todo, this.currentSessionId) +
                " " +
                this.theme.fg(statusColor, `(${todo.status || "open"})`);
            this.listContainer.addChild(new Text(line, 0, 0));
        }
        if (start > 0 || end < this.filteredTodos.length) {
            this.listContainer.addChild(new Text(this.theme.fg("dim", `  (${this.selectedIndex + 1}/${this.filteredTodos.length})`), 0, 0));
        }
    }

    handleInput(keyData: string): void {
        const kb = getKeybindings();
        if (kb.matches(keyData, "tui.select.up")) {
            if (!this.filteredTodos.length) return;
            this.selectedIndex = this.selectedIndex === 0 ? this.filteredTodos.length - 1 : this.selectedIndex - 1;
            this.updateList(); return;
        }
        if (kb.matches(keyData, "tui.select.down")) {
            if (!this.filteredTodos.length) return;
            this.selectedIndex = this.selectedIndex === this.filteredTodos.length - 1 ? 0 : this.selectedIndex + 1;
            this.updateList(); return;
        }
        if (kb.matches(keyData, "tui.select.confirm")) {
            const sel = this.filteredTodos[this.selectedIndex];
            if (sel) this.onSelectCb(sel); return;
        }
        if (kb.matches(keyData, "tui.select.cancel")) { this.onCancelCb(); return; }
        if (matchesKey(keyData, Key.ctrlShift("s"))) {
            const sel = this.filteredTodos[this.selectedIndex];
            if (sel && this.onQuickAction) this.onQuickAction(sel, "start"); return;
        }
        if (matchesKey(keyData, Key.ctrlShift("r"))) {
            const sel = this.filteredTodos[this.selectedIndex];
            if (sel && this.onQuickAction) this.onQuickAction(sel, "refine"); return;
        }
        this.searchInput.handleInput(keyData);
        this.applyFilter(this.searchInput.getValue());
    }

    override invalidate(): void {
        super.invalidate();
        this.updateHeader();
        this.updateHints();
        this.updateList();
    }
}

class TodoActionMenuComponent extends Container {
    private selectList: SelectList;

    constructor(
        theme: Theme,
        todo: TodoRecord,
        onSelect: (action: TodoMenuAction) => void,
        onCancel: () => void,
    ) {
        super();
        const closed = isTodoClosed(todo.status);

        const options: SelectItem[] = [
            { value: "view",     label: "view",     description: "Read the full todo body" },
            { value: "start",    label: "start",    description: "Claim this todo and start working on it immediately" },
            { value: "refine",   label: "refine",   description: "Write notes, then let the agent fill in the details" },
            ...(closed
                ? [{ value: "reopen", label: "reopen", description: "Mark todo as open" }]
                : [{ value: "close",  label: "close",  description: "Mark todo as closed" }]),
            ...(todo.assigned_to_session
                ? [{ value: "release", label: "release", description: "Remove session assignment" }]
                : []),
            { value: "copyPath", label: "copy path", description: "Copy absolute file path to clipboard" },
            { value: "copyText", label: "copy text", description: "Copy title + body to clipboard" },
            { value: "delete",   label: "delete",   description: "Permanently delete this todo" },
        ];

        this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
        this.addChild(new Text(theme.fg("accent", theme.bold(`Actions for ${formatTodoId(todo.id)} "${getTodoTitle(todo)}"`))));

        this.selectList = new SelectList(options, options.length, {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText:   (t) => theme.fg("accent", t),
            description:    (t) => theme.fg("muted", t),
            scrollInfo:     (t) => theme.fg("dim", t),
            noMatch:        (t) => theme.fg("warning", t),
        });
        this.selectList.onSelect = (item) => onSelect(item.value as TodoMenuAction);
        this.selectList.onCancel = onCancel;

        this.addChild(this.selectList);
        this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back")));
        this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    }

    handleInput(keyData: string): void { this.selectList.handleInput(keyData); }
    override invalidate(): void { super.invalidate(); }
}

class TodoDeleteConfirmComponent extends Container {
    private selectList: SelectList;
    constructor(theme: Theme, message: string, onConfirm: (confirmed: boolean) => void) {
        super();
        const options: SelectItem[] = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
        this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
        this.addChild(new Text(theme.fg("accent", message)));
        this.selectList = new SelectList(options, options.length, {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText:   (t) => theme.fg("accent", t),
            description:    (t) => theme.fg("muted", t),
            scrollInfo:     (t) => theme.fg("dim", t),
            noMatch:        (t) => theme.fg("warning", t),
        });
        this.selectList.onSelect = (item) => onConfirm(item.value === "yes");
        this.selectList.onCancel = () => onConfirm(false);
        this.addChild(this.selectList);
        this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back")));
        this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    }
    handleInput(keyData: string): void { this.selectList.handleInput(keyData); }
    override invalidate(): void { super.invalidate(); }
}

class TodoDetailOverlayComponent {
    private markdown: Markdown;
    private scrollOffset = 0;
    private viewHeight = 0;
    private totalLines = 0;

    constructor(
        private tui: TUI,
        private theme: Theme,
        private todo: TodoRecord,
        private onAction: (action: TodoOverlayAction) => void,
    ) {
        this.markdown = new Markdown(this.getMarkdownText(), 1, 0, getMarkdownTheme());
    }

    private getMarkdownText(): string {
        return this.todo.body?.trim() || "_No details yet._";
    }

    handleInput(keyData: string): void {
        const kb = getKeybindings();
        if (kb.matches(keyData, "tui.select.cancel"))    { this.onAction("back"); return; }
        if (kb.matches(keyData, "tui.select.confirm"))   { this.onAction("work"); return; }
        if (kb.matches(keyData, "tui.select.up"))        { this.scrollBy(-1); return; }
        if (kb.matches(keyData, "tui.select.down"))      { this.scrollBy(1); return; }
        if (kb.matches(keyData, "tui.select.pageUp"))    { this.scrollBy(-(this.viewHeight || 1)); return; }
        if (kb.matches(keyData, "tui.select.pageDown"))  { this.scrollBy(this.viewHeight || 1); return; }
    }

    render(width: number): string[] {
        const maxHeight = Math.max(10, Math.floor((this.tui.terminal.rows || 24) * 0.8));
        const innerWidth = Math.max(10, width - 2);
        const contentHeight = Math.max(1, maxHeight - 3 - 3 - 2);

        const markdownLines = this.markdown.render(innerWidth);
        this.totalLines = markdownLines.length;
        this.viewHeight = contentHeight;
        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, this.totalLines - contentHeight)));

        const lines: string[] = [];
        lines.push(this.buildTitleLine(innerWidth));
        lines.push(this.buildMetaLine(innerWidth));
        lines.push("");

        const visible = markdownLines.slice(this.scrollOffset, this.scrollOffset + contentHeight);
        for (const line of visible) lines.push(truncateToWidth(line, innerWidth));
        while (lines.length < 3 + contentHeight) lines.push("");

        lines.push("");
        lines.push(this.buildActionLine(innerWidth));

        const bc = (t: string) => this.theme.fg("borderMuted", t);
        const top = bc(`┌${"─".repeat(innerWidth)}┐`);
        const bottom = bc(`└${"─".repeat(innerWidth)}┘`);
        const framed = lines.map((line) => {
            const t = truncateToWidth(line, innerWidth);
            return bc("│") + t + " ".repeat(Math.max(0, innerWidth - visibleWidth(t))) + bc("│");
        });
        return [top, ...framed, bottom].map((l) => truncateToWidth(l, width));
    }

    invalidate(): void {
        this.markdown = new Markdown(this.getMarkdownText(), 1, 0, getMarkdownTheme());
    }

    private buildTitleLine(width: number): string {
        const titleText = ` ${getTodoTitle(this.todo)} `;
        const tw = visibleWidth(titleText);
        if (tw >= width) return truncateToWidth(this.theme.fg("accent", titleText.trim()), width);
        const left = Math.max(0, Math.floor((width - tw) / 2));
        const right = Math.max(0, width - tw - left);
        return this.theme.fg("borderMuted", "─".repeat(left)) + this.theme.fg("accent", titleText) + this.theme.fg("borderMuted", "─".repeat(right));
    }

    private buildMetaLine(width: number): string {
        const status = this.todo.status || "open";
        const tagText = this.todo.tags.length ? this.todo.tags.join(", ") : "no tags";
        const line =
            this.theme.fg("accent", formatTodoId(this.todo.id)) +
            this.theme.fg("muted", " • ") +
            this.theme.fg(isTodoClosed(status) ? "dim" : "success", status) +
            this.theme.fg("muted", " • ") +
            this.theme.fg("muted", tagText);
        return truncateToWidth(line, width);
    }

    private buildActionLine(width: number): string {
        let line =
            this.theme.fg("accent", "enter") + this.theme.fg("muted", " work on todo • ") +
            this.theme.fg("dim", "esc back");
        if (this.totalLines > this.viewHeight) {
            const start = Math.min(this.totalLines, this.scrollOffset + 1);
            const end   = Math.min(this.totalLines, this.scrollOffset + this.viewHeight);
            line += this.theme.fg("dim", `  ${start}-${end}/${this.totalLines}`);
        }
        return truncateToWidth(line, width);
    }

    private scrollBy(delta: number): void {
        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, Math.max(0, this.totalLines - this.viewHeight)));
    }
}

// ─── Extension entry point ────────────────────────────────────────────────────

export default function todosExtension(pi: ExtensionAPI) {
    pi.on("session_start", async (_event, ctx) => {
        const todosDir = getTodosDir();
        await ensureTodosDir(todosDir);
        const settings = await readTodoSettings(todosDir);
        await garbageCollectTodos(todosDir, settings);
    });

    // ── LLM tool ──────────────────────────────────────────────────────────────

    pi.registerTool({
        name: "todo",
        label: "Todo",
        description:
            `Manage file-based todos stored in ${getTodosDisplayPath()} ` +
            "(list, list-all, get, create, update, append, delete, claim, release). " +
            "Title is the short summary; body is long-form markdown notes (update replaces, append adds). " +
            "Todo ids are shown as TODO-<hex>; id parameters accept TODO-<hex> or the raw hex filename. " +
            "Claim tasks before working on them to avoid conflicts, and close them when complete.",
        parameters: TodoParams,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const todosDir = getTodosDir();
            const action: TodoAction = params.action;

            switch (action) {
                case "list": {
                    const todos = await listTodos(todosDir);
                    const { assignedTodos, openTodos } = splitTodosByAssignment(todos);
                    const listed = [...assignedTodos, ...openTodos];
                    return {
                        content: [{ type: "text", text: serializeTodoListForAgent(listed) }],
                        details: { action: "list", todos: listed, currentSessionId: ctx.sessionManager.getSessionId() } as TodoToolDetails,
                    };
                }

                case "list-all": {
                    const todos = await listTodos(todosDir);
                    return {
                        content: [{ type: "text", text: serializeTodoListForAgent(todos) }],
                        details: { action: "list-all", todos, currentSessionId: ctx.sessionManager.getSessionId() } as TodoToolDetails,
                    };
                }

                case "get": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "get", error: "id required" } as TodoToolDetails };
                    const v = validateTodoId(params.id);
                    if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "get", error: v.error } as TodoToolDetails };
                    const filePath = getTodoPath(todosDir, v.id);
                    const todo = await ensureTodoExists(filePath, v.id);
                    if (!todo) return { content: [{ type: "text", text: `Todo ${formatTodoId(v.id)} not found` }], details: { action: "get", error: "not found" } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(todo) }], details: { action: "get", todo } as TodoToolDetails };
                }

                case "create": {
                    if (!params.title) return { content: [{ type: "text", text: "Error: title required" }], details: { action: "create", error: "title required" } as TodoToolDetails };
                    await ensureTodosDir(todosDir);
                    const id = await generateTodoId(todosDir);
                    const filePath = getTodoPath(todosDir, id);
                    const todo: TodoRecord = { id, title: params.title, tags: params.tags ?? [], status: params.status ?? "open", created_at: new Date().toISOString(), body: params.body ?? "" };
                    const result = await withTodoLock(todosDir, id, ctx, async () => { await writeTodoFile(filePath, todo); return todo; });
                    if (typeof result === "object" && "error" in result) return { content: [{ type: "text", text: result.error }], details: { action: "create", error: result.error } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(todo) }], details: { action: "create", todo } as TodoToolDetails };
                }

                case "update": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "update", error: "id required" } as TodoToolDetails };
                    const v = validateTodoId(params.id);
                    if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "update", error: v.error } as TodoToolDetails };
                    const filePath = getTodoPath(todosDir, v.id);
                    if (!existsSync(filePath)) return { content: [{ type: "text", text: `Todo ${formatTodoId(v.id)} not found` }], details: { action: "update", error: "not found" } as TodoToolDetails };
                    const result = await withTodoLock(todosDir, v.id, ctx, async () => {
                        const existing = await ensureTodoExists(filePath, v.id);
                        if (!existing) return { error: `Todo ${formatTodoId(v.id)} not found` } as const;
                        if (params.title   !== undefined) existing.title  = params.title;
                        if (params.status  !== undefined) existing.status = params.status;
                        if (params.tags    !== undefined) existing.tags   = params.tags;
                        if (params.body    !== undefined) existing.body   = params.body;
                        if (!existing.created_at) existing.created_at = new Date().toISOString();
                        clearAssignmentIfClosed(existing);
                        await writeTodoFile(filePath, existing);
                        return existing;
                    });
                    if (typeof result === "object" && "error" in result) return { content: [{ type: "text", text: result.error }], details: { action: "update", error: result.error } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "update", todo: result as TodoRecord } as TodoToolDetails };
                }

                case "append": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "append", error: "id required" } as TodoToolDetails };
                    const v = validateTodoId(params.id);
                    if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "append", error: v.error } as TodoToolDetails };
                    const filePath = getTodoPath(todosDir, v.id);
                    if (!existsSync(filePath)) return { content: [{ type: "text", text: `Todo ${formatTodoId(v.id)} not found` }], details: { action: "append", error: "not found" } as TodoToolDetails };
                    const result = await withTodoLock(todosDir, v.id, ctx, async () => {
                        const existing = await ensureTodoExists(filePath, v.id);
                        if (!existing) return { error: `Todo ${formatTodoId(v.id)} not found` } as const;
                        if (!params.body?.trim()) return existing;
                        return appendTodoBody(filePath, existing, params.body!);
                    });
                    if (typeof result === "object" && "error" in result) return { content: [{ type: "text", text: result.error }], details: { action: "append", error: result.error } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "append", todo: result as TodoRecord } as TodoToolDetails };
                }

                case "claim": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "claim", error: "id required" } as TodoToolDetails };
                    const result = await claimTodoAssignment(todosDir, params.id, ctx, Boolean(params.force));
                    if ("error" in result) return { content: [{ type: "text", text: result.error }], details: { action: "claim", error: result.error } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(result) }], details: { action: "claim", todo: result } as TodoToolDetails };
                }

                case "release": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "release", error: "id required" } as TodoToolDetails };
                    const result = await releaseTodoAssignment(todosDir, params.id, ctx, Boolean(params.force));
                    if ("error" in result) return { content: [{ type: "text", text: result.error }], details: { action: "release", error: result.error } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(result) }], details: { action: "release", todo: result } as TodoToolDetails };
                }

                case "delete": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "delete", error: "id required" } as TodoToolDetails };
                    const v = validateTodoId(params.id);
                    if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "delete", error: v.error } as TodoToolDetails };
                    const result = await deleteTodo(todosDir, v.id, ctx);
                    if ("error" in result) return { content: [{ type: "text", text: result.error }], details: { action: "delete", error: result.error } as TodoToolDetails };
                    return { content: [{ type: "text", text: serializeTodoForAgent(result) }], details: { action: "delete", todo: result } as TodoToolDetails };
                }
            }
        },

        renderCall(args, theme) {
            const action = typeof args.action === "string" ? args.action : "";
            const id = typeof args.id === "string" ? normalizeTodoId(args.id) : "";
            let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", action);
            if (id) text += " " + theme.fg("accent", formatTodoId(id));
            if (args.title) text += " " + theme.fg("dim", `"${args.title}"`);
            return new Text(text, 0, 0);
        },

        renderResult(result, { expanded, isPartial }, theme) {
            if (isPartial) return new Text(theme.fg("warning", "Processing…"), 0, 0);
            const details = result.details as TodoToolDetails | undefined;
            if (!details) {
                const t = result.content[0];
                return new Text(t?.type === "text" ? t.text : "", 0, 0);
            }
            if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

            if (details.action === "list" || details.action === "list-all") {
                let text = renderTodoList(theme, details.todos, expanded, details.currentSessionId);
                if (!expanded) text = appendExpandHint(theme, text);
                return new Text(text, 0, 0);
            }

            if (!("todo" in details)) {
                const t = result.content[0];
                return new Text(t?.type === "text" ? t.text : "", 0, 0);
            }

            const labels: Record<string, string> = {
                create: "Created", update: "Updated", append: "Appended to",
                delete: "Deleted", claim: "Claimed", release: "Released",
            };
            let text = renderTodoDetail(theme, details.todo, expanded);
            const label = labels[details.action];
            if (label) {
                const [first, ...rest] = text.split("\n");
                text = [theme.fg("success", "✓ ") + theme.fg("muted", `${label} `) + first, ...rest].join("\n");
            }
            if (!expanded) text = appendExpandHint(theme, text);
            return new Text(text, 0, 0);
        },
    });

    // ── /todos command ────────────────────────────────────────────────────────

    pi.registerCommand("todos", {
        description: `List and manage todos (stored in ${getTodosDisplayPath()})`,
        getArgumentCompletions: (prefix: string) => {
            const todos = listTodosSync(getTodosDir());
            if (!todos.length) return null;
            const matches = filterTodos(todos, prefix);
            if (!matches.length) return null;
            return matches.map((todo) => ({
                value: getTodoTitle(todo),
                label: `${formatTodoId(todo.id)} ${getTodoTitle(todo)}`,
                description: `${todo.status || "open"}${todo.tags.length ? ` • ${todo.tags.join(", ")}` : ""}`,
            }));
        },
        handler: async (args, ctx) => {
            const todosDir = getTodosDir();
            const todos = await listTodos(todosDir);
            const currentSessionId = ctx.sessionManager.getSessionId();
            const searchTerm = (args ?? "").trim();

            if (!ctx.hasUI) {
                console.log(formatTodoList(todos));
                return;
            }

            let nextPrompt: string | null = null;

            await ctx.ui.custom<void>((tui, theme, _kb, done) => {
                let selector: TodoSelectorComponent | null = null;
                let actionMenu: TodoActionMenuComponent | null = null;
                let deleteConfirm: TodoDeleteConfirmComponent | null = null;
                let wrapperFocused = false;
                let activeComponent: {
                    render: (width: number) => string[];
                    invalidate: () => void;
                    handleInput?: (data: string) => void;
                    focused?: boolean;
                } | null = null;

                const setActive = (c: typeof activeComponent) => {
                    if (activeComponent && "focused" in activeComponent) activeComponent.focused = false;
                    activeComponent = c;
                    if (activeComponent && "focused" in activeComponent) activeComponent.focused = wrapperFocused;
                    tui.requestRender();
                };

                // ── Action: start ─────────────────────────────────────────────
                // Claim the todo and immediately load the work prompt into the editor.
                const handleStart = async (todo: TodoFrontMatter | TodoRecord) => {
                    const id = todo.id;
                    const title = getTodoTitle(todo);
                    const claimResult = await claimTodoAssignment(todosDir, id, ctx, false);
                    if ("error" in claimResult) {
                        ctx.ui.notify(claimResult.error, "error");
                        return;
                    }
                    nextPrompt = buildWorkPrompt(id, title);
                    done();
                };

                // ── Action: refine ────────────────────────────────────────────
                // Open a multi-line editor so the user can write notes / acceptance criteria,
                // then send everything to the agent so it can ask questions and update the body.
                const handleRefine = async (todo: TodoFrontMatter | TodoRecord) => {
                    const id = todo.id;
                    const title = getTodoTitle(todo);

                    // Pre-fill the editor with the existing body so the user has context.
                    const existingBody = "body" in todo ? todo.body?.trim() : "";
                    const placeholder = existingBody
                        ? `# Existing notes\n\n${existingBody}\n\n---\n\n# Your additions / corrections\n\n`
                        : `# What should this todo accomplish?\n\n`;

                    const notes = await ctx.ui.editor(
                        `Refine "${title}" — add notes and acceptance criteria`,
                        placeholder,
                    );

                    if (notes === undefined) {
                        // User cancelled the editor — go back to action menu
                        if (actionMenu) setActive(actionMenu);
                        return;
                    }

                    nextPrompt = buildRefinePrompt(id, title, notes);
                    done();
                };

                const resolveTodoRecord = async (todo: TodoFrontMatter): Promise<TodoRecord | null> => {
                    const filePath = getTodoPath(todosDir, todo.id);
                    const record = await ensureTodoExists(filePath, todo.id);
                    if (!record) { ctx.ui.notify(`Todo ${formatTodoId(todo.id)} not found`, "error"); return null; }
                    return record;
                };

                const openTodoOverlay = async (record: TodoRecord): Promise<TodoOverlayAction> => {
                    const action = await ctx.ui.custom<TodoOverlayAction>(
                        (overlayTui, overlayTheme, _kb2, overlayDone) =>
                            new TodoDetailOverlayComponent(overlayTui, overlayTheme, record, overlayDone),
                        { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } },
                    );
                    return action ?? "back";
                };

                const applyAction = async (record: TodoRecord, action: TodoMenuAction): Promise<"stay" | "exit"> => {
                    if (action === "start") {
                        await handleStart(record);
                        return "exit";
                    }
                    if (action === "refine") {
                        await handleRefine(record);
                        // If handleRefine set nextPrompt, done() was called; otherwise user cancelled.
                        return nextPrompt ? "exit" : "stay";
                    }
                    if (action === "view") return "stay"; // handled separately
                    if (action === "copyPath") {
                        const absPath = path.resolve(getTodoPath(todosDir, record.id));
                        try { copyToClipboard(absPath); ctx.ui.notify(`Copied ${absPath} to clipboard`, "info"); }
                        catch (e) { ctx.ui.notify(e instanceof Error ? e.message : String(e), "error"); }
                        return "stay";
                    }
                    if (action === "copyText") {
                        const text = record.body?.trim()
                            ? `# ${getTodoTitle(record)}\n\n${record.body.trim()}`
                            : `# ${getTodoTitle(record)}`;
                        try { copyToClipboard(text); ctx.ui.notify("Copied todo text to clipboard", "info"); }
                        catch (e) { ctx.ui.notify(e instanceof Error ? e.message : String(e), "error"); }
                        return "stay";
                    }
                    if (action === "release") {
                        const result = await releaseTodoAssignment(todosDir, record.id, ctx, true);
                        if ("error" in result) { ctx.ui.notify(result.error, "error"); return "stay"; }
                        selector?.setTodos(await listTodos(todosDir));
                        ctx.ui.notify(`Released todo ${formatTodoId(record.id)}`, "info");
                        return "stay";
                    }
                    if (action === "delete") {
                        const result = await deleteTodo(todosDir, record.id, ctx);
                        if ("error" in result) { ctx.ui.notify(result.error, "error"); return "stay"; }
                        selector?.setTodos(await listTodos(todosDir));
                        ctx.ui.notify(`Deleted todo ${formatTodoId(record.id)}`, "info");
                        return "stay";
                    }
                    // close / reopen
                    const newStatus = action === "close" ? "closed" : "open";
                    const result = await updateTodoStatus(todosDir, record.id, newStatus, ctx);
                    if ("error" in result) { ctx.ui.notify(result.error, "error"); return "stay"; }
                    selector?.setTodos(await listTodos(todosDir));
                    ctx.ui.notify(`${action === "close" ? "Closed" : "Reopened"} todo ${formatTodoId(record.id)}`, "info");
                    return "stay";
                };

                const handleActionSelection = async (record: TodoRecord, action: TodoMenuAction) => {
                    if (action === "view") {
                        const overlayAction = await openTodoOverlay(record);
                        if (overlayAction === "work") { await handleStart(record); return; }
                        if (actionMenu) setActive(actionMenu);
                        return;
                    }
                    if (action === "delete") {
                        deleteConfirm = new TodoDeleteConfirmComponent(
                            theme,
                            `Delete todo ${formatTodoId(record.id)}? This cannot be undone.`,
                            (confirmed) => {
                                if (!confirmed) { setActive(actionMenu); return; }
                                void (async () => {
                                    await applyAction(record, "delete");
                                    setActive(selector);
                                })();
                            },
                        );
                        setActive(deleteConfirm);
                        return;
                    }
                    const outcome = await applyAction(record, action);
                    if (outcome === "stay") setActive(selector);
                };

                const showActionMenu = async (todo: TodoFrontMatter | TodoRecord) => {
                    const record = "body" in todo ? todo : await resolveTodoRecord(todo);
                    if (!record) return;
                    actionMenu = new TodoActionMenuComponent(theme, record,
                        (action) => { void handleActionSelection(record, action); },
                        () => { setActive(selector); },
                    );
                    setActive(actionMenu);
                };

                selector = new TodoSelectorComponent(
                    tui, theme, todos,
                    (todo) => { void showActionMenu(todo); },
                    () => done(),
                    searchTerm || undefined,
                    currentSessionId,
                    // Quick-action shortcuts from the selector (Ctrl+Shift+S / Ctrl+Shift+R)
                    (todo, action) => {
                        if (action === "start") { void handleStart(todo); }
                        else { void handleRefine(todo); }
                    },
                );
                setActive(selector);

                return {
                    get focused() { return wrapperFocused; },
                    set focused(v: boolean) {
                        wrapperFocused = v;
                        if (activeComponent && "focused" in activeComponent) activeComponent.focused = v;
                    },
                    render(width: number) { return activeComponent ? activeComponent.render(width) : []; },
                    invalidate()         { activeComponent?.invalidate(); },
                    handleInput(data: string) { activeComponent?.handleInput?.(data); },
                };
            });

            if (nextPrompt) {
                ctx.ui.setEditorText(nextPrompt);
            }
        },
    });
}
