import type { AiAnswer, AiContext } from "./engine";

/**
 * Client du proxy IA (facultatif). Aucune clé n'est jamais présente dans l'app : seule l'URL publique
 * du proxy est configurée au build (NEXT_PUBLIC_AI_PROXY_URL). Le proxy détient la clé, applique quotas,
 * limite de débit et budget, et ne reçoit que des extraits déjà collectés (pas d'historique, pas d'identité).
 */
const URL_ = process.env.NEXT_PUBLIC_AI_PROXY_URL || "";

export const proxyEnabled = () => URL_.startsWith("https://");

export async function askProxy(question: string, ctx: AiContext, local: AiAnswer): Promise<AiAnswer | null> {
  if (!proxyEnabled() || !ctx.feed) return null;
  const p = ctx.state.profile;
  // contexte minimal et anonyme ; extraits = titres et faits de fiches visibles (anti-spoiler déjà appliqué côté moteur local)
  const snippets = ctx.feed.items
    .filter((r) => r.status === "active" && (r.details?.chapter?.value ?? 0) <= p.chapter && r.spoiler !== "high")
    .slice(0, 40)
    .map((r) => ({ id: r.id, title: r.title, reliability: r.reliability, place: r.details?.place?.value.name ?? null, reward: r.conditions.reward, url: r.evidence[0]?.url ?? null }));
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: question.slice(0, 300), player: { chapter: p.chapter, edition: p.edition, preorder: p.preorder, spoiler: p.spoilerMode }, snippets, local: { title: local.title } }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; lines?: string[]; recordIds?: string[] };
  if (typeof j.title !== "string") return null;
  const ids = (j.recordIds ?? []).filter((id) => snippets.some((s) => s.id === id)).slice(0, 2);
  return {
    intent: "llm",
    title: j.title.slice(0, 200),
    lines: (j.lines ?? []).filter((l) => typeof l === "string").slice(0, 5).map((l) => l.slice(0, 240)),
    reliability: "non établi",
    sources: ids.map((id) => snippets.find((s) => s.id === id)!).filter((s) => s.url).map((s) => ({ name: s.title.slice(0, 40), url: s.url!, when: null })),
    actions: ids.map((id) => ({ type: "open_record" as const, id, label: "Ouvrir la fiche" })),
    note: "Synthèse IA à partir des fiches collectées : vérifie les sources.",
  };
}
