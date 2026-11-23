import { RARE_VEHICLES, RVL_BY_ID, type RvlLocation, type RvlVehicle } from "@/data/rareVehicles";
import { independentTotal, trustFor, type Trust3 } from "./evidence";
import type { PersistedState } from "./types";

export { RARE_VEHICLES, RVL_BY_ID };
export type { RvlVehicle, RvlLocation };

/**
 * Rare Vehicle Locator : ce que le référentiel signifie pour CE joueur.
 * Accessibilité = chapitre atteint + mission préalable faite (déclarée dans Partie) + édition.
 * Jamais « accessible » par défaut : si la progression ne le permet pas, on le dit.
 */
export type RvlAccess = "now" | "after-mission" | "later";

export const PRESENCE_FR: Record<RvlLocation["presence"], string> = {
  fixe: "Toujours au même endroit",
  mobile: "En mouvement : pas garanti à un point",
  aleatoire: "Apparition aléatoire : pas garantie",
};

export const PRECISION_RVL_FR: Record<RvlLocation["precision"], string> = {
  point: "Point exact vérifié",
  zone: "Zone de recherche",
  inconnue: "Position inconnue sur notre carte",
};

export const ZONEKIND_FR = { documentee: "zone documentée", estimee: "zone estimée", large: "zone large" } as const;

const missionDone = (s: Pick<PersistedState, "profile">, name: string) =>
  s.profile.missionsDone.some((m) => m.toLowerCase() === name.toLowerCase()) || s.profile.lastMission?.toLowerCase() === name.toLowerCase();

export interface RvlView {
  r: RvlVehicle;
  access: RvlAccess;
  /** Anti-spoiler strict : chapitre pas encore atteint → nom de mission et donneur masqués. */
  masked: boolean;
  trust: Trust3;
  sources: number;
  /** Texte de la condition, déjà adapté à l'anti-spoiler. */
  condition: string;
}

export function rvlView(r: RvlVehicle, s: Pick<PersistedState, "profile">): RvlView {
  const c = r.condition;
  const ch = s.profile.chapter;
  const mDone = c.afterMission ? missionDone(s, c.afterMission.name) || ch > c.afterMission.chapter : true;
  const access: RvlAccess = ch < c.chapterMin ? "later" : !mDone ? "after-mission" : "now";
  const masked = s.profile.spoilerMode === "strict" && ch < c.chapterMin;
  const mission = c.afterMission ? (masked ? "une mission à venir" : `« ${c.afterMission.name} »`) : null;
  const giver = c.giver ? (masked ? "un contact de l'histoire" : c.giver.name) : null;
  const parts: string[] = [];
  if (c.chapterMin <= 1 && !mission) parts.push("Dès l'exploration libre (chapitre 1)");
  else parts.push(`Chapitre ${c.chapterMin}${mission ? `, après ${mission}` : ""}`);
  if (giver) parts.push(`commande de ${giver}${c.order ? ` (cible ${c.order.rank} sur ${c.order.of}, dans l'ordre)` : ""}`);
  const loc = r.locations[0];
  const t = trustFor(r.evidence, loc.claims.location);
  return { r, access, masked, trust: t.trust, sources: independentTotal(r.evidence), condition: parts.join(" · ") };
}

export const ACCESS_RVL_FR: Record<RvlAccess, string> = {
  now: "Accessible maintenant",
  "after-mission": "Après une mission",
  later: "Plus tard dans l'histoire",
};

/** Recherche tolérante : nom, modèle, alias courants (« voiture de Paul Walker »…). */
const ALIASES: Record<string, string[]> = {
  "v-maibatsu-penumbra-ff": ["penumbra", "paul walker", "fast and furious", "fast & furious", "eclipse", "had you", "brian"],
  "v-bf-bandito": ["bandito", "buggy"],
  "v-annis-hellion": ["hellion"],
  "v-karin-futo": ["futo"],
  "v-declasse-vamos": ["vamos", "2727"],
};
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function findRare(q: string): RvlVehicle | null {
  const n = norm(q);
  return RARE_VEHICLES.find((r) => (ALIASES[r.id] ?? []).some((a) => n.includes(a)) || n.includes(norm(r.name).replace(/^'97 /, ""))) ?? null;
}

/**
 * Applique le référentiel vérifié aux fiches du flux (mêmes identifiants, donc même sauvegarde) :
 * zone de recherche, quartier, nature de la présence, conservation. Une position « inconnue » retire toute zone
 * (le flux plaçait par exemple le Vamos à Port Gellhorn, ce qui était faux).
 */
export function withRvl<T extends { vehicles?: Array<import("./garage").VehicleRecord> }>(feed: T | null): T | null {
  if (!feed?.vehicles) return feed;
  let touched = false;
  const vehicles = feed.vehicles.map((v) => {
    const r = RVL_BY_ID.get(v.id);
    if (!r) return v;
    touched = true;
    const loc = r.locations[0];
    const zone = loc.zone ? { ...loc.zone, widened: loc.zoneKind === "large" } : null;
    const others = r.locations.slice(1).map((l) => ({ district: l.area, text: l.label, sourceName: "LEONIDA (référentiel vérifié)", url: "" }));
    return {
      ...v,
      kind: loc.presence === "fixe" ? ("hidden" as const) : ("dynamic" as const),
      location: { ...v.location, district: loc.area, precision: loc.precision === "point" ? ("exact" as const) : loc.precision === "zone" ? ("zone" as const) : ("text" as const), zone, point: null, alternatives: [...others] },
      keep: r.keep.possible === "inconnu" ? { ...v.keep, mode: "unknown" as const, rule: null } : v.keep,
    };
  });
  return touched ? { ...feed, vehicles } : feed;
}
