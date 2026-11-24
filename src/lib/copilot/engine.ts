import { answer, isValidAction } from "../ai/engine";
import type { AiAction, AiAnswer, AiContext, Source, Topic } from "../ai/engine";
import { frHeadline } from "../fr";
import { glossaryOf, missionBrief, nk } from "../missions";
import { spoilerVisibility } from "../feed";
import { buildEvidence, playerContext } from "./context";
import type { WebEvidence } from "./context";
import { META_MARK, RULES, composeTurn } from "./prompt";
import { LlmError } from "./types";
import { decideWeb, englishQuery, WEB_ASK } from "./route";
import { redactorFor } from "../spoiler";
import type { TurnMetrics, WebReason } from "./route";
import type { BriefItem, ChecklistItem, CopilotAnswer, LlmMessage, LlmTransport, Trust, WebHit, WebSearchFn, WebStatus } from "./types";
import { docsBlock, visionRules } from "./vision";
import type { Attachment, AttachPurpose } from "./vision";
import { ground, groundingBlock, parseObservation, entitiesForQuestion, knowledgeBlock } from "../knowledge/engine";
import type { Grounding, Observation } from "../knowledge/engine";
import { EXTRACT_RULES, MEMORY_TTL_MS, asksVehicle, isVisualFollowUp, keepImages, visionAnswerRules, visualQuery, wantsDetail, wantsMap } from "./grounding";
import type { VisualMemory } from "./grounding";
import { compactPlayerContext, placeFocus } from "./context";
import { hubBlock, hubMentions, landmarkMentions } from "../hub/knowledge";

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
  /** Ancien routage (appel Claude de planification avant chaque question) — conservé pour la comparaison A/B. */
  planner?: boolean;
  /** Mesure de la réponse (V0.13). */
  onMetrics?: (m: TurnMetrics) => void;
  /** LEONIDA Vision (V0.17) : images et documents texte joints à ce message. */
  attachments?: Attachment[];
  purpose?: AttachPurpose;
  /** V0.19 · mémoire visuelle de la dernière image (questions de suivi). */
  memory?: VisualMemory | null;
  /** V0.19 · rendu d'un extrait de la carte LEONIDA autour d'un repère (navigateur), pour comparer une capture de carte. */
  renderRef?: (landmarkId: string) => Promise<Blob | null>;
  /** V0.19 · nouvelle mémoire visuelle après un tour avec image. */
  onVision?: (m: VisualMemory) => void;
}

const NOTE: Record<string, string> = {
  not_granted: "Tu n'as pas autorisé cette app à utiliser Claude : réponse directe, à partir des données vérifiées.",
  sampling_disabled: "Claude n'est pas disponible sur ce compte : réponse directe.",
  rate_limited: "Limite d'utilisation de Claude atteinte pour le moment : réponse directe. Réessaie un peu plus tard.",
  session_expired: "Session Claude expirée : reconnecte-toi. Réponse directe en attendant.",
  refused: "Claude n'a pas répondu à cette demande : réponse directe.",
  unavailable: "Claude n'est pas joignable ici : réponse directe.",
};

/** Intentions qui ne demandent jamais de recherche : politesse, actions dans l'app (progression). */
const NO_WEB = new Set(["hello", "thanks", "mission_done", "got_item", "next_start"]);
/** Intentions dont les actions (confirmées par le joueur) ne doivent jamais être retirées par le modèle. */
const PROGRESS_ACT = new Set(["mission_done", "got_item", "next_start", "shops", "buy_weapons", "zone_left"]);

/** Repli si le planificateur ne répond pas : toute question qui ressemble à une demande d'information. */
function heuristicWeb(o: AskOptions, intent: string): boolean {
  if (SMALLTALK.has(intent)) return false;
  const q = o.question.trim();
  return WEB_ASK.test(q) || FACTUAL.test(q) || q.split(/\s+/).length >= 4;
}

/** Deuxième essai, plus large, quand la première recherche ne renvoie rien d'exploitable. */
function reformulate(o: AskOptions, first: string): [string, string] {
  const words = nk(first.replace(/"/g, " ")).split(" ").filter((w) => w.length > 2 && !["gta", "the", "and", "for", "with", "page", "pages", "guide"].includes(w));
  const q = `GTA 6 ${words.slice(0, 7).join(" ")} guide`;
  return [q === first ? `GTA VI ${o.question.slice(0, 120)}` : q, webObjective(o)];
}

/**
 * Planificateur de recherche : un appel court à Claude (modèle rapide) qui décide si le web est utile
 * et écrit 1 ou 2 requêtes en anglais. Renvoie null en cas d'échec (repli heuristique).
 */
async function planWeb(o: AskOptions, ids: string[]): Promise<{ web: boolean; queries: string[] } | null> {
  if (!o.transport) return null;
  const p = o.ctx.state.profile;
  const local = ids
    .slice(0, 6)
    .map((id) => {
      const r = o.ctx.feed?.items.find((x) => x.id === id);
      return r ? `- ${r.title} (${r.reliability})` : `- ${id}`;
    })
    .join("\n");
  const last = o.history.slice(-2).map((m) => `${m.role === "user" ? "Joueur" : "LEONIDA"} : ${m.content.slice(0, 300)}`).join("\n");
  const prompt = `Tu prépares les recherches de LEONIDA, copilote de GTA VI (sorti en 2026). Réponds UNIQUEMENT par un objet JSON sur une ligne :
{"web":true|false,"requetes":["requête 1","requête 2"]}
- "web": false pour une salutation, un remerciement, du bavardage, un avis sans fait à vérifier, ou si les FAITS LOCAUX répondent déjà entièrement avec une fiabilité official/confirmed.
- "web": true pour toute question factuelle sur GTA VI (mission, lieu, magasin, objet, arme, véhicule, prix, déblocage, manquable, astuce, activité), même si le joueur ne demande pas de chercher.
- "requetes" : 1 ou 2 requêtes en ANGLAIS qui décrivent la page idéale ; commence par "GTA 6", utilise les noms officiels anglais, ajoute la mission en cours si la question en dépend. Aucune donnée personnelle.
Mission en cours ou prochaine : ${p.nextMission ?? "inconnue"}${p.missionInProgress ? " (en cours)" : ""}. Chapitre : ${p.chapter}.
FAITS LOCAUX :
${local || "(aucun)"}
${last ? `DERNIERS ÉCHANGES :\n${last}\n` : ""}MESSAGE : ${o.question.slice(0, 600)}`;
  try {
    const r = await Promise.race([
      o.transport.generate({ messages: [{ role: "user", content: prompt }], signal: o.signal, tier: "quick" }),
      new Promise<null>((res) => setTimeout(() => res(null), 9_000)),
    ]);
    if (!r) return null;
    const a = r.text.indexOf("{");
    const b = r.text.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    const j = JSON.parse(r.text.slice(a, b + 1)) as { web?: unknown; requetes?: unknown };
    if (typeof j.web !== "boolean") return null;
    const queries = (Array.isArray(j.requetes) ? j.requetes : [])
      .map((x) => String(x).replace(/\s+/g, " ").trim().slice(0, 200))
      .filter((x) => /[a-z]{3}/i.test(x))
      .slice(0, 2)
      .map((x) => (/\bgta\s?(6|vi)\b/i.test(x) ? x : `GTA 6 ${x}`));
    if (j.web && !queries.length) return null;
    return { web: j.web, queries };
  } catch {
    return null;
  }
}

/** Question factuelle (vaut une recherche web quand le Radar n'a rien). */
const FACTUAL = /\b(o[uù]|comment|combien|quand|quel(le)?s?|est-ce|faut-il|r[eé]compense|manquable|cach[ée]|trouver|d[ée]bloquer)\b|\?/i;
/** Messages de conversation pure : pas de faits à injecter, pas de recherche. */
const SMALLTALK = new Set(["hello", "thanks"]);
const SMALLTALK_LOCAL = SMALLTALK;

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
function webObjective(o: AskOptions, query?: string): string {
  const m = o.mission ?? o.ctx.state.profile.nextMission ?? "";
  if (o.mode === "checklist")
    return `Guides and walkthroughs of the GTA VI (GTA 6, 2026) story mission "${m}": what can be missed, optional objectives, choices and their consequences, rewards, points of no return. Rank dedicated mission guides first. Exclude GTA V, GTA Online and older games.`;
  return `Pages about GTA VI (GTA 6, released 2026) that answer this player question: "${o.question.slice(0, 400)}"${query ? ` (search: ${query})` : ""}${m ? ` (current mission: ${m})` : ""}. Prefer dedicated guides and wikis; exclude GTA V, GTA Online and older games.`;
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
  const atts = o.attachments ?? [];
  const userImages = atts.filter((a) => a.kind === "image" && a.blob).map((a) => a.blob!);
  let images = userImages;
  const docs = atts.filter((a) => a.kind === "text");
  // V0.19 · question de suivi sur l'image précédente (« et la voiture devant ? », « détaille », « montre-moi »)
  const followMem = !userImages.length && !docs.length && !checklist && isVisualFollowUp(o.question, o.memory) ? o.memory! : null;
  const memImages = followMem && Date.now() - followMem.at <= MEMORY_TTL_MS ? followMem.images : [];
  if (followMem) {
    const top = followMem.grounding?.candidates[0];
    // « montre-moi le lieu » : réponse immédiate, sans appel à Claude, depuis la reconnaissance précédente
    if (wantsMap(o.question) && !asksVehicle(o.question) && top?.landmarkId)
      return {
        ...fromDirect(draft),
        intent: "vision_followup",
        message: `Voici ${top.name} sur la carte (candidat ${followMem.grounding!.confidence === "élevée" ? "le plus probable" : "à confirmer"}, d'après la capture précédente).`,
        trust: null,
        sources: [],
        actions: [{ type: "show_place", label: `Voir ${top.name} sur la carte`, landmarkId: top.landmarkId }],
        engine: "direct",
        grounding: groundingOut(followMem.grounding!, undefined, [], memImages.length ? "image" : "résumé", 0),
        replies: VISION_REPLIES,
      };
    if (memImages.length) images = memImages;
  }
  const vision = images.length > 0 || docs.length > 0 || !!followMem;
  if (vision && !o.transport)
    return { ...fromDirect(draft), message: "Je ne peux pas analyser de pièce jointe ici : Claude n'est pas connecté dans cet environnement. Décris-moi ce que tu vois et je t'aide avec les données LEONIDA.", trust: null, actions: [], sources: [], note: "Analyse d'image indisponible." };
  if (!o.transport || !o.ctx.feed) return fromDirect(draft);
  // V0.14.1 : une salutation ou un merci reçoit une réponse locale immédiate — ni Claude, ni web, ni contexte narratif
  if (SMALLTALK_LOCAL.has(draft.intent) && !checklist && !vision) return { ...fromDirect(draft), trust: null };

  // 1. Preuves LEONIDA RADAR
  let ids = [...new Set(draft.evidence ?? [])];
  if (checklist) {
    const p = o.ctx.state.profile;
    const b = missionBrief(o.ctx.feed, o.mission!, { chapter: p.chapter, spoilerMode: p.spoilerMode, done: o.ctx.state.done });
    ids = [...new Set([...b.during.map((r) => r.id), ...b.before.map((r) => r.id), ...(b.guide ? [b.guide.id] : []), ...ids, ...extraEvidence(o.mission!, o.ctx, 3)])];
  } else if (!ids.length) ids = extraEvidence(o.question, o.ctx);

  // 2. Recherche web automatique.
  //    V0.13 (par défaut) : décision et requête anglaise calculées localement → un seul appel Claude.
  //    `planner: true` : ancien routage V0.12 (appel Claude de planification), gardé pour la comparaison.
  const t0 = Date.now();
  let planMs = 0;
  let searchMs = 0;
  let claudeCalls = 0;
  let reason: WebReason | "planner" = "insufficient";
  let web: { status: WebStatus; count: number; cached?: boolean; tries?: number } | null = null;
  let hits: WebHit[] = [];
  let plans: Array<[string, string]> = [];
  let searches = 0;
  let cachedSearches = 0;
  // V0.19 · Visual Grounding : extraction (1re passe) → ancrage local → recherche seulement si l'identification reste incertaine
  let obs: Observation | null = followMem?.obs ?? null;
  let grounding: Grounding | null = followMem?.grounding ?? null;
  const visualTurn = images.length > 0 || !!followMem;
  if (userImages.length) {
    o.onStage?.("write");
    try {
      const r1 = await o.transport.generate({ messages: [{ role: "user", content: `${EXTRACT_RULES}\n\nQUESTION DU JOUEUR (contexte seulement) : ${o.question}` }], images: userImages, tier: "default", signal: o.signal });
      claudeCalls++;
      obs = parseObservation(looseJson(r1.text));
    } catch (e) {
      if (e instanceof LlmError && e.code === "cancelled") throw e;
      obs = null; // extraction en échec : la réponse se fera sans reconnaissance (dit comme tel)
    }
    if (obs && o.purpose === "carte") obs.kind = "carte";
    grounding = obs ? ground(obs, o.ctx.state.profile) : null;
  }
  if (visualTurn) {
    // identifié avec des preuves fiables, ou question de suivi : pas de web ; incertain et indices distinctifs : web
    const unsure = !!grounding && (grounding.confidence === "faible" || grounding.confidence === "aucune");
    if (userImages.length && obs && obs.gta !== "non" && unsure && obs.clues.length >= 2 && o.search) {
      plans = [[visualQuery(obs, grounding!, o.ctx.state.profile.chapter), "GTA VI location matching these visual clues"]];
      reason = "insufficient";
    } else reason = "local_ok";
  } else if (checklist && o.search) {
    plans = [[webQuery(o), webObjective(o)], missablesQuery(o)];
    reason = "checklist";
  } else if (o.planner && o.search && !NO_WEB.has(draft.intent)) {
    reason = "planner";
    const tp = Date.now();
    const plan = await planWeb(o, ids);
    claudeCalls++;
    planMs = Date.now() - tp;
    if (plan) plans = plan.web ? plan.queries.map((q) => [q, webObjective(o, q)] as [string, string]) : [];
    else if (heuristicWeb(o, draft.intent)) plans = [[webQuery(o), webObjective(o)]];
  } else {
    const d = decideWeb({ question: o.question, draft, ids, feed: o.ctx.feed, hasSearch: !!o.search, checklist: false });
    reason = d.reason;
    if (d.web) {
      const m = o.ctx.state.profile.nextMission;
      const { query, objective } = englishQuery(o.question, m);
      plans = [[query, objective]];
    }
  }
  const wantWeb = plans.length > 0;
  if (wantWeb) {
    o.onStage?.("search");
    const ts = Date.now();
    const run = async (ps: Array<[string, string]>) => {
      const out = await Promise.all(ps.map(([q, obj]) => o.search!(q, o.signal, obj).catch(() => ({ status: "error" as WebStatus, hits: [] as WebHit[], cached: false }))));
      for (const x of out) x.cached ? cachedSearches++ : searches++;
      return out;
    };
    let res = await run(plans);
    let tries = 1;
    const hard = (st: WebStatus) => st === "not_connected" || st === "needs_reauth" || st === "denied" || st === "unavailable";
    if (!res.some((x) => x.hits.length) && !res.every((x) => hard(x.status)) && !o.signal?.aborted) {
      res = await run([reformulate(o, plans[0][0])]);
      tries = 2;
    }
    const seenUrl = new Set<string>();
    for (const x of res) for (const h of x.hits) if (!seenUrl.has(h.url)) (seenUrl.add(h.url), hits.push(h));
    hits = hits.slice(0, checklist ? 8 : 6);
    const st: WebStatus = hits.length ? "ok" : res.find((x) => x.status !== "ok" && x.status !== "empty")?.status ?? "empty";
    web = { status: st, count: hits.length, cached: res.every((x) => x.cached), tries };
    searchMs = Date.now() - ts;
  }
  const focus = checklist ? [...MISS_TERMS, ...nk(o.mission!).split(" ").filter((w) => w.length >= 4)] : nk(o.question).split(" ").filter((w) => w.length >= 5);
  const webEv: WebEvidence[] = hits.map((h, i) => ({ id: `web:${i + 1}`, titre: h.title, url: h.url, site: host(h.url), date: h.date, extrait: focusExcerpt(h.text, focus) }));
  const evidence = buildEvidence(o.ctx.feed, ids, o.ctx.places ?? [], webEv);
  const allIds = [...ids, ...webEv.map((w) => w.id)];

  // extraits de la carte LEONIDA autour des candidats, joints à la seconde passe (capture de carte uniquement)
  let refs: Blob[] = [];
  if (userImages.length && obs?.kind === "carte" && grounding?.candidates.length && o.renderRef) {
    // candidats à égalité (confiance faible) : 3 extraits, pour que la comparaison visuelle départage
    const n = grounding.confidence === "faible" ? 3 : 2;
    const out = await Promise.all(grounding.candidates.slice(0, n).map((c) => (c.landmarkId ? o.renderRef!(c.landmarkId).catch(() => null) : Promise.resolve(null))));
    refs = out.filter((b): b is Blob => !!b);
  }
  // un tour visuel ne reprend pas la réponse directe (souvent hors sujet) ; une question sur un lieu reçoit un contexte compact
  const actions: AiAction[] = visualTurn ? [] : draft.actions;
  const facts = visualTurn || SMALLTALK.has(draft.intent) || draft.intent === "clarify" ? "" : draft.text;
  // V0.19 · connaissances LEONIDA (lieux, véhicules) citées par la question, même sans image
  const kEnts = visualTurn ? [] : entitiesForQuestion(o.question);
  const kb0 = knowledgeBlock(kEnts);
  // V0.20 · Data Hub : missions, véhicules, personnages, propriétés et armes cités par la question
  const hubMs = visualTurn ? [] : await hubMentions(o.question, o.ctx.state).catch(() => []);
  // lieu absent de Knowledge : les repères GTADB dont le nom est cité (ou lu sur l'image) sont joints
  const lmText = visualTurn ? (obs?.texts ?? []).join(" | ") : kEnts.length ? "" : o.question;
  if (lmText) hubMs.push(...(await landmarkMentions(lmText).catch(() => [])));
  const kb = [kb0, hubBlock(hubMs)].filter(Boolean).join("\n");
  const player = visualTurn || placeFocus(o.question, kEnts.some((e) => e.type !== "zone")) ? compactPlayerContext(o.ctx.state) : playerContext(o.ctx.state, o.ctx.feed);
  // état exact des sources, pour ne jamais confondre « rien dans notre base », « web indisponible »,
  // « pas de source fiable » et « le contenu n'existe pas »
  const localNote = ids.length ? `${ids.length} élément(s) LEONIDA (fiches RADAR / lieux / progression)` : "aucune fiche LEONIDA RADAR sur ce sujet (cela ne prouve rien sur le jeu)";
  const webNote = !o.search
    ? "recherche web indisponible ici (pas de connecteur) — ne prétends pas avoir cherché sur le web"
    : !wantWeb
      ? reason === "local_ok"
        ? "pas de recherche web : les données LEONIDA sourcées répondent (si le joueur veut plus, propose de vérifier sur le web)"
        : "recherche web inutile pour ce message (conversation ou action dans l'app)"
      : web?.status === "ok"
        ? `${hits.length} résultat(s) web${web.cached ? " (cache récent)" : ""}, données tierces à recouper`
        : web?.status === "empty"
          ? `aucun résultat web pertinent après ${web.tries ?? 1} essai(s) — ce n'est pas une preuve d'inexistence`
          : "recherche web en échec (connecteur non branché, refusé ou en erreur) — ne prétends pas avoir cherché sur le web";
  // un tour visuel garde une histoire courte (le contexte utile est l'image et la reconnaissance, pas toute la conversation)
  const history = o.history.slice(visualTurn ? -4 : -MAX_HISTORY).map((m) => (m.role === "assistant" ? { ...m, content: m.content.slice(0, 1_200) } : m));
  const followMode = followMem ? (memImages.length ? "image" : "résumé") : null;
  const visionBlock = visualTurn
    ? [
        visionAnswerRules({ purpose: obs?.kind === "carte" ? "carte" : o.purpose ?? "capture", refs: refs.length, followUp: followMode, detail: wantsDetail(o.question) }),
        obs ? `INDICES EXTRAITS DE L'IMAGE (1re passe) : type ${obs.kind}, GTA VI : ${obs.gta} ; indices : ${obs.clues.join(", ") || "aucun"} ; textes lus : ${obs.texts.join(" | ") || "aucun"} ; véhicules : ${obs.vehicles.join(" | ") || "aucun"} ; résumé : ${obs.summary || "—"}` : userImages.length ? "INDICES : l'extraction a échoué ; décris prudemment ce que tu vois, sans identifier de lieu." : "",
        grounding ? groundingBlock(grounding) : "",
        followMem ? `RÉSUMÉ DE L'IMAGE PRÉCÉDENTE ET DE TA RÉPONSE : ${followMem.obs?.summary ?? "—"} — tu avais répondu : « ${followMem.answer.slice(0, 400)} »` : "",
        asksVehicle(o.question) && grounding?.vehicle ? `La question porte sur le VÉHICULE : réponds sur ${grounding.vehicle.name} (indices : ${grounding.vehicle.why.join(" ; ")}).` : "",
        docsBlock(atts),
      ]
        .filter(Boolean)
        .join("\n\n")
    : docs.length
      ? [visionRules(0, o.purpose ?? "capture", docs.length), docsBlock(atts)].join("\n\n")
      : undefined;
  const messages: LlmMessage[] = [
    { role: "user", content: RULES },
    ...history,
    { role: "user", content: composeTurn({ question: o.question, player, evidence: kb ? `${evidence}\nCONNAISSANCES LEONIDA (lieux, véhicules, Data Hub — fiches sourcées)\n${kb}` : evidence, facts, actions, checklist, web: `connaissances locales : ${localNote} ; web : ${webNote}`, vision: visionBlock }) },
  ];
  // les tours consécutifs de même rôle sont acceptés ; la liste doit finir par « user »
  try {
    o.onStage?.("write");
    let firstText: number | null = null;
    claudeCalls++;
    const r = await o.transport.generate({
      messages,
      signal: o.signal,
      // une image demande le modèle standard (meilleure lecture) ; le texte seul reste rapide
      tier: checklist || images.length ? "default" : o.tier ?? "quick",
      ...(images.length || refs.length ? { images: [...images, ...refs] } : {}),
      onText: (t) => {
        const v = visiblePart(t);
        if (firstText === null && v.trim()) firstText = Date.now() - t0;
        o.onText?.(v);
      },
    });
    const metrics: TurnMetrics = { at: new Date().toISOString(), router: o.planner ? "planner" : "local", reason, claudeCalls, searches, cachedSearches, planMs, searchMs, firstTextMs: firstText, totalMs: Date.now() - t0, webStatus: web?.status ?? null, hits: hits.length };
    if (!checklist) o.onMetrics?.(metrics);
    const { message, meta } = parseReply(r.text);
    if (!message) return { ...fromDirect(draft, NOTE.refused), web };
    // Validation : aucun nombre « significatif » absent des preuves, du contexte, de la conversation ou de la question
    // Vision : un nombre que Claude déclare LU sur l'image (champ « lus ») ou présent dans un document joint est admis
    const lus = vision && Array.isArray((meta as { lus?: unknown } | null)?.lus) ? ((meta as { lus: unknown[] }).lus.map(String).slice(0, 20)) : [];
    const allowed = new Set([...digits(evidence), ...digits(draft.text), ...digits(o.question), ...digits(player), ...history.flatMap((m) => digits(m.content)), ...lus.flatMap(digits), ...docs.flatMap((d) => digits(d.text ?? "")), ...digits(visionBlock ?? ""), ...digits(kb)]);
    const bad = digits(message).filter((n) => !allowed.has(n) && !(Number(n) <= 20));
    if (bad.length && vision)
      return { ...fromDirect(draft), message: "Je préfère ne pas te donner cette réponse : elle citait un chiffre que je ne retrouve ni sur ta capture ni dans les sources. Renvoie une capture plus nette ou précise ta question.", trust: null, actions: [], sources: [], note: `Réponse de Claude écartée (chiffre non vérifiable : ${bad.slice(0, 2).join(", ")}).`, web };
    if (bad.length) return { ...fromDirect(draft, `Réponse de Claude écartée : elle citait un chiffre absent des sources (${bad.slice(0, 2).join(", ")}). Voici la réponse vérifiée.`), web };
    const idx = Array.isArray(meta?.actions) ? (meta!.actions as unknown[]).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < actions.length) : null;
    let chosen = (idx ? idx.map((i) => actions[i]) : actions).slice(0, 2);
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string").map((y) => y.slice(0, 160)).slice(0, 5) : []);
    // V0.19 · identification : seulement un candidat du MOTEUR ; confiance jamais au-dessus de celle du moteur
    const idMeta = (meta as { identification?: { candidat?: unknown; confiance?: unknown } } | null)?.identification;
    const vg = grounding ? groundingOut(grounding, idMeta, strs((meta as { indices?: unknown } | null)?.indices), followMode, refs.length, typeof (meta as { action?: unknown } | null)?.action === "string" ? String((meta as { action: string }).action).slice(0, 100) : null) : null;
    if (vg?.identification?.landmarkId) chosen = [{ type: "show_place" as const, label: `Voir ${vg.identification.name} sur la carte`, landmarkId: vg.identification.landmarkId }];
    else if (vg && !vg.identification && vg.candidates[0]?.landmarkId) chosen = [{ type: "show_place" as const, label: `Voir le 1er candidat (${vg.candidates[0].name})`, landmarkId: vg.candidates[0].landmarkId }];
    // progression : les actions à confirmer (terminer, lancer, cocher) restent toujours proposées
    if (PROGRESS_ACT.has(draft.intent) && actions.length) chosen = actions.slice(0, 3);
    // #15 : le joueur demande à voir sur la carte → le bouton carte reste proposé, même si Claude l'a omis
    const mapAct = actions.find((x) => x.type === "show_place" || x.type === "focus_vehicle" || x.type === "open_map");
    if (mapAct && WANTS_MAP.test(o.question) && !chosen.includes(mapAct)) chosen = [mapAct, ...chosen].slice(0, 2);
    const used = Array.isArray(meta?.sources) ? (meta!.sources as unknown[]).map(String).filter((s) => allIds.includes(s)) : [];
    const trust = TRUST.includes(meta?.confiance as Trust) ? (meta!.confiance as Trust) : draft.reliability;
    const sources: Source[] = sourcesFor(used.length ? used : allIds, o.ctx, draft.sources, hits);
    // anti-spoiler à la source : un nom de mission future glissé par le modèle est retiré avant stockage
    const red = redactorFor(o.ctx.state, o.ctx.feed);
    const out: CopilotAnswer = {
      intent: checklist ? "checklist" : visualTurn ? "vision" : draft.intent,
      // jamais coupée en silence : une réponse trop longue le signale
      message: red(message.length > MAX_ANSWER ? `${message.slice(0, MAX_ANSWER).replace(/\s+\S*$/, "")} …` : message),
      // un fait issu du seul web ne peut pas être « officiel » ni « recoupé »
      // « Vérifié » exige des sources INDÉPENDANTES : au moins deux sites distincts parmi celles affichées
      // (ou une fiche officielle) ; un fait issu du seul web, ou d'un seul site, reste « Probable »
      trust:
        (used.length && used.every((u) => u.startsWith("web:")) && (trust === "officiel" || trust === "recoupé")) ||
        (trust === "recoupé" && new Set(sources.map((x) => host(x.url))).size < 2)
          ? "signalé"
          : trust,
      sources,
      actions: chosen,
      topic: checklist ? { kind: "mission", name: o.mission!, known: true } : draft.topic ?? o.topic,
      replies: checklist ? [] : visualTurn ? VISION_REPLIES : draft.replies,
      more: draft.more,
      engine: "claude",
      model: r.model,
      note: r.truncated || message.length > MAX_ANSWER ? "Réponse raccourcie (limite de longueur) : demande « détaille » pour la suite." : undefined,
      evidence: allIds,
      ...(checklist ? briefOf(meta, o.ctx, allIds, hits) : {}),
      ...(vg ? { grounding: { ...vg, why: vg.why.map(red), action: vg.action ? red(vg.action) : null } } : {}),
      web,
    };
    // mémoire visuelle : la nouvelle image (ou la même, rafraîchie) pour les questions de suivi
    if (userImages.length) o.onVision?.({ at: Date.now(), images: keepImages(userImages), purpose: obs?.kind === "carte" ? "carte" : o.purpose ?? "capture", obs, grounding, answer: message.slice(0, 600) });
    else if (followMem) o.onVision?.({ ...followMem, at: memImages.length ? Date.now() : followMem.at, answer: message.slice(0, 600) });
    return out;
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


/** Premier objet JSON d'un texte (la 1re passe ne doit rendre que du JSON, mais on tolère un préambule). */
export function looseJson(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

const CONF_RANK = ["aucune", "faible", "moyenne", "élevée"] as const;
/** Suites naturelles d'une réponse sur une image (au lieu des suggestions génériques de progression). */
const VISION_REPLIES = ["Détaille", "Et le véhicule ?", "Montre-moi le lieu"];

/** Sortie « reconnaissance » d'une réponse : identification validée contre les candidats du moteur. */
export function groundingOut(g: Grounding, idMeta: { candidat?: unknown; confiance?: unknown } | null | undefined, why: string[], memory: "image" | "résumé" | null, refs: number, action: string | null = null): NonNullable<CopilotAnswer["grounding"]> {
  const pool = [...g.candidates, ...(g.vehicle ? [g.vehicle] : [])];
  // sans avis de Claude (réponse locale), le meilleur candidat du moteur ; sinon seulement l'id qu'il a retenu
  const pick = idMeta === undefined ? g.candidates[0] ?? null : pool.find((c) => c.id === String(idMeta?.candidat ?? "")) ?? null;
  const asked = CONF_RANK.indexOf((idMeta?.confiance as (typeof CONF_RANK)[number]) ?? g.confidence);
  const conf = CONF_RANK[Math.min(asked < 0 ? CONF_RANK.indexOf(g.confidence) : asked, CONF_RANK.indexOf(g.confidence))];
  const identification = pick && conf !== "aucune" ? { id: pick.id, name: pick.name, confidence: conf, landmarkId: pick.landmarkId } : null;
  return {
    kind: g.kind,
    identification,
    why: why.length ? why.slice(0, 3) : identification ? pick!.why.slice(0, 3) : [],
    toCheck: pick?.toCheck ?? [],
    candidates: g.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score, landmarkId: c.landmarkId, type: c.type })),
    vehicle: g.vehicle ? g.vehicle.name : null,
    reason: g.reason,
    memory,
    refs,
    action,
  };
}
