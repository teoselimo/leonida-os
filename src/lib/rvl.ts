import { RARE_VEHICLES, RVL_BY_ID, type RvlLocation, type RvlVehicle } from "@/data/rareVehicles";
import { independentTotal, trustFor, type Trust3 } from "./evidence";
export { v016Check } from "@/data/rareVehicles";
import type { PersistedState } from "./types";

export { RARE_VEHICLES, RVL_BY_ID };
export type { RvlVehicle, RvlLocation };

/**
 * Rare Vehicle Locator : ce que le référentiel signifie pour CE joueur.
 * Accessibilité = chapitre atteint + mission préalable faite (déclarée dans Partie) + édition.
 * Jamais « accessible » par défaut : si la progression ne le permet pas, on le dit.
 */
export type RvlAccess = "now" | "order-pending" | "after-mission" | "later";

export const PRESENCE_FR: Record<RvlLocation["presence"], string> = {
  fixe: "Toujours au même endroit",
  mobile: "En mouvement : pas garanti à un point",
  aleatoire: "Apparition aléatoire : pas garantie",
};
export const PRESENCE_SHORT: Record<RvlLocation["presence"], string> = { fixe: "Garé à un endroit fixe", mobile: "En mouvement", aleatoire: "Apparition aléatoire" };

export const PRECISION_RVL_FR: Record<RvlLocation["precision"], string> = {
  point: "Bâtiment identifié",
  parcours: "Parcours tracé",
  zone: "Zone de recherche",
  inconnue: "Position inconnue sur notre carte",
};

export const ZONEKIND_FR = { documentee: "zone documentée", estimee: "zone estimée", large: "zone large" } as const;

/** Clé de sauvegarde (done) : le joueur confirme avoir reçu la commande de Moses. */
export const orderKey = (id: string) => `order:${id}`;

const missionDone = (s: Pick<PersistedState, "profile">, name: string) =>
  s.profile.missionsDone.some((m) => m.toLowerCase() === name.toLowerCase()) || s.profile.lastMission?.toLowerCase() === name.toLowerCase();

export interface RvlView {
  r: RvlVehicle;
  access: RvlAccess;
  /** Anti-spoiler strict : chapitre pas encore atteint → nom de mission et donneur masqués. */
  masked: boolean;
  /** Trois fiabilités distinctes. */
  existence: { trust: Trust3; sources: number };
  location: { label: string; short: string; tested: boolean; sources: number; errorM: number | null };
  presence: { label: string; guaranteed: boolean };
  /** Disponibilité du lieu (on peut y aller) ≠ disponibilité de la commande (la voiture y est). */
  place: string;
  mission: string | null;
  orderReceived: boolean;
  /** Texte de la condition, déjà adapté à l'anti-spoiler. */
  condition: string;
  sources: number;
  trust: Trust3;
}

type St = Pick<PersistedState, "profile"> & { done?: Record<string, string> };

export function rvlView(r: RvlVehicle, s: St): RvlView {
  const c = r.condition;
  const ch = s.profile.chapter;
  const masked = s.profile.spoilerMode === "strict" && ch < c.chapterMin;
  const preDone = c.afterMission ? missionDone(s, c.afterMission.name) || ch > c.afterMission.chapter : true;
  const orderReceived = !!s.done?.[orderKey(r.id)];
  const access: RvlAccess = ch < c.chapterMin ? "later" : !preDone ? "after-mission" : c.series && !orderReceived ? "order-pending" : "now";
  const mission = c.afterMission ? (masked ? "une mission à venir" : `« ${c.afterMission.name} »`) : null;
  const giver = c.giver ? (masked ? "un contact de l'histoire" : c.giver.name) : null;
  const parts: string[] = [];
  if (c.chapterMin <= 1 && !mission) parts.push("Dès l'exploration libre (chapitre 1)");
  else parts.push(`Chapitre ${c.chapterMin}${mission ? `, après ${mission}` : ""}`);
  if (giver && c.series) {
    const lot = c.series.after.length ? `arrive après la livraison de ${masked ? "deux premières commandes" : c.series.after.join(" et ")}` : "fait partie des premières commandes";
    parts.push(`commande de ${giver} : ${lot}`);
  }
  const loc = r.locations[0];
  const ex = trustFor(r.evidence, "existe");
  const lt = trustFor(r.evidence, loc.claims.location);
  const tested = loc.point?.status === "teste-en-jeu";
  const err = loc.precision === "parcours" ? loc.route?.errorM ?? null : loc.point?.errorM ?? null;
  const locLabel =
    loc.precision === "inconnue"
      ? "Inconnu : pas d'épingle"
      : loc.precision === "parcours"
        ? `Parcours tracé à ±${err} m (calibré, non testé en jeu)`
        : loc.precision === "point"
          ? tested
            ? `Testé en jeu (±${err} m)`
            : `Calibré à ±${err} m, non testé en jeu`
          : "Zone de recherche";
  const locShort = loc.precision === "point" ? (tested ? `Testé ±${err} m` : `Calibré ±${err} m`) : loc.precision === "parcours" ? `Parcours ±${err} m` : loc.precision === "inconnue" ? "Inconnu" : "Zone";
  const place = c.chapterMin <= 1 ? "Lieu accessible dès l'exploration libre." : `Lieu accessible sur la carte ; ${c.series ? "la voiture n'y est garantie qu'une fois la commande reçue" : "conditions ci-dessous"}.`;
  const missionTxt = c.series
    ? access === "now"
      ? "Commande reçue : la voiture t'attend."
      : access === "order-pending"
        ? `${masked ? "Commande" : "Commande de Moses"} pas encore reçue (ou pas encore confirmée ici).`
        : null
    : null;
  return {
    r,
    access,
    masked,
    existence: { trust: ex.trust, sources: ex.independent },
    location: { label: locLabel, short: locShort, tested, sources: lt.independent, errorM: err },
    presence: { label: PRESENCE_FR[loc.presence], guaranteed: loc.presence === "fixe" },
    place,
    mission: missionTxt,
    orderReceived,
    trust: ex.trust,
    sources: independentTotal(r.evidence),
    condition: parts.join(" · "),
  };
}

export const ACCESS_RVL_FR: Record<RvlAccess, string> = {
  now: "Accessible maintenant",
  "order-pending": "Commande à recevoir",
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
    const zone = loc.zone ? { ...loc.zone, widened: false } : null;
    return {
      ...v,
      kind: loc.presence === "fixe" ? ("hidden" as const) : ("dynamic" as const),
      // le point validé du flux (s'il existe) est conservé ; la position calibrée reste distincte (jamais une « épingle validée »)
      location: { ...v.location, district: loc.area, precision: loc.precision === "inconnue" ? ("text" as const) : ("zone" as const), zone, point: v.location.point, alternatives: [] },
      keep: r.keep.possible === "inconnu" ? { ...v.keep, mode: "unknown" as const, rule: null } : v.keep,
    };
  });
  return touched ? { ...feed, vehicles } : feed;
}
