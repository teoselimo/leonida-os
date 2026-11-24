import { hubChapterStats } from "@/lib/hub/missions";
import { PROGRESSION, PROG_BY_ID } from "@/data/progression";
import { CHAPTER_COVERAGE, NODE_COVERAGE, STORY_NODES, STORY_NODE_BY_ID, STORY_RULES } from "@/data/story";
import { computeProgress, nodeByName, shownName } from "../progress";
import type { ProgressView } from "../progress";
import { nk } from "../missions";
import { HIDDEN_LABEL, hiddenMissionNames, redact } from "../spoiler";
import type { Gauge, PersistedState, StoryState } from "../types";
import { RESOURCE_FR, TIER_ORDER, sourceKind } from "./model";
import type { Cond, Confidence, Coverage, ResourceId, StoryEvidence, StoryRule, Tier } from "./model";

/**
 * LEONIDA STORY INTELLIGENCE — moteur d'évaluation (V0.17).
 *
 * Entrée : la progression DÉCLARÉE (profil, coches, jauges d'argent facultatives). Jamais de lecture de la PS5.
 * Sorties :
 *   - `storyAlerts` : règles encore à venir, classées (Critique → À explorer) et par horizon (imminent → plus tard) ;
 *   - `simulateLaunch` : « si je lance X » — ce qui disparaît, l'argent exposé, ce qui s'ouvre, les choix, la suite ;
 *   - `coverageOf` : ce qui a été audité ou non (jamais « rien à manquer » hors périmètre audité).
 */

export type StoryInput = Pick<PersistedState, "profile"> & { done?: Record<string, string>; story?: StoryState };
export type Horizon = "imminent" | "chapitre" | "plus tard" | "permanent";
const HORIZON_ORDER: Horizon[] = ["imminent", "chapitre", "permanent", "plus tard"];

export interface StoryAlert {
  key: string;
  rule: StoryRule;
  tier: Tier;
  confidence: Confidence;
  horizon: Horizon;
  /** Conseil prêt à afficher (anti-spoiler appliqué). */
  advice: string;
  /** Explication narrative, ou null si masquée par l'anti-spoiler. */
  explain: string | null;
  masked: boolean;
  when: string;
  /** Argent exposé ou manquant, calculé à partir des jauges déclarées (jamais inventé). */
  money: string | null;
  sources: Array<{ name: string; url: string }>;
  contradictions: string[];
  /** V0.18 : l'alerte dépend d'une mission probablement faite mais non déclarée — à confirmer par le joueur. */
  uncertain: string | null;
  /** V0.18 : pourquoi ce niveau de confiance (qualité, indépendance, vérification en jeu). */
  confidenceWhy: string;
}

// ───────────────────────── noms et statuts ─────────────────────────

/** Nœud (chapitre 1 du graphe, ou chapitres 2 à 5 de l'inventaire) pour un nom saisi. */
export function findStoryNode(name: string | null | undefined): { id: string; name: string; chapter: number; kind: string } | null {
  if (!name) return null;
  const g = nodeByName(name);
  if (g) return { id: g.id, name: g.name, chapter: g.chapter, kind: g.kind };
  const k = nk(name).replace(/['!.]/g, "").trim();
  if (!k) return null;
  const key = (x: string) => nk(x).replace(/['!.]/g, "").trim();
  const n = STORY_NODES.find((x) => key(x.name) === k || (x.aliases ?? []).some((a) => key(a) === k)) ?? STORY_NODES.find((x) => k.length >= 6 && key(x.name).includes(k));
  return n ? { id: n.id, name: n.name, chapter: n.chapter, kind: n.kind } : null;
}

/** « likely » : indice faible (Story Recap) — jamais assimilé à « done » ; une alerte reste affichée, marquée à confirmer. */
type NodeSt = "done" | "started" | "lost" | "likely" | "open" | "near" | "later";

function nodeStatus(id: string, v: ProgressView, s: StoryInput): NodeSt {
  const p = s.profile;
  const g = v.byId.get(id);
  if (g) {
    if (g.status === "terminé") return "done";
    if (g.status === "en cours") return "started";
    if (g.status === "plus disponible") return "lost";
    // mission principale placée avant une mission terminée dans le Story Recap : probablement passée (signal FAIBLE) —
    // V0.18 : n'est plus traitée comme terminée ; le joueur confirme
    if (g.likelyDone) return "likely";
    if (p.chapter > g.node.chapter && g.node.kind === "main") return "done";
    if (v.planned?.node.id === id || g.status === "accessible" || g.status === "potentiellement accessible") return "near";
    // verrouillé, mais tous les prérequis manquants sont la mission en cours / prévue
    if (g.status === "verrouillé" && (g.missing ?? []).every((m) => m.id === v.current?.node.id || m.id === v.planned?.node.id)) return "near";
    return g.node.chapter <= p.chapter ? "open" : "later";
  }
  const n = STORY_NODE_BY_ID.get(id);
  if (!n) return "later";
  const declared = [...p.missionsDone, p.lastMission].some((m) => findStoryNode(m)?.id === id);
  if (declared) return "done";
  const planned = findStoryNode(p.nextMission)?.id === id;
  if (planned && p.missionInProgress) return "started";
  if (planned) return "near";
  if (n.kind === "main" && p.chapter > n.chapter) return "done";
  return n.chapter <= p.chapter ? "open" : "later";
}

const nodeChapter = (id: string) => PROG_BY_ID.get(id)?.chapter ?? STORY_NODE_BY_ID.get(id)?.chapter ?? 99;
const nodeName = (id: string) => PROG_BY_ID.get(id)?.name ?? STORY_NODE_BY_ID.get(id)?.name ?? id;

// ───────────────────────── argent ─────────────────────────

/** Valeur basse / haute d'une jauge (exacte ou tranche). */
export function gaugeBounds(g: Gauge | undefined | null): [number, number | null] | null {
  if (!g) return null;
  if (g.mode === "exact") return [g.value, g.value];
  return [g.min, g.max];
}

export const fmt$ = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/ /g, " ")} $`;

export function gaugeLabel(g: Gauge | undefined | null): string {
  const b = gaugeBounds(g);
  if (!b) return "inconnu";
  if (g!.mode === "exact") return fmt$(b[0]);
  return b[1] == null ? `plus de ${fmt$(b[0])}` : b[0] === 0 ? `moins de ${fmt$(b[1])}` : `${fmt$(b[0])} à ${fmt$(b[1])}`;
}

function moneyLine(r: StoryRule, s: StoryInput): string | null {
  const m = s.story?.money ?? {};
  const lost = r.effects.filter((e): e is { k: "lose"; what: string; resource: ResourceId } => e.k === "lose" && !!e.resource).map((e) => e.resource);
  if (lost.length) {
    const known = lost.filter((x) => gaugeBounds(m[x]));
    if (!known.length) return `Montant exposé inconnu (${lost.map((x) => RESOURCE_FR[x]).join(", ")}) : indique ton argent pour le calculer.`;
    const lo = known.reduce((a, x) => a + gaugeBounds(m[x])![0], 0);
    const his = known.map((x) => gaugeBounds(m[x])![1]);
    const hi = his.some((h) => h == null) ? null : his.reduce((a, h) => a! + h!, 0);
    const unknown = lost.filter((x) => !gaugeBounds(m[x]));
    const range = hi == null ? `au moins ${fmt$(lo)}` : lo === hi ? fmt$(lo) : `${fmt$(lo)} à ${fmt$(hi)}`;
    if (hi === 0) return `Rien d'exposé selon ce que tu as indiqué${unknown.length ? ` (inconnu : ${unknown.map((x) => RESOURCE_FR[x]).join(", ")})` : ""}.`;
    return `Exposé selon ce que tu as indiqué : ${range}${unknown.length ? ` + ${unknown.map((x) => RESOURCE_FR[x]).join(", ")} (inconnu)` : ""}.`;
  }
  const keep = r.effects.find((e): e is { k: "keep"; what: string; resource: ResourceId; upTo: number } => e.k === "keep" && e.resource === "savings" && !!e.upTo);
  if (keep && r.kind === "opportunité") {
    const b = gaugeBounds(m.savings);
    if (!b) return "Solde Family Savings inconnu : indique-le pour savoir ce qu'il manque.";
    if (b[0] >= keep.upTo) return `Family Savings déjà à ${fmt$(b[0])} ou plus : palier atteint.`;
    return b[1] != null ? `Il te manque environ ${fmt$(keep.upTo - b[1])} à ${fmt$(keep.upTo - b[0])}.` : null;
  }
  const th = r.effects.find((e): e is { k: "threshold"; what: string; resource: ResourceId; min: number } => e.k === "threshold");
  if (th && r.status !== "contestée") {
    const b = gaugeBounds(m[th.resource]);
    if (!b) return `Seuil : ${fmt$(th.min)} (${RESOURCE_FR[th.resource]} inconnu).`;
    if (b[0] >= th.min) return `Seuil de ${fmt$(th.min)} atteint selon ce que tu as indiqué.`;
    return `Seuil : ${fmt$(th.min)} ; tu as indiqué ${gaugeLabel(m[th.resource])}.`;
  }
  return null;
}

// ───────────────────────── conditions ─────────────────────────

export function evalCond(c: Cond | undefined, s: StoryInput, v: ProgressView): boolean {
  if (!c) return true;
  switch (c.k) {
    case "done":
      return nodeStatus(c.node, v, s) === "done";
    case "started":
      return ["done", "started"].includes(nodeStatus(c.node, v, s));
    case "notStarted":
      return !["done", "started"].includes(nodeStatus(c.node, v, s));
    case "chapterAtLeast":
      return s.profile.chapter >= c.n;
    case "chapterAtMost":
      return s.profile.chapter <= c.n;
    case "edition":
      return s.profile.edition === c.v;
    case "ticked":
      return !!s.done?.[c.key];
    case "savingsAtLeast": {
      const b = gaugeBounds(s.story?.money?.savings);
      return !!b && b[0] >= c.amount;
    }
    case "all":
      return c.of.every((x) => evalCond(x, s, v));
    case "any":
      return c.of.some((x) => evalCond(x, s, v));
    case "not":
      return !evalCond(c.c, s, v);
  }
}

/**
 * Confiance calculée à partir des preuves (jamais déclarée à la main) — V0.18, plus exigeante :
 *   - « Vérifié » : vérifié en jeu par le joueur, OU au moins 2 origines INDÉPENDANTES qui affirment exactement la même
 *     chose, dont au moins un guide joué (pas seulement des compilations) ;
 *   - plusieurs compilations (wikis, agrégateurs) ne comptent que pour UNE origine : elles recopient les mêmes sources ;
 *   - une preuve « partielle » (périmètre plus large ou voisin) soutient, mais ne compte pas pour l'indépendance ;
 *   - une contradiction ou un statut « contestée » donne « Contesté » ; jamais de « Vérifié » sur un seul domaine.
 */
export function confidenceOf(r: Pick<StoryRule, "evidence" | "status"> & { inGame?: StoryRule["inGame"] }): Confidence {
  if (r.status === "contestée" || r.evidence.some((e) => e.stance === "contredit")) return "Contesté";
  if (r.inGame) return "Vérifié";
  const q = evidenceQuality(r.evidence);
  if (q.independent >= 2 && q.played >= 1) return "Vérifié";
  return q.confirming ? "Probable" : r.evidence.length ? "Non confirmé" : "Non confirmé";
}

/** Indépendance et qualité des preuves qui CONFIRMENT exactement l'affirmation. */
export function evidenceQuality(evs: StoryEvidence[]): { independent: number; played: number; compiled: number; confirming: number; partial: number } {
  const conf = evs.filter((e) => e.stance === "confirme");
  const exact = conf.filter((e) => (e.scope ?? "exact") === "exact");
  const origins = new Set(exact.map((e) => e.origin ?? (sourceKind(e) === "compilation" ? "compilations" : hostOf(e.url))));
  return {
    independent: origins.size,
    played: exact.filter((e) => sourceKind(e) === "guide joué" || sourceKind(e) === "officiel").length,
    compiled: exact.filter((e) => sourceKind(e) === "compilation").length,
    confirming: conf.length,
    partial: conf.length - exact.length,
  };
}

/** Explication courte du niveau de confiance, pour la fiche et LEONIDA AI. */
export function confidenceWhy(r: Pick<StoryRule, "evidence" | "status" | "inGame" | "contradictions">): string {
  const c = confidenceOf(r);
  if (c === "Contesté") return "des sources se contredisent ou nuancent ce point";
  if (r.inGame) return `vérifié en jeu le ${r.inGame.at}`;
  const q = evidenceQuality(r.evidence);
  if (!q.independent) return "aucune source n'affirme exactement ce point (seulement des nuances ou un périmètre voisin) · pas encore vérifié en jeu";
  const parts = [q.independent === 1 ? "une seule origine" : `${q.independent} origines indépendantes`];
  if (q.played) parts.push(`${q.played} guide${q.played > 1 ? "s" : ""} joué${q.played > 1 ? "s" : ""}`);
  if (q.compiled) parts.push(`${q.compiled} compilation${q.compiled > 1 ? "s" : ""} (comptée${q.compiled > 1 ? "s" : ""} pour une seule origine)`);
  if (q.partial) parts.push(`${q.partial} preuve${q.partial > 1 ? "s" : ""} au périmètre partiel`);
  if (c === "Probable" && q.independent >= 2) parts.push("aucun guide joué : non vérifié");
  parts.push("pas encore vérifié en jeu");
  return parts.join(" · ");
}

const hostOf = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];

/** Règle qui dépend d'une mission probablement faite (indice faible) : l'alerte reste, à confirmer. */
function uncertainOf(r: StoryRule, s: StoryInput, v: ProgressView): string | null {
  const ids: string[] = [];
  const walk = (c: Cond | undefined) => {
    if (!c) return;
    if ("node" in c) ids.push(c.node);
    if ("of" in c) c.of.forEach(walk);
    if ("c" in c) walk(c.c);
  };
  walk(r.appliesIf);
  walk(r.resolvedIf);
  if (r.trigger && "node" in r.trigger) ids.push(r.trigger.node);
  const likely = ids.map((id) => v.byId.get(id)).find((g) => g?.likelyDone);
  if (!likely) return null;
  const shown = shownName(likely, s.profile.spoilerMode) === likely.node.name;
  return shown
    ? `Tu as peut-être déjà fait ${likely.node.name} (non déclarée) : confirme-le dans l'Accueil pour mettre cette alerte à jour.`
    : "Tu as peut-être déjà passé l'étape qui déclenche cette alerte (mission non déclarée, nom masqué) : confirme tes missions faites dans l'Accueil.";
}

/** Une règle contestée n'est jamais critique. */
const effectiveTier = (r: StoryRule, c: Confidence): Tier => (c === "Contesté" && r.tier === "Critique" ? "Fortement recommandé" : r.tier);

// ───────────────────────── anti-spoiler ─────────────────────────

/** Noms des nœuds des chapitres non atteints (en plus des missions masquées par le moteur de progression). */
export function hiddenStoryNames(s: StoryInput): string[] {
  if (s.profile.spoilerMode !== "strict") return [];
  const out: string[] = [];
  for (const n of STORY_NODES) {
    if (n.chapter <= s.profile.chapter) continue;
    if ([...s.profile.missionsDone, s.profile.nextMission].some((m) => findStoryNode(m)?.id === n.id)) continue;
    out.push(n.name, ...(n.aliases ?? []));
  }
  return out.filter((x) => x.length >= 4);
}

/** Rédacteur anti-spoiler ; `keep` = noms que le joueur a lui-même cités (la mission qu'il demande à simuler). */
function storyRedactor(s: StoryInput, keep: string[] = []): (t: string) => string {
  const k = new Set(keep.map((x) => x.toLowerCase()));
  const names = [...new Set([...hiddenMissionNames(s), ...hiddenStoryNames(s)])].filter((n) => !k.has(n.toLowerCase())).sort((a, b) => b.length - a.length);
  return (t: string) => (names.length ? redact(t, names) : t);
}

// ───────────────────────── alertes ─────────────────────────

function triggerState(r: StoryRule, s: StoryInput, v: ProgressView): { passed: boolean; horizon: Horizon; chapter: number } {
  const t = r.trigger;
  if (!t) {
    const ok = s.profile.chapter >= r.chapter;
    return { passed: false, horizon: ok ? "permanent" : "plus tard", chapter: r.chapter };
  }
  if ("chapterEnd" in t) {
    const passed = s.profile.chapter > t.chapterEnd;
    return { passed, horizon: t.chapterEnd === s.profile.chapter ? "chapitre" : "plus tard", chapter: t.chapterEnd };
  }
  const st = nodeStatus(t.node, v, s);
  const passed = t.at === "start" ? ["done", "started", "lost"].includes(st) : st === "done" || st === "lost";
  // « fin de X » est imminent quand X est en cours ; « début de X » quand X est la prochaine mission ou accessible
  const horizon: Horizon = (t.at === "end" && st === "started") || (t.at === "start" && st === "near") ? "imminent" : st === "open" || st === "near" || st === "likely" ? "chapitre" : nodeChapter(t.node) <= s.profile.chapter ? "chapitre" : "plus tard";
  return { passed, horizon, chapter: nodeChapter(t.node) };
}

function whenText(r: StoryRule, s: StoryInput, v: ProgressView): string {
  const t = r.trigger;
  if (!t) return r.timing;
  if ("chapterEnd" in t) return `fin du chapitre ${t.chapterEnd}`;
  const g = v.byId.get(t.node);
  const name = g ? shownName(g, s.profile.spoilerMode) : nodeName(t.node);
  const shown = name === nodeName(t.node) ? name : HIDDEN_LABEL;
  return `${t.at === "start" ? "au début de" : "à la fin de"} ${shown}`.replace("de une", "d'une");
}

/** Toutes les règles encore à venir pour ce joueur, classées. */
export function storyAlerts(s: StoryInput): StoryAlert[] {
  const v = computeProgress(s);
  const red = storyRedactor(s);
  const out: StoryAlert[] = [];
  for (const r of STORY_RULES) {
    if (r.status === "obsolète") continue;
    if (!evalCond(r.appliesIf, s, v)) continue;
    if (s.done?.[`story:${r.id}`] || (r.resolvedIf && evalCond(r.resolvedIf, s, v))) continue;
    const t = triggerState(r, s, v);
    if (t.passed) continue;
    const confidence = confidenceOf(r);
    const masked = s.profile.spoilerMode === "strict" && Math.max(r.chapter, t.chapter) > s.profile.chapter;
    out.push({
      key: `story:${r.id}`,
      rule: r,
      tier: effectiveTier(r, confidence),
      confidence,
      horizon: t.horizon,
      advice: red(r.advice),
      explain: masked ? null : red(r.explain),
      masked,
      when: red(whenText(r, s, v)),
      money: moneyLine(r, s),
      sources: r.evidence.map((e) => ({ name: e.name, url: e.url })),
      contradictions: masked ? [] : (r.contradictions ?? []).map(red),
      uncertain: uncertainOf(r, s, v),
      confidenceWhy: confidenceWhy(r),
    });
  }
  const CONF: Confidence[] = ["Vérifié", "Probable", "Non confirmé", "Contesté"];
  const rank = (a: StoryAlert) => HORIZON_ORDER.indexOf(a.horizon) * 100 + TIER_ORDER.indexOf(a.tier) * 10 + CONF.indexOf(a.confidence);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Les alertes qui méritent une place dans la liste de l'Accueil (au plus 3 affichées par l'Accueil). */
export function homeStoryAlerts(s: StoryInput): StoryAlert[] {
  return storyAlerts(s).filter((a) => (a.horizon === "imminent" || a.horizon === "chapitre") && (a.tier === "Critique" || a.tier === "Fortement recommandé"));
}

// ───────────────────────── couverture ─────────────────────────

export function nodeCoverage(id: string): Coverage {
  // V0.20 : un nœud venu du Data Hub (GTABase) n'est pas audité par LEONIDA, même si ses prérequis sont connus
  return STORY_NODE_BY_ID.get(id)?.coverage ?? NODE_COVERAGE[id] ?? (PROG_BY_ID.get(id) && PROG_BY_ID.get(id)!.origin !== "hub" ? "partielle" : "non auditée");
}

export function coverageOf(chapter: number): { chapter: number; level: Coverage; audited: string[]; missing: string[] } {
  const c = CHAPTER_COVERAGE[chapter] ?? { level: "non auditée" as Coverage, audited: [], missing: ["tout le chapitre"] };
  return { chapter, ...c };
}

/** Ligne de couverture honnête (« rien à manquer » n'est jamais affirmé hors audit). */
export function coverageLine(chapter: number): string {
  const c = coverageOf(chapter);
  if (c.level === "auditée") return `Chapitre ${chapter} : audité.`;
  const h = hubChapterStats(chapter);
  const known = h.total ? ` ${h.total} missions connues via GTABase (${h.withPrereq} avec prérequis).` : "";
  return `Chapitre ${chapter} : couverture ${c.level}.${known} Pas encore vérifié : ${c.missing.join(" ; ")}.`;
}

// ───────────────────────── simulation « si je lance X » ─────────────────────────

export interface SimLine {
  text: string;
  confidence: Confidence;
  sources: Array<{ name: string; url: string }>;
  when?: string;
  tier?: Tier;
  money?: string | null;
  /** V0.18 : pourquoi ce niveau de confiance ; alerte à confirmer (mission probablement faite). */
  why?: string;
  uncertain?: string | null;
}

export interface LaunchSim {
  id: string;
  name: string;
  chapter: number;
  coverage: Coverage;
  /** Activités, objets ou lieux qui ne seront plus accessibles. */
  disappears: SimLine[];
  /** Argent exposé, seuils, gels. */
  money: SimLine[];
  /** À récupérer pendant la mission. */
  during: SimLine[];
  /** Choix documentés. */
  choices: SimLine[];
  /** Ce qui s'ouvre ensuite (noms masqués si besoin). */
  opens: SimLine[];
  /** Déjà neutralisé par le joueur. */
  ready: string[];
  /** Conséquences connues plus loin (conseil seulement en anti-spoiler strict). */
  later: SimLine[];
  /** Ce qu'on ne sait pas. */
  unknowns: string[];
  pointOfNoReturn: boolean;
}

const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
/** Sources du graphe : « Vérifié » seulement selon la règle commune (qualité + indépendance), jamais au nombre de domaines. */
export const srcsVerified = (srcs: Array<{ url: string }>): boolean => srcConf(srcs) === "Vérifié";

/** Sources du graphe (sans position déclarée) : même règle de qualité et d'indépendance que les règles (V0.18). */
const srcConf = (srcs: Array<{ url: string }>): Confidence => confidenceOf({ status: "active", evidence: srcs.map((x) => ({ name: "", url: x.url, says: "", stance: "confirme" as const, checkedAt: "" })) });

/** Pertes qui révèlent un événement narratif (lieu détruit, déménagement) : masquées en mode strict. */
const NARRATIVE_LOSS = /maison|house|motel|appartement/i;

export function simulateLaunch(s: StoryInput, name: string): LaunchSim | null {
  const node = findStoryNode(name);
  if (!node) return null;
  const v = computeProgress(s);
  const g = PROG_BY_ID.get(node.id);
  // le joueur a nommé cette mission lui-même : son nom reste lisible, les autres noms futurs restent masqués
  const red = storyRedactor(s, [node.name, ...(g?.aliases ?? []), ...(STORY_NODE_BY_ID.get(node.id)?.aliases ?? [])]);
  const sim: LaunchSim = { id: node.id, name: node.name, chapter: node.chapter, coverage: nodeCoverage(node.id), disappears: [], money: [], during: [], choices: [], opens: [], ready: [], later: [], unknowns: [], pointOfNoReturn: !!g?.pointOfNoReturn };
  const seen = new Set<string>();
  const add = (list: SimLine[], l: SimLine) => {
    const k = nk(l.text).slice(0, 40);
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ ...l, text: red(l.text), when: l.when ? red(l.when) : l.when });
  };

  // 1. règles déclenchées par CE lancement (ou par sa fin)
  for (const r of STORY_RULES) {
    const t = r.trigger;
    if (!t || "chapterEnd" in t || t.node !== node.id) continue;
    if (!evalCond(r.appliesIf, s, v)) continue;
    const c = confidenceOf(r);
    const resolved = !!s.done?.[`story:${r.id}`] || (r.resolvedIf && evalCond(r.resolvedIf, s, v));
    if (resolved) {
      sim.ready.push(red(r.advice));
      continue;
    }
    const line: SimLine = { text: r.advice, confidence: c, sources: r.evidence.map((e) => ({ name: e.name, url: e.url })), when: t.at === "start" ? "au lancement" : "à la fin", tier: effectiveTier(r, c), money: moneyLine(r, s), why: confidenceWhy(r), uncertain: uncertainOf(r, s, v) };
    const hasMoney = r.effects.some((e) => (e.k === "lose" || e.k === "freeze" || e.k === "threshold") && "resource" in e && !!e.resource);
    if (r.kind === "choix") add(sim.choices, line);
    else if (hasMoney || r.id === "ch1-savings-5k") add(sim.money, line);
    else add(sim.disappears, line);
  }
  // les règles déclenchées par ce lancement priment sur les listes du graphe (pas de doublon, pas de certitude abusive)
  const own = STORY_RULES.filter((r) => r.trigger && "node" in r.trigger && r.trigger.node === node.id);
  const keys = own.flatMap((r) => (r.match ?? []).map((m) => nk(m)));
  const ruleWords = new Set(own.flatMap((r) => nk(r.advice).match(/[a-z]{6,}/g) ?? []));
  // 2. graphe : activités qui disparaissent au début ou à la fin de cette mission
  for (const st of v.states) {
    const l = st.node.lostAt;
    if (!l || l.node !== node.id || st.status === "terminé" || st.status === "plus disponible") continue;
    if (keys.some((k) => nk(st.node.name).includes(k))) continue;
    add(sim.disappears, { text: `${shownName(st, s.profile.spoilerMode)}${st.node.kind !== "main" ? " (facultative)" : ""} ne sera plus disponible`, confidence: srcConf(l.sources), sources: l.sources, when: l.at === "start" ? "au lancement" : "à la fin" });
  }
  // 3. point de non-retour du graphe (pertes non déjà couvertes par une règle)
  if (g?.pointOfNoReturn) {
    for (const lose of g.pointOfNoReturn.lose) {
      if ((nk(lose).match(/[a-z]{6,}/g) ?? []).some((w) => ruleWords.has(w))) continue;
      // anti-spoiler : la perte d'un lieu raconte l'événement ; en mode strict on garde l'alerte, pas le détail
      const shown = s.profile.spoilerMode === "strict" && NARRATIVE_LOSS.test(lose) ? "un lieu que tu utilises (détail masqué en mode strict)" : lose;
      add(sim.disappears, { text: `Perdu : ${shown}`, confidence: srcConf(g.pointOfNoReturn.sources), sources: g.pointOfNoReturn.sources, when: "au lancement" });
    }
  }
  // 4. manquables pendant la mission
  for (const m of g?.missables ?? []) add(sim.during, { text: m.text + (m.locationCertain ? "" : " (emplacement incertain)"), confidence: srcConf(m.sources), sources: m.sources, when: m.when === "avant" ? "avant" : m.when === "pendant" ? "pendant" : "après" });
  // 5. ce qui s'ouvre
  for (const u of g?.unlocks ?? []) add(sim.opens, { text: u.text, confidence: srcConf(u.sources), sources: u.sources });
  for (const n of PROGRESSION) {
    if (!n.prereq || n.prereq.basis !== "explicite" || !n.prereq.all.includes(node.id)) continue;
    const st = v.byId.get(n.id);
    if (!st || st.status === "terminé") continue;
    const other = n.prereq.all.filter((d) => d !== node.id && v.byId.get(d)?.status !== "terminé");
    const label = shownName(st, s.profile.spoilerMode);
    add(sim.opens, { text: `${label}${other.length ? " (avec d'autres conditions)" : ""}${n.auto ? " — démarre seule" : ""}`, confidence: srcConf(n.prereq.sources), sources: n.prereq.sources });
  }
  // 6. plus loin : règles importantes des chapitres suivants (conseil seul si masqué)
  const later = storyAlerts(s).filter((a) => a.rule.chapter > node.chapter && (a.tier === "Critique" || a.tier === "Fortement recommandé")).slice(0, 3);
  for (const a of later) sim.later.push({ text: a.advice, confidence: a.confidence, sources: a.sources, tier: a.tier, when: a.masked ? "plus tard dans l'histoire" : a.when });
  // 7. inconnues — l'absence d'alerte n'est jamais l'absence de risque
  const sn = STORY_NODE_BY_ID.get(node.id);
  sim.unknowns.push(...(sn?.unknowns ?? []));
  if (g?.origin === "hub") sim.unknowns.push(g.prereq ? "Prérequis lus sur GTABase (une seule source, non recoupée)." : "Prérequis non documentés : GTABase ne dit pas ce qui débloque cette mission.");
  if (g?.hub?.differs?.length) sim.unknowns.push("GTABase cite d'autres missions préalables que le graphe validé : le graphe validé reste appliqué.");
  if (sim.coverage === "non auditée") sim.unknowns.unshift("Cette mission n'a pas encore été auditée : aucune alerte ne veut pas dire aucun risque.");
  else if (sim.coverage === "partielle") sim.unknowns.unshift("Audit partiel : prérequis et pertes majeures vérifiés, pas chaque détail de la mission.");
  else if (sim.coverage === "à revérifier") sim.unknowns.unshift("Données à revérifier (mise à jour du jeu ou sources nouvelles).");
  else sim.unknowns.unshift("Audit fondé sur des sources publiées : pas encore vérifié en jeu sur ta partie.");
  return sim;
}

/** Contexte compact pour LEONIDA AI (mêmes règles que l'Accueil : cohérence garantie). */
export function storyContext(s: StoryInput): string {
  const alerts = storyAlerts(s);
  const top = alerts.filter((a) => a.horizon !== "plus tard").slice(0, 6);
  const later = alerts.filter((a) => a.horizon === "plus tard" && (a.tier === "Critique" || a.tier === "Fortement recommandé")).slice(0, 3);
  const m = s.story?.money ?? {};
  const lines = ["STORY INTELLIGENCE (règles sourcées LEONIDA ; même liste que l'Accueil) :"];
  for (const a of top) lines.push(`- [${a.tier} · ${a.confidence} · ${a.when}] ${a.advice}${a.money ? ` (${a.money})` : ""}${a.contradictions.length ? ` — contradiction : ${a.contradictions[0]}` : ""}`);
  for (const a of later) lines.push(`- [plus tard · ${a.tier} · ${a.confidence}] ${a.advice}${a.masked ? " (raison masquée par l'anti-spoiler : ne la révèle pas)" : ""}`);
  const money = (Object.keys(RESOURCE_FR) as ResourceId[]).filter((k) => m[k]).map((k) => `${RESOURCE_FR[k]} ${gaugeLabel(m[k])}`);
  lines.push(`- Argent déclaré : ${money.length ? money.join(", ") : "non renseigné (ne suppose aucun solde)"}`);
  lines.push(`- ${coverageLine(s.profile.chapter)} Ne dis jamais « rien à manquer » pour une partie non auditée.`);
  return lines.join("\n");
}


/**
 * V0.18.1 · Garde-fou avant de LANCER une mission : point de non-retour ou risques « Critique » documentés.
 * null = rien d'important → aucune confirmation (le joueur n'est pas freiné sans raison).
 */
export function launchRisks(s: StoryInput, name: string): { pnr: boolean; lines: string[]; count: number } | null {
  const sim = simulateLaunch(s, name);
  if (!sim) return null;
  const crit = [...sim.money, ...sim.disappears].filter((l) => l.tier === "Critique");
  if (!sim.pointOfNoReturn && !crit.length) return null;
  return { pnr: sim.pointOfNoReturn, lines: crit.slice(0, 2).map((l) => l.text), count: crit.length };
}
