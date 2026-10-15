export interface SessionLimit {
  remainingPercent: number;
  resetsAt: number;
}

export function supportsSessionLimit(provider?: string): boolean {
  return provider === "openai" || provider === "openai-codex";
}

function accountId(token: string): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const id = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

export function parseSessionLimit(payload: unknown, now = Date.now()): SessionLimit | undefined {
  const window = (payload as { rate_limit?: { primary_window?: {
    used_percent?: unknown;
    reset_at?: unknown;
    reset_after_seconds?: unknown;
  } } } | null)?.rate_limit?.primary_window;
  if (!window || typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent)) {
    return undefined;
  }
  const resetsAt = typeof window.reset_at === "number"
    ? window.reset_at * 1000
    : typeof window.reset_after_seconds === "number"
      ? now + window.reset_after_seconds * 1000
      : NaN;
  if (!Number.isFinite(resetsAt) || resetsAt <= now) return undefined;
  return {
    remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - window.used_percent))),
    resetsAt,
  };
}

export function formatSessionLimit(limit?: SessionLimit, now = Date.now()): string {
  if (!limit || limit.resetsAt <= now) return "";
  const minutes = Math.ceil((limit.resetsAt - now) / 60_000);
  const hours = Math.floor(minutes / 60);
  return `${limit.remainingPercent}% ${hours ? `${hours}h` : ""}${minutes % 60}m`;
}

/** API keys have no subscription window. Only send ChatGPT OAuth tokens to this endpoint. */
export async function fetchSessionLimit(
  provider: string | undefined,
  getToken: (provider: string) => Promise<string | undefined>,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<SessionLimit | undefined> {
  if (!supportsSessionLimit(provider)) return undefined;
  let token = await getToken(provider!);
  let id = token ? accountId(token) : undefined;
  if (!id && provider === "openai") {
    token = await getToken("openai-codex");
    id = token ? accountId(token) : undefined;
  }
  if (!id || !token || signal.aborted) return undefined;
  const response = await request("https://chatgpt.com/backend-api/wham/usage", {
    headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": id },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    redirect: "error",
  });
  if (!response.ok) return undefined;
  return parseSessionLimit(await response.json());
}
