import { answer, isValidAction } from "../ai/engine";
import type { AiAction, AiAnswer, AiContext, Source, Topic } from "../ai/engine";
import { frHeadline } from "../fr";
import { glossaryOf, nk } from "../missions";
import { spoilerVisibility } from "../feed";
import { buildEvidence, playerContext } from "./context";
import { META_MARK, RULES, composeTurn } from "./prompt";
import { LlmError } from "./types";
import type { CopilotAnswer, LlmMessage, LlmTransport, Trust } from "./types";

/**
 * Moteur conversationnel indépendant du fournisseur :
 * recherche ciblée (moteur déterministe) → preuves → Claude rédige → validation → actions contrôlées.
 * Sans transport, ou si le transport échoue, la réponse vérifiée du moteur direct est rendue telle quelle (dite « directe »).
 */

const TRUST: Trust[] = ["officiel", "recoupé", "signalé", "non établi", "déclaré par toi"];
const NUM = /\d[\d\s  .,]*\d|\d/g;
const digits = (s: string) => (s.match(NUM) ?? []).map((n) => n.replace(/[\s  .,]/g, "")).filter(Boolean);

export function fromDirect(a: AiAnswer, note?: string): CopilotAnswer {
  return { intent: a.intent, message: a.text, trust: a.reliability, sources: a.sources, actions: a.actions, topic: a.topic ?? null, replies: a.replies, more: a.more, engine: "direct", note, evidence: a.evidence };
}

/** Quand le moteur n'a rien ciblé (« demande floue »), quelques fiches qui partagent un nom propre ou un mot rare avec la question. */
export function extraEvidence(q: string, ctx: AiContext, limit = 4): string[] {
  if (!ctx.feed) return [];
  const p = ctx.state.profile;
  const words = nk(q)
    .split(" ")
    .filter((w) => w.length >= 5 && !["comment", "quelle", "quelles", "quels", "trouver", "faire", "est-ce", "pourquoi", "combien", "mission", "partie", "chapitre"].includes(w));
  if (!words.length) return [];
  const g = glossaryOf(ctx.feed);
  return ctx.feed.items
    .filter((r) => r.status === "active" && r.category !== "news" && spoilerVisibility(r, p.spoilerMode, p.chapter) === "visible")
    .map((r) => {
      const blob = nk(`${r.title} ${frHeadline(r, g)} ${r.details?.place?.value.name ?? ""} ${r.details?.mission?.value ?? ""}`);
      return { r, s: words.filter((w) => blob.includes(w)).length };
    })
    .filter((x) => x.s >= Math.min(2, words.length))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r.id);
}

/** Lit « réponse @@@ {json} » ; tolère l'absence du JSON (la réponse reste lisible). */
export function parseReply(raw: string): { message: string; meta: { confiance?: string; sources?: unknown; actions?: unknown } | null } {
  const i = raw.indexOf(META_MARK);
  const message = (i >= 0 ? raw.slice(0, i) : raw).trim();
  if (i < 0) return { message, meta: null };
  const tail = raw.slice(i + META_MARK.length);
  const a = tail.indexOf("{");
  const b = tail.lastIndexOf("}");
  try {
    return { message, meta: a >= 0 && b > a ? JSON.parse(tail.slice(a, b + 1)) : null };
  } catch {
    return { message, meta: null };
  }
}

/** Partie affichable pendant le streaming : tout ce qui précède le séparateur. */
export const visiblePart = (text: string) => {
  const i = text.indexOf(META_MARK);
  const v = i >= 0 ? text.slice(0, i) : text.replace(/@{1,2}$/, "");
  return v.trimEnd();
};

export interface AskOptions {
  question: string;
  ctx: AiContext;
  topic: Topic | null;
  /** Derniers échanges (texte), pour les questions de suivi. */
  history: LlmMessage[];
  transport: LlmTransport | null;
  onText?: (visible: string) => void;
  signal?: AbortSignal;
  tier?: "quick" | "default";
}

const NOTE: Record<string, string> = {
  not_granted: "Tu n'as pas autorisé cette app à utiliser Claude : réponse directe, à partir des données vérifiées.",
  sampling_disabled: "Claude n'est pas disponible sur ce compte : réponse directe.",
  rate_limited: "Limite d'utilisation de Claude atteinte pour le moment : réponse directe. Réessaie un peu plus tard.",
  session_expired: "Session Claude expirée : reconnecte-toi. Réponse directe en attendant.",
  refused: "Claude n'a pas répondu à cette demande : réponse directe.",
  unavailable: "Claude n'est pas joignable ici : réponse directe.",
};

export async function askCopilot(o: AskOptions): Promise<CopilotAnswer> {
  const draft = answer(o.question, o.ctx, o.topic);
  draft.actions = draft.actions.filter((x) => isValidAction(x, o.ctx.feed)).slice(0, 2);
  if (!o.transport || !o.ctx.feed) return fromDirect(draft);

  const ids = [...new Set([...(draft.evidence ?? []), ...(draft.evidence?.length ? [] : extraEvidence(o.question, o.ctx))])];
  const evidence = buildEvidence(o.ctx.feed, ids, o.ctx.places ?? []);
  const actions: AiAction[] = draft.actions;
  const hint = draft.intent === "clarify" ? "Entité incertaine : pose une question de précision si nécessaire." : "Vérifie les faits dans les PREUVES. Le moteur local fournit seulement des garde-fous et des actions, pas une réponse à paraphraser.";
  const messages: LlmMessage[] = [
    { role: "user", content: RULES },
    ...o.history.slice(-12),
    { role: "user", content: composeTurn({ question: o.question, player: playerContext(o.ctx.state, o.ctx.feed), evidence, hint, actions }) },
  ];
  // les tours consécutifs de même rôle sont acceptés ; la liste doit finir par « user »
  try {
    const r = await o.transport.generate({ messages, signal: o.signal, tier: o.tier ?? "quick", onText: (t) => o.onText?.(visiblePart(t)) });
    const { message, meta } = parseReply(r.text);
    if (!message) return fromDirect(draft, NOTE.refused);
    // Validation : aucun nombre absent des preuves, du contexte, de la question ou de la piste vérifiée
    const allowed = new Set([...digits(evidence), ...digits(draft.text), ...digits(o.question), ...digits(playerContext(o.ctx.state, o.ctx.feed)), "1", "2", "3", "4"]);
    const bad = digits(message).filter((n) => !allowed.has(n));
    if (bad.length) return fromDirect(draft, `Réponse du modèle écartée : elle citait un chiffre absent des sources (${bad.slice(0, 2).join(", ")}). Voici la réponse vérifiée.`);
    const idx = Array.isArray(meta?.actions) ? (meta!.actions as unknown[]).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < actions.length) : null;
    const chosen = (idx && idx.length ? idx.map((i) => actions[i]) : actions).slice(0, 2);
    const used = Array.isArray(meta?.sources) ? (meta!.sources as unknown[]).map(String).filter((s) => ids.includes(s)) : [];
    const trust = TRUST.includes(meta?.confiance as Trust) ? (meta!.confiance as Trust) : draft.reliability;
    const sources: Source[] = sourcesFor(used.length ? used : ids, o.ctx, draft.sources);
    return {
      intent: draft.intent,
      message: message.slice(0, 2300),
      trust,
      sources,
      actions: chosen,
      topic: draft.topic ?? o.topic,
      replies: draft.replies,
      more: draft.more,
      engine: o.transport.id === "openai-api" ? "gpt" : "claude",
      model: r.model,
      note: r.truncated ? "Réponse coupée par la limite de longueur." : undefined,
      evidence: ids,
    };
  } catch (e) {
    const code = e instanceof LlmError ? e.code : "upstream_error";
    if (code === "cancelled") {
      const partial = e instanceof LlmError && e.partial ? visiblePart(e.partial) : "";
      return { ...fromDirect(draft), message: partial || draft.text, engine: partial ? (o.transport.id === "openai-api" ? "gpt" : "claude") : "direct", note: "Réponse interrompue." };
    }
    return fromDirect(draft, NOTE[code] ?? "Le modèle n'a pas pu répondre (erreur passagère) : réponse directe. Tu peux reposer la question.");
  }
}

function sourcesFor(ids: string[], ctx: AiContext, fallback: Source[]): Source[] {
  const out: Source[] = [];
  for (const id of ids) {
    const r = ctx.feed?.items.find((x) => x.id === id);
    if (r) for (const e of r.evidence.slice(0, 2)) out.push({ name: e.sourceName.replace(/\s*\([^)]*\)\s*$/, ""), url: e.url, when: (e.publishedAt ?? r.firstSeenAt).slice(0, 10), title: e.title, quote: e.quotes?.[0] });
    const v = ctx.feed?.vehicles?.find((x) => x.id === id);
    if (v) for (const e of v.evidence.slice(0, 2)) out.push({ name: e.sourceName.replace(/\s*\([^)]*\)\s*$/, ""), url: e.url, when: null, title: e.title });
    if (id.startsWith("poi:") && !out.some((s) => s.url === "https://map.gtadb.org")) out.push({ name: "gtadb.org (carte communautaire)", url: "https://map.gtadb.org", when: null });
  }
  return (out.length ? out : fallback).slice(0, 4);
}
