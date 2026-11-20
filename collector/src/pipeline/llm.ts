import type { RadarRecord, SourceConfig } from "../types.ts";

/**
 * Enrichissement IA OPTIONNEL (ANTHROPIC_API_KEY). Désactivé par défaut.
 * Garde-fous :
 *  - jamais appliqué aux sources marquées noAI (Rockstar) ;
 *  - le modèle ne reçoit que le titre et l'extrait court déjà collectés ;
 *  - tout champ doit être justifié par une citation EXACTE du texte fourni, sinon il est rejeté (null) ;
 *  - n'influence jamais la fiabilité : une réponse de modèle ne rend rien « vérifié ».
 */
export interface LlmFields {
  titleFr: string | null;
  summaryFr: string | null;
  quotes: string[];
}

export function verifyQuotes(source: string, quotes: unknown): string[] {
  if (!Array.isArray(quotes)) return [];
  return quotes.filter((q): q is string => typeof q === "string" && q.length >= 4 && source.includes(q));
}

export async function enrichWithLLM(
  records: RadarRecord[],
  sources: Map<string, SourceConfig>,
  opts: { env: Record<string, string | undefined>; fetchImpl?: typeof fetch },
  log: (m: string) => void,
): Promise<void> {
  const key = opts.env.ANTHROPIC_API_KEY;
  if (!key || !records.length) return;
  const model = opts.env.ANTHROPIC_MODEL;
  if (!model) {
    log("– IA : ANTHROPIC_MODEL non défini, enrichissement ignoré");
    return;
  }
  const max = Number(opts.env.LLM_MAX_CALLS_PER_RUN || 10);
  const f = opts.fetchImpl ?? fetch;
  let calls = 0;
  for (const r of records) {
    if (calls >= max) break;
    if (r.evidence.some((e) => sources.get(e.sourceId)?.noAI)) continue;
    const text = r.evidence.map((e) => `${e.title}\n${e.excerpt}`).join("\n---\n");
    calls++;
    try {
      const res = await f("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          system:
            "Tu traduis et résumes en français des métadonnées d'articles/vidéos GTA VI. N'invente rien : uniquement ce que le texte dit. Réponds en JSON {\"titleFr\":string,\"summaryFr\":string,\"quotes\":string[]} où quotes sont des extraits EXACTS du texte justifiant le résumé. Si le texte ne prouve rien, dis-le dans summaryFr.",
          messages: [{ role: "user", content: text }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { content: Array<{ text?: string }> };
      const json = JSON.parse((body.content[0]?.text ?? "{}").replace(/^```json|```$/g, "").trim()) as Partial<LlmFields>;
      const quotes = verifyQuotes(text, json.quotes);
      if (!quotes.length) continue; // résumé non justifié : rejeté
      (r as RadarRecord & { titleFr?: string; summaryFr?: string }).titleFr = typeof json.titleFr === "string" ? json.titleFr.slice(0, 120) : undefined;
      (r as RadarRecord & { titleFr?: string; summaryFr?: string }).summaryFr = typeof json.summaryFr === "string" ? json.summaryFr.slice(0, 300) : undefined;
    } catch (e) {
      log(`✗ IA : ${(e as Error).message}`);
    }
  }
}
