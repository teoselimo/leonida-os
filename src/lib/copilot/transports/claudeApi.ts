import { LlmError } from "../types";
import type { LlmRequest, LlmResult, LlmTransport } from "../types";

/**
 * Transport « API Claude » (FUTUR, désactivé) : même contrat que l'Artifact, via un backend sécurisé
 * (clé côté serveur, authentification, quotas et budget atomiques — voir issue #8 et docs/ARTIFACT-PILOTE.md).
 *
 * Activation : NEXT_PUBLIC_AI_API_URL (https) ET NEXT_PUBLIC_AI_API_ENABLED=1 au build, après décision du propriétaire.
 * Le backend attend { messages, tier } et répond en flux texte (SSE « data: » ou texte brut).
 */
const URL_ = process.env.NEXT_PUBLIC_AI_API_URL || "";
const ENABLED = process.env.NEXT_PUBLIC_AI_API_ENABLED === "1" && URL_.startsWith("https://");

export const claudeApiTransport: LlmTransport = {
  id: "claude-api",
  label: "Claude · API LEONIDA",
  async available() {
    return ENABLED;
  },
  async generate(req: LlmRequest): Promise<LlmResult> {
    if (!ENABLED) throw new LlmError("unavailable");
    const res = await fetch(URL_, {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json" },
      credentials: "include", // session authentifiée côté backend (jamais de clé dans l'app)
      body: JSON.stringify({ messages: req.messages, tier: req.tier ?? "quick" }),
    }).catch((e) => {
      throw new LlmError(req.signal?.aborted ? "cancelled" : "upstream_error", String(e));
    });
    if (res.status === 429) throw new LlmError("rate_limited");
    if (res.status === 401 || res.status === 403) throw new LlmError("not_granted");
    if (!res.ok || !res.body) throw new LlmError("upstream_error", `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      text += chunk.startsWith("data:") ? chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("") : chunk;
      req.onText?.(text);
    }
    return { text, model: res.headers.get("x-model") ?? "Claude (API)" };
  },
};
