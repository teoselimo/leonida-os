import { expect, test } from "@playwright/test";
import worker, { classifyOpenAiStreamError } from "../proxy/openai-worker";
import type { Env } from "../proxy/openai-worker";

/** Tests sans réseau ni clés réelles : flux OpenAI simulés, réserve budgétaire simulée. */
const env = (): Env => ({
  AI_ENABLED: "1",
  OPENAI_API_KEY: "mock-openai-key",
  LEONIDA_ACCESS_TOKEN: "mock-leonida-access",
  MODEL: "gpt-6.1-terra",
  ALLOWED_ORIGIN: "https://teoselimo.github.io",
  MONTHLY_BUDGET_USD: "2.00",
  MAX_CALLS_PER_MONTH: "400",
  MAX_CALLS_PER_MINUTE: "6",
  BUDGET: {
    idFromName: () => "test-ledger",
    get: () => ({
      fetch: async () => new Response('{"status":"ok"}', { status: 200 }),
    }),
  },
});
const post = () => new Request("https://example.workers.dev/v1/chat", {
  method: "POST",
  headers: {
    origin: "https://teoselimo.github.io",
    authorization: "Bearer mock-leonida-access",
    "content-type": "application/json",
  },
  body: JSON.stringify({ messages: [{ role: "user", content: "Bonjour Leonida !" }], tier: "quick" }),
});
const sse = (...events: object[]) => events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("");

async function simulate(upstream: string, status = 200): Promise<{ status: number; body: string }> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(upstream, { status, headers: { "content-type": "text/event-stream" } });
  try {
    const res = await worker.fetch(post(), env());
    return { status: res.status, body: await res.text() };
  } finally {
    globalThis.fetch = original;
  }
}

test("GPT Worker streams a complete response and preserves the done event", async () => {
  const result = await simulate(sse(
    { type: "response.output_text.delta", delta: "Bienvenue à Leonida." },
    { type: "response.completed", response: { model: "gpt-6.1-terra", usage: { input_tokens: 100, output_tokens: 80 } } },
  ));
  expect(result.status).toBe(200);
  expect(result.body).toContain('"type":"delta"');
  expect(result.body).toContain('"type":"done"');
  expect(result.body).not.toContain('"type":"error"');
});

test("GPT Worker classifies incomplete output-token generations", async () => {
  const result = await simulate(sse({
    type: "response.incomplete",
    response: { incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 300, output_tokens: 1600 } },
  }));
  expect(result.status).toBe(200);
  expect(result.body).toContain('"code":"upstream_output_limit"');
});

test("GPT Worker classifies provider server errors without exposing the raw message", async () => {
  const result = await simulate(sse({
    type: "response.failed",
    response: { error: { code: "server_error", message: "PRIVATE BACKEND DETAIL" } },
  }));
  expect(result.body).toContain('"code":"upstream_failed_server"');
  expect(result.body).not.toContain("PRIVATE BACKEND DETAIL");
});

test("GPT Worker uses final output text when streamed deltas were absent", async () => {
  const result = await simulate(sse({
    type: "response.completed",
    response: {
      model: "gpt-6.1-terra",
      usage: { input_tokens: 200, output_tokens: 40 },
      output: [{ type: "message", content: [{ type: "output_text", text: "Leonida te souhaite bienvenue." }] }],
    },
  }));
  expect(result.body).toContain("Leonida te souhaite bienvenue.");
  expect(result.body).toContain('"type":"done"');
});

test("Classifies OpenAI SSE root error without leaking raw message", async () => {
  expect(classifyOpenAiStreamError({ code: "insufficient_quota", message: "Sensitive API detail" })).toBe("openai_stream_quota");
  expect(classifyOpenAiStreamError({ error: { code: "rate_limit_exceeded" } })).toBe("openai_stream_rate_limit");
  expect(classifyOpenAiStreamError({ code: "server_error" })).toBe("openai_stream_server");
  const result = await simulate(sse({ type: "error", code: "insufficient_quota", message: "SECRET_PAYLOAD" }));
  expect(result.body).toContain('"code":"openai_stream_quota"');
  expect(result.body).not.toContain("SECRET_PAYLOAD");
});

test("Web mode is disabled without Cloudflare explicit opt-in", async () => {
  const req = post();
  const body = JSON.stringify({ messages: [{ role: "user", content: "Trouve un guide récent" }], web: true });
  const response = await worker.fetch(new Request(req.url, { method: "POST", headers: req.headers, body }), env());
  expect(response.status).toBe(409);
  expect(await response.text()).toContain("web_search_disabled");
});

test("Web research is strictly one tool call and returns verifiable citation links", async () => {
  const request = post();
  const original = globalThis.fetch;
  const captured: { body?: Record<string, unknown> } = {};
  globalThis.fetch = async (_input, init) => {
    captured.body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(sse(
      { type: "response.output_item.added", item: { type: "web_search_call", id: "web_1" } },
      { type: "response.output_text.delta", delta: "Informations récentes vérifiées." },
      { type: "response.completed", response: {
        model: "gpt-6.1-terra",
        usage: { input_tokens: 900, output_tokens: 100 },
        output: [
          { type: "web_search_call", id: "web_1" },
          { type: "message", content: [{
            type: "output_text", text: "Informations récentes vérifiées.",
            annotations: [{ type: "url_citation", url: "https://www.rockstargames.com/", title: "Rockstar Games" }],
          }] },
        ],
      } },
    ), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const liveEnv = { ...env(), WEB_SEARCH_ENABLED: "1" };
    const res = await worker.fetch(new Request(request.url, {
      method: "POST", headers: request.headers,
      body: JSON.stringify({ messages: [{ role: "user", content: "Actualités officielles récentes ?" }], web: true }),
    }), liveEnv);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(captured.body?.max_tool_calls).toBe(1);
    expect(Array.isArray(captured.body?.tools)).toBe(true);
    expect(body).toContain('"type":"sources"');
    expect(body).toContain("https://www.rockstargames.com/");
    expect(body).toContain('"type":"done"');
  } finally {
    globalThis.fetch = original;
  }
});
