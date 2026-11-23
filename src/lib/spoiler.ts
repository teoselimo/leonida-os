import type { RadarFeed } from "./feed";
import { missionCatalog, missionVisible } from "./missions";
import { computeProgress, shownName } from "./progress";
import type { PersistedState, SpoilerMode } from "./types";
import { STORY_NODES } from "@/data/story";

/**
 * Anti-spoiler à la SOURCE (V0.14) : la liste des noms de missions futures non accessibles, calculée une fois à partir
 * du moteur de progression (et du catalogue de la veille), puis appliquée aux textes AVANT leur rendu
 * (titres de fiches, sous-titres de l'accueil, points de non-retour, réponses et suggestions du copilote…).
 *
 * - « Masqués » (strict) : tout nom de mission principale verrouillée / inconnue (et ses alias) est remplacé par
 *   « une mission à venir ». Une mission accessible, en cours ou terminée reste nommée.
 * - « Légers » et « Visibles » : les noms restent ; « Légers » floute seulement les fiches d'un chapitre plus avancé.
 */
export const HIDDEN_LABEL = "une mission à venir";

const cache = new WeakMap<object, { key: string; names: string[] }>();

export function hiddenMissionNames(s: Pick<PersistedState, "profile"> & { done?: Record<string, string> }, feed: RadarFeed | null = null): string[] {
  const p = s.profile;
  if (p.spoilerMode !== "strict") return [];
  const key = JSON.stringify([p.missionsDone, p.lastMission, p.nextMission, p.missionInProgress, p.chapter, Object.keys(s.done ?? {}).filter((k) => k.startsWith("prog:"))]);
  const holder = (feed ?? hiddenMissionNames) as object;
  const hit = cache.get(holder);
  if (hit && hit.key === key) return hit.names;
  const v = computeProgress(s);
  const names = new Set<string>();
  const shown = new Set<string>();
  for (const st of v.states) {
    if (st.node.kind !== "main") continue;
    const all = [st.node.name, ...(st.node.aliases ?? [])];
    if (shownName(st, "strict") !== st.node.name) all.forEach((n) => names.add(n));
    else all.forEach((n) => shown.add(n.toLowerCase()));
  }
  // missions connues par la veille mais absentes du graphe : cachées si leur chapitre n'est pas atteint / inconnu
  for (const m of missionCatalog(feed).values()) {
    if (shown.has(m.name.toLowerCase())) continue;
    if (!missionVisible(m, p.chapter, "strict") && !p.missionsDone.some((d) => d.toLowerCase() === m.name.toLowerCase()) && p.nextMission?.toLowerCase() !== m.name.toLowerCase()) names.add(m.name);
  }
  // V0.17 : missions et lieux des chapitres 2 à 5 (inventaire Story Intelligence) au-delà du chapitre atteint
  const declared = [...p.missionsDone, p.nextMission ?? ""].map((m) => m.toLowerCase().replace(/[!.]/g, "").trim());
  for (const n of STORY_NODES) {
    if (n.chapter <= p.chapter) continue;
    const all = [n.name, ...(n.aliases ?? [])];
    if (all.some((x) => declared.includes(x.toLowerCase().replace(/[!.]/g, "").trim()))) continue;
    all.forEach((x) => !shown.has(x.toLowerCase()) && names.add(x));
  }
  // plus longs d'abord : « Home Sweet Home » avant « Home »
  const out = [...names].filter((n) => n.trim().length >= 3).sort((a, b) => b.length - a.length);
  cache.set(holder, { key, names: out });
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remplace chaque nom caché (avec ou sans guillemets « ») par « une mission à venir ». */
export function redact(text: string, names: string[]): string {
  if (!text || !names.length) return text;
  let out = text;
  for (const n of names) {
    const re = new RegExp(`(«\\s*|"|“)?\\b${esc(n)}\\b(\\s*»|"|”)?`, "gi");
    out = out.replace(re, HIDDEN_LABEL);
  }
  // « la mission une mission à venir » → « une mission à venir »
  return out.replace(/\b(la|une) mission une mission à venir/gi, HIDDEN_LABEL).replace(/\b(de|du) une mission/g, "d'une mission");
}

/** Raccourci : rédacteur prêt à l'emploi pour un état donné. */
export function redactorFor(s: Pick<PersistedState, "profile"> & { done?: Record<string, string> }, feed: RadarFeed | null = null): (t: string) => string {
  const names = hiddenMissionNames(s, feed);
  return names.length ? (t: string) => redact(t, names) : (t: string) => t;
}

export const SPOILER_ORDER: SpoilerMode[] = ["strict", "relaxed", "off"];
/** Vrai si passer de `from` à `to` RÉDUIT la protection (demande une confirmation). */
export const lowersProtection = (from: SpoilerMode, to: SpoilerMode) => SPOILER_ORDER.indexOf(to) > SPOILER_ORDER.indexOf(from);
