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
  /** Le joueur demande explicitement une recherche web pour ce tour. */
  web?: boolean;
}

const NOTE: Record<string, string> = {
  not_granted: "Accès au modèle non autorisé ou code LEONIDA incorrect : réponse directe, à partir des données vérifiées.",
  sampling_disabled: "Le modèle n'est pas disponible pour le moment : réponse directe.",
  rate_limited: "Quota du modèle ou budget du pilote atteint : réponse directe. Le coût est bloqué côté serveur.",
  session_expired: "Session du modèle expirée : reconnecte-toi. Réponse directe en attendant.",
  refused: "Claude n'a pas répondu à cette demande : réponse directe.",
  unavailable: "Le modèle n'est pas joignable ici : réponse directe.",
  network_error: "Impossible de joindre le Worker GPT depuis Safari. Vérifie le réseau et l'autorisation du domaine (CORS).",
  origin_rejected: "Le serveur GPT a refusé l'origine de cette préversion. Vérifier ALLOWED_ORIGIN dans Cloudflare.",
  server_disabled: "GPT n'est pas complètement activé côté Cloudflare : vérifie AI_ENABLED=1 et les deux secrets dans Production.",
  ledger_unavailable: "Le contrôle budgétaire Cloudflare ne répond pas (Durable Object BUDGET). Aucun appel OpenAI n'a été lancé.",
  openai_key: "OpenAI a refusé la clé API. Vérifie la clé du projet LEONIDA OS dans les secrets Cloudflare.",
  openai_quota: "OpenAI a refusé l'appel pour une question de crédit ou de quota API. Vérifie le solde et la facturation du projet OpenAI Platform.",
  openai_access: "Le projet API OpenAI n'a pas les autorisations nécessaires pour ce modèle.",
  openai_request: "OpenAI rejette la configuration du modèle ou les paramètres. Le connecteur doit être corrigé.",
  openai_upstream: "L'API OpenAI a refusé la requête. Le journal Cloudflare donnera le code précis.",
  request_too_large: "La conversation est trop longue pour notre passerelle. Essaie une nouvelle conversation après Effacer.",
  upstream_output_limit: "GPT a atteint sa limite de génération avant de terminer. Le budget de tokens du serveur a été augmenté.",
  upstream_incomplete: "La génération GPT s'est interrompue sans réponse complète. Le Worker a reçu un événement OpenAI « incomplete ».",
  upstream_failed: "OpenAI a indiqué que la génération avait échoué (response.failed). Réessaie une fois ; si cela persiste, regarde les journaux du Worker.",
  upstream_failed_server: "OpenAI a renvoyé une erreur de génération côté serveur (server_error).",
  upstream_event_error: "OpenAI a envoyé un événement d'erreur pendant la génération.",
  upstream_stream: "Le flux entre OpenAI et Cloudflare a été interrompu avant la fin de la réponse.",
  upstream_stream_ended: "Le flux s'est terminé sans confirmation de fin de génération.",
  upstream_no_text: "OpenAI a terminé la génération sans produire de texte utilisable.",
  upstream_unknown: "Une erreur non classée a interrompu le streaming GPT. Consulte les journaux Cloudflare.",
  upstream_error: "Le streaming GPT a échoué. Recharge la préversion pour récupérer le diagnostic détaillé du Worker.",
  openai_stream_quota: "Le flux OpenAI indique un quota ou des crédits API insuffisants.",
  openai_stream_rate_limit: "OpenAI a limité momentanément la fréquence des appels. Réessaie plus tard.",
  openai_stream_auth: "OpenAI a refusé l'authentification de la clé du projet API.",
  openai_stream_model: "Le flux OpenAI indique un modèle indisponible pour ce projet.",
  openai_stream_context: "Le contexte de la conversation dépasse la limite acceptée par OpenAI.",
  openai_stream_request: "OpenAI a signalé un paramètre de requête invalide pendant le streaming.",
  openai_stream_server: "OpenAI a indiqué une erreur serveur durant la génération.",
  openai_stream_timeout: "OpenAI a dépassé son délai de réponse.",
  openai_stream_content_filter: "OpenAI a interrompu cette réponse pour des raisons de sécurité.",
  web_search_disabled: "La recherche web n'est pas encore activée sur le Worker Cloudflare. Désactive le bouton Web pour continuer en mode GPT sans recherche.",
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
    const r = await o.transport.generate({ messages, signal: o.signal, tier: o.tier ?? "quick", web: o.web === true, onText: (t) => o.onText?.(visiblePart(t)) });
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
    const localSources: Source[] = sourcesFor(used.length ? used : ids, o.ctx, draft.sources);
    // Une source web est affichée uniquement si l'API l'a renvoyée comme annotation.
    // Ne pas accepter de liens improvisés par le texte généré.
    const webSources: Source[] = (r.webSources ?? []).slice(0, 5).map((s) => ({
      name: s.title || new URL(s.url).hostname, title: s.title, url: s.url, when: null, kind: "web" as const,
    }));
    const sources: Source[] = [...webSources, ...localSources.filter((s) => !webSources.some((w) => w.url === s.url))].slice(0, 8);
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
    return fromDirect(draft, NOTE[code] ?? (o.transport.id === "openai-api" && e instanceof LlmError ? `GPT : ${e.message}. Réponse directe en attendant.` : "Le modèle n'a pas pu répondre (erreur passagère) : réponse directe. Tu peux reposer la question."));
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
