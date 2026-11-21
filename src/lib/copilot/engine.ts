import { answer, isValidAction } from "../ai/engine";
import type { AiAction, AiAnswer, AiContext, Source, Topic } from "../ai/engine";
import { frHeadline } from "../fr";
import { glossaryOf, missionBrief, nk } from "../missions";
import { spoilerVisibility } from "../feed";
import { buildEvidence, playerContext } from "./context";
import type { WebEvidence } from "./context";
import { META_MARK, RULES, composeTurn } from "./prompt";
import { LlmError } from "./types";
import type { ChecklistItem, CopilotAnswer, LlmMessage, LlmTransport, Trust, WebHit, WebSearchFn, WebStatus } from "./types";

/**
 * Moteur conversationnel indépendant du fournisseur :
 * recherche ciblée (moteur déterministe) → preuves → Claude rédige → validation → actions contrôlées.
 * Sans transport, ou si le transport échoue, la réponse vérifiée du moteur direct est rendue telle quelle (dite « directe »).
 */

const TRUST: Trust[] = ["officiel", "recoupé", "signalé", "non établi", "déclaré par toi"];
const NUM = /\d[\d\s  .,]*\d|\d/g;
export const digits = (s: string) => (s.match(NUM) ?? []).map((n) => n.replace(/[\s  .,]/g, "")).filter(Boolean);

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
  /** Étape en cours, pour l'affichage (« Recherche web… »). */
  onStage?: (stage: "search" | "write") => void;
  signal?: AbortSignal;
  tier?: "quick" | "default";
  /** « checklist » : analyse « Rien à manquer » de `mission`. */
  mode?: "chat" | "checklist";
  mission?: string;
  /** Recherche web fournie par l'environnement ; absente = pas de web. */
  search?: WebSearchFn | null;
}

const NOTE: Record<string, string> = {
  not_granted: "Tu n'as pas autorisé cette app à utiliser Claude : réponse directe, à partir des données vérifiées.",
  sampling_disabled: "Claude n'est pas disponible sur ce compte : réponse directe.",
  rate_limited: "Limite d'utilisation de Claude atteinte pour le moment : réponse directe. Réessaie un peu plus tard.",
  session_expired: "Session Claude expirée : reconnecte-toi. Réponse directe en attendant.",
  refused: "Claude n'a pas répondu à cette demande : réponse directe.",
  unavailable: "Claude n'est pas joignable ici : réponse directe.",
};

/** Le joueur demande explicitement une recherche web / l'info la plus récente. */
const WEB_ASK = /\b(cherche|recherche|regarde|google|web|internet|en ligne|sur le net|derni[eè]res? infos?|actu|reddit|youtube)\b/i;
/** Question factuelle (vaut une recherche web quand le Radar n'a rien). */
const FACTUAL = /\b(o[uù]|comment|combien|quand|quel(le)?s?|est-ce|faut-il|r[eé]compense|manquable|cach[ée]|trouver|d[ée]bloquer)\b|\?/i;
/** Messages de conversation pure : pas de faits à injecter, pas de recherche. */
const SMALLTALK = new Set(["hello", "thanks"]);

/** Demande explicite de carte (« montre-moi », « où est », « sur la carte »). */
const WANTS_MAP = /\b(montre|affiche|carte|o[uù] (est|se trouve|sont)|emm[eè]ne|guide-moi|centre)\b/i;
const MAX_HISTORY = 16;
const MAX_ANSWER = 3_000;

function webQuery(o: AskOptions): string {
  const m = o.mission ?? o.ctx.state.profile.nextMission ?? "";
  if (o.mode === "checklist") return `GTA 6 "${m}" mission walkthrough missable collectibles rewards`;
  const clean = o.question.replace(WEB_ASK, " ").replace(/\s+/g, " ").trim();
  return `GTA 6 ${m && !clean.toLowerCase().includes(m.toLowerCase()) && /\b(l[aà]|cette mission|ici)\b/i.test(clean) ? `"${m}" ` : ""}${clean}`.slice(0, 200);
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
};

export async function askCopilot(o: AskOptions): Promise<CopilotAnswer> {
  const checklist = o.mode === "checklist" && !!o.mission;
  const draft = answer(checklist ? `Je vais lancer ${o.mission}` : o.question, o.ctx, o.topic);
  draft.actions = draft.actions.filter((x) => isValidAction(x, o.ctx.feed)).slice(0, 3);
  if (!o.transport || !o.ctx.feed) return fromDirect(draft);

  // 1. Preuves LEONIDA RADAR
  let ids = [...new Set(draft.evidence ?? [])];
  if (checklist) {
    const p = o.ctx.state.profile;
    const b = missionBrief(o.ctx.feed, o.mission!, { chapter: p.chapter, spoilerMode: p.spoilerMode, done: o.ctx.state.done });
    ids = [...new Set([...b.during.map((r) => r.id), ...b.before.map((r) => r.id), ...(b.guide ? [b.guide.id] : []), ...ids, ...extraEvidence(o.mission!, o.ctx, 3)])];
  } else if (!ids.length) ids = extraEvidence(o.question, o.ctx);

  // 2. Recherche web (connecteur), seulement quand elle sert : analyse de mission, demande explicite, ou Radar muet sur une question factuelle
  let web: { status: WebStatus; count: number } | null = null;
  let hits: WebHit[] = [];
  const wantWeb = !!o.search && !SMALLTALK.has(draft.intent) && (checklist || WEB_ASK.test(o.question) || (!ids.length && FACTUAL.test(o.question) && o.question.length > 10));
  if (wantWeb) {
    o.onStage?.("search");
    try {
      const r = await o.search!(webQuery(o), o.signal);
      hits = r.hits.slice(0, 5);
      web = { status: r.status, count: hits.length };
    } catch {
      web = { status: "error", count: 0 };
    }
  }
  const webEv: WebEvidence[] = hits.map((h, i) => ({ id: `web:${i + 1}`, titre: h.title, url: h.url, site: host(h.url), date: h.date, extrait: h.text }));
  const evidence = buildEvidence(o.ctx.feed, ids, o.ctx.places ?? [], webEv);
  const allIds = [...ids, ...webEv.map((w) => w.id)];

  const actions: AiAction[] = draft.actions;
  const facts = SMALLTALK.has(draft.intent) || draft.intent === "clarify" ? "" : draft.text;
  const player = playerContext(o.ctx.state, o.ctx.feed);
  const webNote = !wantWeb ? undefined : web?.status === "ok" ? `${hits.length} résultat(s), données tierces non vérifiées` : web?.status === "empty" ? "aucun résultat pertinent" : "indisponible (connecteur non branché ou en erreur) — ne prétends pas avoir cherché sur le web";
  const history = o.history.slice(-MAX_HISTORY).map((m) => (m.role === "assistant" ? { ...m, content: m.content.slice(0, 1_200) } : m));
  const messages: LlmMessage[] = [
    { role: "user", content: RULES },
    ...history,
    { role: "user", content: composeTurn({ question: o.question, player, evidence, facts, actions, checklist, web: webNote }) },
  ];
  // les tours consécutifs de même rôle sont acceptés ; la liste doit finir par « user »
  try {
    o.onStage?.("write");
    const r = await o.transport.generate({ messages, signal: o.signal, tier: checklist ? "default" : o.tier ?? "quick", onText: (t) => o.onText?.(visiblePart(t)) });
    const { message, meta } = parseReply(r.text);
    if (!message) return { ...fromDirect(draft, NOTE.refused), web };
    // Validation : aucun nombre « significatif » absent des preuves, du contexte, de la conversation ou de la question
    const allowed = new Set([...digits(evidence), ...digits(draft.text), ...digits(o.question), ...digits(player), ...history.flatMap((m) => digits(m.content))]);
    const bad = digits(message).filter((n) => !allowed.has(n) && !(Number(n) <= 20));
    if (bad.length) return { ...fromDirect(draft, `Réponse de Claude écartée : elle citait un chiffre absent des sources (${bad.slice(0, 2).join(", ")}). Voici la réponse vérifiée.`), web };
    const idx = Array.isArray(meta?.actions) ? (meta!.actions as unknown[]).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < actions.length) : null;
    let chosen = (idx ? idx.map((i) => actions[i]) : actions).slice(0, 2);
    // #15 : le joueur demande à voir sur la carte → le bouton carte reste proposé, même si Claude l'a omis
    const mapAct = actions.find((x) => x.type === "show_place" || x.type === "focus_vehicle" || x.type === "open_map");
    if (mapAct && WANTS_MAP.test(o.question) && !chosen.includes(mapAct)) chosen = [mapAct, ...chosen].slice(0, 2);
    const used = Array.isArray(meta?.sources) ? (meta!.sources as unknown[]).map(String).filter((s) => allIds.includes(s)) : [];
    const trust = TRUST.includes(meta?.confiance as Trust) ? (meta!.confiance as Trust) : draft.reliability;
    const sources: Source[] = sourcesFor(used.length ? used : allIds, o.ctx, draft.sources, hits);
    return {
      intent: checklist ? "checklist" : draft.intent,
      message: message.slice(0, MAX_ANSWER),
      // un fait issu du seul web ne peut pas être « officiel » ni « recoupé »
      trust: used.length && used.every((u) => u.startsWith("web:")) && (trust === "officiel" || trust === "recoupé") ? "signalé" : trust,
      sources,
      actions: chosen,
      topic: checklist ? { kind: "mission", name: o.mission!, known: true } : draft.topic ?? o.topic,
      replies: checklist ? [] : draft.replies,
      more: draft.more,
      engine: "claude",
      model: r.model,
      note: r.truncated ? "Réponse coupée par la limite de longueur." : undefined,
      evidence: allIds,
      checklist: checklist ? validateChecklist(meta, o.ctx, allIds, hits) : undefined,
      web,
    };
  } catch (e) {
    const code = e instanceof LlmError ? e.code : "upstream_error";
    if (code === "cancelled") {
      const partial = e instanceof LlmError && e.partial ? visiblePart(e.partial) : "";
      return { ...fromDirect(draft), message: partial || draft.text, engine: partial ? "claude" : "direct", note: "Réponse interrompue.", web };
    }
    return { ...fromDirect(draft, NOTE[code] ?? "Claude n'a pas pu répondre (erreur passagère) : réponse directe. Tu peux reposer la question."), web };
  }
}

/** Ne garde que les éléments qui citent une preuve réelle ; « vérifié » exige une fiche officielle ou recoupée. */
export function validateChecklist(meta: { [k: string]: unknown } | null, ctx: AiContext, ids: string[], hits: WebHit[]): { verified: ChecklistItem[]; uncertain: ChecklistItem[] } {
  const verified: ChecklistItem[] = [];
  const uncertain: ChecklistItem[] = [];
  const seen = new Set<string>();
  const read = (v: unknown): Array<{ text: string; source: string }> =>
    Array.isArray(v)
      ? v
          .map((x) => ({ text: String((x as { texte?: unknown })?.texte ?? "").trim(), source: String((x as { source?: unknown })?.source ?? "") }))
          .filter((x) => x.text.length >= 3 && x.text.length <= 220 && ids.includes(x.source))
      : [];
  const push = (list: ChecklistItem[], x: { text: string; source: string }) => {
    const k = x.text.toLowerCase();
    if (seen.has(k) || list.length >= 8) return;
    seen.add(k);
    list.push({ text: x.text, source: sourcesFor([x.source], ctx, [], hits)[0] ?? null });
  };
  for (const x of read(meta?.verifie)) {
    const r = ctx.feed?.items.find((y) => y.id === x.source) ?? null;
    const v = ctx.feed?.vehicles?.find((y) => y.id === x.source) ?? null;
    const rel = r?.reliability ?? v?.reliability;
    push(rel === "official" || rel === "confirmed" ? verified : uncertain, x);
  }
  for (const x of read(meta?.incertain)) push(uncertain, x);
  return { verified, uncertain };
}

function sourcesFor(ids: string[], ctx: AiContext, fallback: Source[], hits: WebHit[] = []): Source[] {
  const out: Source[] = [];
  for (const id of ids) {
    const r = ctx.feed?.items.find((x) => x.id === id);
    if (r) for (const e of r.evidence.slice(0, 2)) out.push({ name: e.sourceName.replace(/\s*\([^)]*\)\s*$/, ""), url: e.url, when: (e.publishedAt ?? r.firstSeenAt).slice(0, 10), title: e.title, quote: e.quotes?.[0] });
    const v = ctx.feed?.vehicles?.find((x) => x.id === id);
    if (v) for (const e of v.evidence.slice(0, 2)) out.push({ name: e.sourceName.replace(/\s*\([^)]*\)\s*$/, ""), url: e.url, when: null, title: e.title });
    if (id.startsWith("poi:") && !out.some((s) => s.url === "https://map.gtadb.org")) out.push({ name: "gtadb.org (carte communautaire)", url: "https://map.gtadb.org", when: null });
    if (id.startsWith("web:")) {
      const h = hits[Number(id.slice(4)) - 1];
      if (h && /^https:\/\//.test(h.url)) out.push({ name: `${host(h.url)} · web`, url: h.url, when: h.date, title: h.title });
    }
  }
  return (out.length ? out : fallback).slice(0, 5);
}
