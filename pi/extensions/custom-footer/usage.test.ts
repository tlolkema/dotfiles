import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSessionLimit, formatSessionLimit, parseSessionLimit, supportsSessionLimit } from "./usage.ts";

const now = 1_800_000_000_000;
const payload = (window: object) => ({ rate_limit: { primary_window: window } });
const token = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
})).toString("base64url")}.signature`;

test("only OpenAI and Codex providers show session limits", () => {
  for (const provider of ["openai", "openai-codex"]) assert.equal(supportsSessionLimit(provider), true);
  for (const provider of [undefined, "anthropic", "openrouter", "azure-openai-responses"]) {
    assert.equal(supportsSessionLimit(provider), false);
  }
});

test("uses remaining percentage and the primary session reset countdown", () => {
  const limit = parseSessionLimit({
    ...payload({ used_percent: 30, reset_at: (now + 272 * 60_000) / 1000 }),
    secondary_window: { used_percent: 90 },
  }, now);
  assert.equal(formatSessionLimit(limit, now), "70% 4h32m");
  assert.equal(formatSessionLimit(limit, now + 60_000), "70% 4h31m");
  assert.equal(formatSessionLimit(limit, now + 272 * 60_000), "");
});

test("supports relative resets, clamps percentages, and rounds up partial minutes", () => {
  assert.equal(formatSessionLimit(parseSessionLimit(payload({ used_percent: 100, reset_after_seconds: 1 }), now), now), "0% 1m");
  assert.equal(formatSessionLimit(parseSessionLimit(payload({ used_percent: -5, reset_after_seconds: 3600 }), now), now), "100% 1h0m");
  assert.equal(parseSessionLimit(payload({ used_percent: 150, reset_after_seconds: 60 }), now)?.remainingPercent, 0);
});

test("missing, malformed and expired quota data stays hidden", () => {
  for (const data of [null, {}, { rate_limit: null }, payload({}),
    payload({ used_percent: "30", reset_at: now / 1000 + 60 }),
    payload({ used_percent: NaN, reset_after_seconds: 60 }),
    payload({ used_percent: 30, reset_at: Infinity }),
    payload({ used_percent: 30, reset_at: now / 1000 }),
  ]) assert.equal(parseSessionLimit(data, now), undefined);
  assert.equal(formatSessionLimit(undefined, now), "");
});

test("requests ChatGPT quota using OAuth and the matching account", async () => {
  const signal = new AbortController().signal;
  const result = await fetchSessionLimit("openai-codex", async () => token, signal, async (url, init) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.deepEqual(init?.headers, { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": "test-account" });
    assert.equal(init?.redirect, "error");
    assert.equal(init?.signal?.aborted, false);
    return Response.json(payload({ used_percent: 30, reset_after_seconds: 16_320 }));
  });
  assert.equal(result?.remainingPercent, 70);
});

test("OpenAI API-key models can use the logged-in Codex subscription", async () => {
  const providers: string[] = [];
  await fetchSessionLimit("openai", async (provider) => {
    providers.push(provider);
    return provider === "openai" ? "sk-api-key" : token;
  }, new AbortController().signal, async () => Response.json({}));
  assert.deepEqual(providers, ["openai", "openai-codex"]);
});

test("never requests quota for other providers, API keys or aborted sessions", async () => {
  for (const [provider, credential, aborted] of [
    ["anthropic", token, false], ["openai-codex", "sk-api-key", false],
    ["openai", undefined, false], ["openai-codex", token, true],
  ] as const) {
    const controller = new AbortController();
    if (aborted) controller.abort();
    const result = await fetchSessionLimit(provider, async () => credential, controller.signal,
      async () => { throw new Error("Unexpected request"); });
    assert.equal(result, undefined);
  }
});

test("unsuccessful responses do not produce a quota", async () => {
  assert.equal(await fetchSessionLimit("openai-codex", async () => token,
    new AbortController().signal, async () => new Response("", { status: 401 })), undefined);
});
