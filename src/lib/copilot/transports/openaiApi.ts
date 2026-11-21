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
        body: JSON.stringify({ messages: req.messages.slice(-16), tier: req.tier ?? "quick", web: req.web === true }),
      });
    } catch (e) {
      throw new LlmError(req.signal?.aborted ? "cancelled" : "network_error", req.signal?.aborted ? "Requête annulée" : "Connexion au Worker impossible (réseau ou CORS)");
    }
    // Ne jamais afficher les en-têtes, les secrets ni le corps brut d'une erreur OpenAI.
    // Le Worker ne renvoie que des codes sûrs et une indication HTTP.
    if (!res.ok || !res.body) {
      let serverError = "";
      try {
        const body = await res.json() as { error?: unknown };
        if (typeof body.error === "string") serverError = body.error.slice(0, 100);
      } catch { /* Cloudflare peut renvoyer du HTML sur une erreur 5xx */ }
      if (res.status === 401) throw new LlmError("not_granted", "Code d'accès LEONIDA refusé (401)");
      if (res.status === 403) throw new LlmError("origin_rejected", "Origine de l'application refusée (403)");
      if (res.status === 429 || res.status === 402) throw new LlmError("rate_limited", "Plafond ou quota de notre Worker atteint (" + res.status + ")");
      if (res.status === 409 && serverError === "web_search_disabled") throw new LlmError("web_search_disabled", "Recherche web pas encore activée dans Cloudflare");
      if (res.status === 413) throw new LlmError("request_too_large", "Contexte envoyé trop volumineux (413)");
      if (res.status === 503) throw new LlmError(serverError.includes("budget guard") ? "ledger_unavailable" : "server_disabled", "Worker indisponible (503 : " + (serverError || "service") + ")");
      if (res.status === 502 && serverError.includes("upstream rejected")) {
        const status = Number(serverError.match(/\d{3}/)?.[0]);
        if (status === 401) throw new LlmError("openai_key", "OpenAI refuse la clé API (401)");
        if (status === 429 || status === 402) throw new LlmError("openai_quota", "OpenAI refuse la requête : crédit ou quota API (429/402)");
        if (status === 403) throw new LlmError("openai_access", "Accès au projet ou au modèle refusé par OpenAI (403)");
        if (status === 400 || status === 404) throw new LlmError("openai_request", "OpenAI rejette les paramètres ou le modèle (" + status + ")");
        throw new LlmError("openai_upstream", "OpenAI a refusé l'appel (" + status + ")");
      }
      throw new LlmError("upstream_error", "Worker GPT HTTP " + res.status + (serverError ? " : " + serverError : ""));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ""; let answer = ""; let model = "GPT"; let done = false;
    const webSources = new Map<string, { url: string; title: string }>();
    const processEvent = (part: string) => {
      const raw = part.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!raw) return;
      let event: { type?: string; text?: string; model?: string; code?: string; sources?: { url?: string; title?: string }[] };
      try { event = JSON.parse(raw); } catch { return; }
      if (event.type === "delta" && typeof event.text === "string") { answer += event.text; req.onText?.(answer); }
      if (event.type === "sources" && Array.isArray(event.sources)) {
        for (const source of event.sources) {
          try {
            if (typeof source.url !== "string") continue;
            const url = new URL(source.url);
            if (url.protocol !== "https:" || url.username || url.password) continue;
            if (!webSources.has(url.href)) webSources.set(url.href, {
              url: url.href, title: (source.title || url.hostname).slice(0, 110),
            });
          } catch { /* malformed URL */ }
        }
      }
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
      return { text: answer, model, truncated: false, webSources: Array.from(webSources.values()).slice(0, 5) };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(req.signal?.aborted ? "cancelled" : "upstream_error", String(e), answer);
    } finally { reader.releaseLock(); }
  },
};
