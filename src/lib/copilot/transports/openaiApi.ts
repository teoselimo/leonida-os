import { LlmError } from "../types";
import type { LlmRequest, LlmResult, LlmTransport } from "../types";

/** POC personnel : code d'accès LEONIDA uniquement, JAMAIS de clé API OpenAI dans le navigateur. */
const ENDPOINT = process.env.NEXT_PUBLIC_GPT_PROXY_URL || "";
const ENABLED = process.env.NEXT_PUBLIC_GPT_ENABLED === "1" && ENDPOINT.startsWith("https://");
const ACCESS_KEY = "leonida-os/gpt-access/v1";
export const gptApiEnabled = () => ENABLED;
const access = (): string => { try { return sessionStorage.getItem(ACCESS_KEY) || ""; } catch { return ""; } };
export function saveGptAccessCode(code: string): void { sessionStorage.setItem(ACCESS_KEY, code); }
export function clearGptAccessCode(): void { sessionStorage.removeItem(ACCESS_KEY); }

/** Le serveur Cloudflare vérifie le code, le budget, le modèle et les consignes GTA avant l'appel OpenAI. */
export const openaiApiTransport: LlmTransport = {
  id: "openai-api",
  label: "GPT · LEONIDA privé",
  async available() { return ENABLED && !!access(); },
  async generate(req: LlmRequest): Promise<LlmResult> {
    if (!ENABLED) throw new LlmError("unavailable");
    const key = access();
    if (!key) throw new LlmError("not_granted", "Code personnel LEONIDA requis");
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST", signal: req.signal,
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ messages: req.messages.slice(-16), tier: req.tier ?? "quick" }),
      });
    } catch (e) { throw new LlmError(req.signal?.aborted ? "cancelled" : "unavailable", String(e)); }
    if (res.status === 401 || res.status === 403) throw new LlmError("not_granted", "Code LEONIDA invalide");
    if (res.status === 429 || res.status === 402) throw new LlmError("rate_limited", "Budget mensuel ou quota de test atteint");
    if (!res.ok || !res.body) throw new LlmError("upstream_error", "GPT HTTP " + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ""; let answer = ""; let model = "GPT"; let done = false;
    const processEvent = (part: string) => {
      const raw = part.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!raw) return;
      let event: { type?: string; text?: string; model?: string; code?: string };
      try { event = JSON.parse(raw); } catch { return; }
      if (event.type === "delta" && typeof event.text === "string") { answer += event.text; req.onText?.(answer); }
      if (event.type === "done") { done = true; if (event.model) model = event.model; }
      if (event.type === "error") throw new LlmError(event.code ?? "upstream_error");
    };
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const event of events) processEvent(event);
      }
      if (buffer.trim()) processEvent(buffer);
      if (!done || !answer.trim()) throw new LlmError("upstream_error", "Réponse incomplète");
      return { text: answer, model, truncated: false };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(req.signal?.aborted ? "cancelled" : "upstream_error", String(e), answer);
    } finally { reader.releaseLock(); }
  },
};
