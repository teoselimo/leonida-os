import { answer, isValidAction } from "../ai/engine";
import type { AiAction, AiAnswer, AiContext, Source, Topic } from "../ai/engine";
import { frHeadline } from "../fr";
import { glossaryOf, missionBrief, nk } from "../missions";
import { spoilerVisibility } from "../feed";
import { buildEvidence, playerContext } from "./context";
import type { WebEvidence } from "./context";
import { META_MARK, RULES, composeTurn } from "./prompt";
import { LlmError } from "./types";
import type { BriefItem, ChecklistItem, CopilotAnswer, LlmMessage, LlmTransport, Trust, WebHit, WebSearchFn, WebStatus } from "./types";

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

/** Termes qui signalent ce qu'on peut rater (pages anglaises des guides). */
const MISS_TERMS = ["missable", "miss", "missed", "unique", "trunk", "before", "point of no return", "gone for good", "lost", "lose", "only chance", "optional", "choice", "reward", "collect", "pick up", "weapon", "variant", "permanently", "can't", "cannot", "no replay"];

/**
 * Extrait utile d'une page longue : le début (contexte) + les phrases qui contiennent les termes recherchés,
 * dans l'ordre du texte, jusqu'à `max` caractères. Une coupe brute au début perdrait l'information clé
 * (vérifié le 22/11 : sur 3 guides de Don Gone, l'arme manquable est citée après le 1 200ᵉ caractère).
 */
export function focusExcerpt(text: string, terms: string[], max = 1_400): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, 240);
  const sentences = t.slice(240).split(/(?<=[.!?:])\s+|\s[|•]\s|\s-\s(?=[A-Z])/);
  const low = terms.map((x) => x.toLowerCase()).filter(Boolean);
  const scored = sentences
    .map((s, i) => ({ s: s.trim(), i, n: low.filter((w) => s.toLowerCase().includes(w)).length }))
    .filter((x) => x.n > 0 && x.s.length > 12)
    .sort((a, b) => b.n - a.n || a.i - b.i);
  const pick: typeof scored = [];
  let len = head.length;
  for (const x of scored) {
    const add = Math.min(x.s.length, 320) + 3;
    if (len + add > max) continue;
    pick.push(x);
    len += add;
  }
  return [head, ...pick.sort((a, b) => a.i - b.i).map((x) => x.s.slice(0, 320))].join(" … ");
}

function missablesQuery(o: AskOptions): [string, string] {
  const m = o.mission ?? "";
  return [
    `GTA 6 "${m}" missable unique weapon item point of no return`,
    `Pages listing what can be permanently missed in or around the GTA VI (GTA 6) mission "${m}": unique weapons or items, optional activities that disappear, choices, points of no return. Exclude GTA V and GTA Online.`,
  ];
}

function webQuery(o: AskOptions): string {
  const m = o.mission ?? o.ctx.state.profile.nextMission ?? "";
  if (o.mode === "checklist") return `GTA 6 "${m}" mission walkthrough missable collectibles rewards`;
  const clean = o.question.replace(WEB_ASK, " ").replace(/\s+/g, " ").trim();
  return `GTA 6 ${m && !clean.toLowerCase().includes(m.toLowerCase()) && /\b(l[aà]|cette mission|ici)\b/i.test(clean) ? `"${m}" ` : ""}${clean}`.slice(0, 200);
}

/** Objectif de recherche (Exa) : ce qui doit ressortir en premier, ce qui est exclu. */
function webObjective(o: AskOptions): string {
  const m = o.mission ?? o.ctx.state.profile.nextMission ?? "";
  if (o.mode === "checklist")
    return `Guides and walkthroughs of the GTA VI (GTA 6, 2026) story mission "${m}": what can be missed, optional objectives, choices and their consequences, rewards, points of no return. Rank dedicated mission guides first. Exclude GTA V, GTA Online and older games.`;
  return `Pages about GTA VI (GTA 6, released 2026) that answer this player question: "${o.question}"${m ? ` (current mission: ${m})` : ""}. Prefer dedicated guides and wikis; exclude GTA V, GTA Online and older games.`;
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
    // analyse de mission : deux angles (déroulé + contenus manquables), pour recouper entre sites
    const plans = checklist ? [[webQuery(o), webObjective(o)], missablesQuery(o)] : [[webQuery(o), webObjective(o)]];
    const res = await Promise.all(plans.map(([q, obj]) => o.search!(q, o.signal, obj).catch(() => ({ status: "error" as WebStatus, hits: [] as WebHit[] }))));
    const seenUrl = new Set<string>();
    for (const r of res) for (const h of r.hits) if (!seenUrl.has(h.url)) (seenUrl.add(h.url), hits.push(h));
    hits = hits.slice(0, checklist ? 8 : 5);
    const st: WebStatus = hits.length ? "ok" : res.find((r) => r.status !== "ok" && r.status !== "empty")?.status ?? "empty";
    web = { status: st, count: hits.length };
  }
  const focus = checklist ? [...MISS_TERMS, ...nk(o.mission!).split(" ").filter((w) => w.length >= 4)] : nk(o.question).split(" ").filter((w) => w.length >= 5);
  const webEv: WebEvidence[] = hits.map((h, i) => ({ id: `web:${i + 1}`, titre: h.title, url: h.url, site: host(h.url), date: h.date, extrait: focusExcerpt(h.text, focus) }));
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
      ...(checklist ? briefOf(meta, o.ctx, allIds, hits) : {}),
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

const WHEN = ["avant", "pendant", "apres"] as const;
const KIND = ["manquable", "objet_unique", "facultatif", "decision", "non_retour", "preparation"] as const;

/** Sites d'appui d'une preuve : sites des sources d'une fiche, ou site d'un résultat web. */
function hostsOf(id: string, ctx: AiContext, hits: WebHit[]): string[] {
  if (id.startsWith("web:")) {
    const h = hits[Number(id.slice(4)) - 1];
    return h ? [host(h.url)] : [];
  }
  // une fiche compte pour un seul site (sa fiabilité propre est jugée à part : official / confirmed)
  const r = ctx.feed?.items.find((x) => x.id === id);
  if (r) return r.evidence.slice(0, 1).map((e) => host(e.url));
  const v = ctx.feed?.vehicles?.find((x) => x.id === id);
  return v ? v.evidence.slice(0, 1).map((e) => host(e.url)) : [];
}

/**
 * Éléments « Rien à manquer » : seuls ceux qui citent une preuve existante sont gardés.
 * Le STATUT est calculé ici, jamais repris du modèle : fiche officielle/recoupée ou ≥ 2 sites distincts cités = confirmé ;
 * divergence signalée = contradictoire ; sinon une source.
 */
export function validateBrief(meta: { [k: string]: unknown } | null, ctx: AiContext, ids: string[], hits: WebHit[]): BriefItem[] {
  const raw = Array.isArray(meta?.elements) ? (meta!.elements as unknown[]) : [];
  const out: BriefItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const o = (x ?? {}) as Record<string, unknown>;
    const text = String(o.texte ?? "").trim().replace(/\s+/g, " ");
    if (text.length < 3 || text.length > 220 || seen.has(text.toLowerCase())) continue;
    const src = (Array.isArray(o.sources) ? o.sources : [o.source]).map(String).filter((id) => ids.includes(id));
    if (!src.length) continue;
    seen.add(text.toLowerCase());
    const strong = src.some((id) => {
      const rel = ctx.feed?.items.find((y) => y.id === id)?.reliability ?? ctx.feed?.vehicles?.find((y) => y.id === id)?.reliability;
      return rel === "official" || rel === "confirmed";
    });
    const sites = new Set(src.flatMap((id) => hostsOf(id, ctx, hits)));
    const note = typeof o.contradiction === "string" && o.contradiction.trim() ? o.contradiction.trim().slice(0, 200) : undefined;
    const when = WHEN.includes(o.quand as never) ? (o.quand as BriefItem["when"]) : "avant";
    const kind = KIND.includes(o.type as never) ? (o.type as BriefItem["kind"]) : "preparation";
    out.push({
      text,
      when,
      kind,
      priority: o.priorite === "haute" ? "haute" : "normale",
      status: note ? "contradictoire" : strong || sites.size >= 2 ? "confirmé" : "une source",
      note,
      sources: sourcesFor(src, ctx, [], hits)
        .map((s) => ({ name: s.name, url: s.url }))
        .filter((s, i, arr) => arr.findIndex((x) => x.url === s.url || x.name === s.name) === i),
    });
    if (out.length >= 12) break;
  }
  // priorité : ce qui se perd si on lance la mission maintenant
  const rank = (b: BriefItem) => (b.priority === "haute" ? 0 : 2) + (b.when === "avant" ? 0 : b.when === "pendant" ? 1 : 2) * 0.5;
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Analyse de mission : éléments typés + vue « vérifié / incertain » pour la conversation. */
function briefOf(meta: { [k: string]: unknown } | null, ctx: AiContext, ids: string[], hits: WebHit[]) {
  const brief = validateBrief(meta, ctx, ids, hits);
  const asItem = (b: BriefItem): ChecklistItem => ({ text: b.text, source: b.sources[0] ? { name: b.sources[0].name, url: b.sources[0].url, when: null } : null });
  // compatibilité : anciens champs « verifie » / « incertain »
  const legacy = brief.length ? null : validateChecklist(meta, ctx, ids, hits);
  return {
    brief,
    checklist: legacy ?? { verified: brief.filter((b) => b.status === "confirmé").map(asItem), uncertain: brief.filter((b) => b.status !== "confirmé").map(asItem) },
  };
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
