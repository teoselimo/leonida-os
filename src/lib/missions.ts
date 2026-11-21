import type { RadarFeed, RadarRecord } from "./feed";
import { spoilerVisibility } from "./feed";
import { MISSION_ALIASES_FR } from "./fr";

/**
 * Catalogue des missions, construit uniquement à partir du flux LEONIDA RADAR :
 * noms cités par les fiches structurées (mission, « disparaît au lancement de », « accessible après »),
 * titres de guides (« X Walkthrough », « Mission #N - X (Chapter C) ») et glossaire d'alias français.
 *
 * Règles :
 * - jamais de mission inventée à partir du chapitre seul ;
 * - l'ordre (« prochaine mission probable ») n'est proposé que si la numérotation est cohérente,
 *   et toujours soumis à la confirmation du joueur ;
 * - la correspondance d'une phrase avec une mission est STRUCTURÉE (nom complet, alias, faute de frappe légère),
 *   jamais un simple mot commun.
 */

export interface MissionInfo {
  name: string;
  key: string;
  aliases: string[];
  chapter: number | null;
  /** Numéros d'ordre revendiqués par les sources (une revendication par source/titre). */
  order: Array<{ n: number; recordId: string; source: string }>;
  /** Fiches qui documentent la mission (guides, vidéos). */
  guideIds: string[];
  /** Personnages cités dans le nom (« Donnie », « Shirley »), pour les questions « la mission de Donnie ». */
  people: string[];
}

export const nk = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const keyOf = (s: string) => nk(s).replace(/'/g, "");

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "la", "le", "les", "de", "du", "des", "mission"]);
const BAD_NAME = /\b(gta|100|part|guide|guides|walkthroughs?|livestream|chapter|best|how|where|all|every)\b/i;

function cleanName(raw: string): string | null {
  const n = raw.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  if (n.length < 3 || n.length > 48) return null;
  if (BAD_NAME.test(n)) return null;
  // les titres de plan du site (slugs en minuscules) ne sont pas des noms officiels
  if (n === n.toLowerCase()) return null;
  if (n.split(" ").length > 7) return null;
  // nom tronqué (« BuckMe a ») : se termine par un mot-outil anglais en minuscules
  if (/\s(a|an|the|of|to|and|for|in|on)$/.test(n)) return null;
  return n;
}

const catCache = new WeakMap<object, Map<string, MissionInfo>>();
/** Catalogue mis en cache par flux (recalculé seulement quand la veille publie un nouveau flux). */
export function missionCatalog(feed: RadarFeed | null): Map<string, MissionInfo> {
  if (!feed) return new Map();
  const hit = catCache.get(feed);
  if (hit) return hit;
  const map = buildCatalog(feed);
  catCache.set(feed, map);
  return map;
}

function buildCatalog(feed: RadarFeed): Map<string, MissionInfo> {
  const map = new Map<string, MissionInfo>();
  const add = (rawName: string | null | undefined, rec: RadarRecord, extra: Partial<Pick<MissionInfo, "chapter">> & { alias?: string | null; order?: number | null; guide?: boolean } = {}) => {
    const name = rawName ? cleanName(rawName) : null;
    if (!name) return;
    const key = keyOf(name);
    let m = map.get(key);
    if (!m) {
      m = { name, key, aliases: [], chapter: null, order: [], guideIds: [], people: [] };
      map.set(key, m);
    }
    if (extra.chapter != null && m.chapter == null) m.chapter = extra.chapter;
    if (extra.alias) {
      const a = keyOf(extra.alias);
      if (a && a !== key && !m.aliases.includes(a)) m.aliases.push(a);
    }
    if (extra.order != null && !m.order.some((o) => o.recordId === rec.id && o.n === extra.order)) m.order.push({ n: extra.order, recordId: rec.id, source: rec.evidence[0]?.sourceName ?? "" });
    if (extra.guide && !m.guideIds.includes(rec.id)) m.guideIds.push(rec.id);
  };

  for (const r of feed.items) {
    const d = r.details;
    const ch = d?.chapter?.value ?? null;
    if (d?.mission?.value) add(d.mission.value, r, { chapter: ch, guide: r.category === "guide" });
    if (d?.contextMissable?.value.subject) add(d.contextMissable.value.subject, r, { chapter: ch });
    if (d?.contextMissable?.value.until) add(d.contextMissable.value.until, r);
    if (d?.unlockAfter?.value) add(d.unlockAfter.value, r);
    // titres et extraits de guides
    const texts = [r.title, ...r.evidence.flatMap((e) => [e.title, e.excerpt ?? ""])];
    for (const t of texts) {
      for (const m of t.matchAll(/Mission #(\d+)\s*-\s*(.+?)\s*\(Chapter (\d+)\)/g)) add(m[2], r, { order: +m[1], chapter: +m[3], guide: t === r.title });
      for (const m of t.matchAll(/walkthrough of "([^"]+)", the (\d+)(?:st|nd|rd|th) mission in "Chapter (\d+)/gi)) add(m[1], r, { order: +m[2], chapter: +m[3] });
    }
    const w = r.title.match(/^GTA (?:6|VI)\s+(.+?)\s*(?:\(([^)]+)\)\s*)?Walkthrough(?:$|[:\s])/i);
    if (w && r.category === "guide") add(w[1], r, { chapter: ch, alias: w[2] ?? null, guide: true });
  }
  for (const [fr, target] of Object.entries(MISSION_ALIASES_FR)) {
    const m = map.get(keyOf(target));
    if (m && !m.aliases.includes(keyOf(fr))) m.aliases.push(keyOf(fr));
  }
  for (const m of map.values()) m.people = (m.name.match(/\b([A-Z][a-z]+)(?:'s)?\b/g) ?? []).map((p) => p.replace(/'s$/, "")).filter((p) => PEOPLE.has(p));
  return map;
}

/** Personnages connus (glossaire) : seuls ces prénoms servent à « la mission de X ». */
const PEOPLE = new Set(["Donnie", "Shirley", "Moses", "Kirk", "Andrea", "Kordell", "Rafa", "Shayna", "Andrés", "Mattia", "Kat", "Brian", "Lucia", "Jason", "Cal", "Boobie", "Dre"]);

/** Mission visible pour le joueur sans spoiler (chapitre connu et atteint, ou mode modéré). */
export function missionVisible(m: MissionInfo, chapter: number, spoilerMode: "strict" | "relaxed" | "off"): boolean {
  if (spoilerMode !== "strict") return true;
  return m.chapter != null && m.chapter <= chapter;
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const tokens = (s: string) => keyOf(s).split(" ").filter((t) => t && !STOP.has(t));

/** Tous les mots significatifs du nom (ou de l'alias) sont présents dans la phrase, à une faute près pour les mots longs. */
function phraseHas(qTokens: string[], name: string): boolean {
  const need = tokens(name);
  if (!need.length) return false;
  return need.every((t) => qTokens.some((q) => q === t || (t.length >= 5 && lev(q, t) <= 1) || (t.endsWith("s") && q === t.slice(0, -1))));
}

/** Nom de mission cité librement (« lancer Find Donnie's Package », « la mission X »), même s'il est absent du catalogue. */
export function extractMissionPhrase(q: string): string | null {
  const m =
    q.match(/(?:lancer|commencer|faire|démarrer|demarrer|attaquer|jouer|terminé|termine|fini|finir|devant|avant)\s+(?:la\s+mission\s+|à\s+|a\s+)?[«"“]?\s*([A-Z][\w'’.-]*(?:\s+[A-Za-z][\w'’.-]*){0,6})/) ??
    q.match(/mission\s+[«"“]?\s*([A-Z][\w'’.-]*(?:\s+[A-Za-z][\w'’.-]*){0,6})/);
  if (!m) return null;
  const raw = m[1].replace(/[»"”?!.,;]+$/g, "").trim();
  // s'arrêter aux mots de liaison français qui suivent le nom
  const cut = raw.split(/\s+(?:et|puis|mais|car|donc|est|je|tu|il|ça|ca|qu|que|avec|sans|pour|dans)\b/i)[0].trim();
  return cut.length >= 3 ? cut : null;
}

export interface MissionMatch {
  mission: MissionInfo | null;
  /** Plusieurs missions possibles (ex. « la mission de Donnie ») : demander laquelle. */
  candidates: MissionInfo[];
  /** Nom tel que cité par le joueur, quand il n'est pas au catalogue. */
  raw: string | null;
}

export function resolveMission(q: string, catalog: Map<string, MissionInfo>, opts: { chapter: number; spoilerMode: "strict" | "relaxed" | "off" }): MissionMatch {
  const qTok = keyOf(q).split(" ");
  const all = [...catalog.values()];
  const direct = all.filter((m) => phraseHas(qTok, m.name) || m.aliases.some((a) => phraseHas(qTok, a)));
  // le nom le plus long l'emporte (« Skunk Ape » contre « Skunk Ape Part 2 »)
  if (direct.length) {
    direct.sort((a, b) => tokens(b.name).length - tokens(a.name).length);
    return { mission: direct[0], candidates: [], raw: null };
  }
  const raw = extractMissionPhrase(q);
  // « la mission de Donnie » / « je suis devant Donnie » : personnage → missions visibles qui le citent
  const person = [...PEOPLE].find((p) => new RegExp(`\\b${p}\\b`, "i").test(q));
  if (person && (!raw || keyOf(raw) === keyOf(person) || /mission (de|d')|devant/i.test(q))) {
    // personnage seul : toujours faire confirmer la mission (jamais de supposition)
    const c = all.filter((m) => m.people.includes(person) && missionVisible(m, opts.chapter, opts.spoilerMode));
    return { mission: null, candidates: c, raw: raw && keyOf(raw) !== keyOf(person) ? raw : null };
  }
  return { mission: null, candidates: [], raw };
}

/**
 * Prochaine mission probable : uniquement si la dernière mission terminée a un numéro d'ordre non contesté
 * et qu'une seule mission revendique le numéro suivant. Toujours à faire confirmer par le joueur.
 */
export function nextMissionGuess(catalog: Map<string, MissionInfo>, last: string | null): { mission: MissionInfo; basis: string } | null {
  if (!last) return null;
  const lm = catalog.get(keyOf(last));
  if (!lm) return null;
  const nums = new Set(lm.order.map((o) => o.n));
  if (nums.size !== 1) return null;
  const n = [...nums][0];
  const claimsN = [...catalog.values()].filter((m) => m.order.some((o) => o.n === n));
  if (claimsN.length !== 1) return null; // numéro revendiqué par deux missions : séquence non fiable
  const next = [...catalog.values()].filter((m) => m.order.some((o) => o.n === n + 1));
  if (next.length !== 1 || new Set(next[0].order.map((o) => o.n)).size !== 1) return null;
  return { mission: next[0], basis: "d'après la numérotation d'une série de guides vidéo (une seule source)" };
}

export interface MissionBrief {
  mission: MissionInfo | null;
  name: string;
  /** Récupérable pendant la mission (fiches structurées : mission = nom). */
  during: RadarRecord[];
  /** À faire AVANT de lancer la mission (fiches « disparaît au lancement de »). */
  before: RadarRecord[];
  /** Au moins un guide décrit la mission (sans garantir l'exhaustivité). */
  guide: RadarRecord | null;
}

export function missionBrief(feed: RadarFeed | null, name: string, ctx: { chapter: number; spoilerMode: "strict" | "relaxed" | "off"; done: Record<string, string> }): MissionBrief {
  const catalog = missionCatalog(feed);
  const k = keyOf(name);
  const mission = catalog.get(k) ?? null;
  const same = (v: string | null | undefined) => !!v && keyOf(v) === k;
  const items = (feed?.items ?? []).filter((r) => r.status === "active" && !ctx.done[r.id] && spoilerVisibility(r, ctx.spoilerMode, ctx.chapter) === "visible");
  const useful = (r: RadarRecord) => r.category !== "guide" && r.category !== "news" && (r.details?.money || r.details?.place || r.conditions.reward);
  const during = items.filter((r) => (same(r.details?.mission?.value) || same(r.details?.contextMissable?.value.subject)) && useful(r));
  const before = items.filter((r) => same(r.details?.contextMissable?.value.until) && !during.includes(r));
  const guide = mission ? (feed?.items ?? []).find((r) => mission.guideIds.includes(r.id)) ?? null : null;
  return { mission, name: mission?.name ?? name, during, before, guide };
}

const glossCache = new WeakMap<object, { missions: string[]; proper: string[] }>();
/** Glossaire de noms propres protégés (missions + véhicules) pour les titres français ; mis en cache par flux. */
export function glossaryOf(feed: RadarFeed | null): { missions: string[]; proper: string[] } {
  if (!feed) return { missions: [], proper: [] };
  let g = glossCache.get(feed);
  if (!g) {
    g = { missions: [...missionCatalog(feed).values()].map((m) => m.name), proper: (feed.vehicles ?? []).map((v) => v.name.replace(/^'\d+\s*/, "")) };
    glossCache.set(feed, g);
  }
  return g;
}
