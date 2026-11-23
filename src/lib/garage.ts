import type { VehicleRecord } from "../../collector/src/types";
import type { EditionId, PersistedState, VehicleState } from "./types";
import { RVL_BY_ID } from "@/data/rareVehicles";

export type { VehicleRecord };

/**
 * Garage des légendes : ce que le catalogue automatique signifie pour CE joueur
 * (édition possédée, chapitre atteint, véhicules déjà possédés, anti-spoiler).
 * Rien ici n'invente une donnée : on ne fait que filtrer et classer les fiches du flux.
 */

export const STATE_ORDER: VehicleState[] = ["spotted", "stolen", "registered", "stored"];
export const STATE_FR: Record<VehicleState | "none", string> = {
  none: "À découvrir",
  spotted: "Repéré",
  stolen: "Volé ou récupéré",
  registered: "Véhicule personnel",
  stored: "Rangé au garage",
};

/** Compatibilité avec l'édition du joueur et son éligibilité aux bonus de précommande (deux réglages distincts). */
export type Compat = "ok" | "ultimate-only" | "check" | "preorder" | "preorder-no";

export function compatibility(v: VehicleRecord, edition: EditionId, preorder: "yes" | "no" | "unknown" = "unknown"): Compat {
  const ex = v.edition.exclusive;
  if (!ex) return "ok";
  // bonus de précommande : les deux éditions, uniquement si le joueur y a droit (jamais déduit de l'édition)
  if (ex === "preorder") return preorder === "yes" ? "ok" : preorder === "no" ? "preorder-no" : "preorder";
  if (edition === "ultimate") return v.edition.status === "confirmed" ? "ok" : "check";
  if (edition === "standard") return v.edition.status === "confirmed" ? "ultimate-only" : "check";
  return "check";
}

/** Chapitre nécessaire : celui indiqué par les sources, ou déduit d'une règle (cloneur de clé…). */
export function chapterNeeded(v: VehicleRecord): number {
  return Math.max(v.access.chapterMin?.value ?? 0, v.access.inferredChapter?.value ?? 0);
}

/** Accès pour ce joueur : maintenant (conditions établies), à confirmer (conditions inconnues), plus tard, dépassé, ou exclu. */
export type Access = "now" | "confirm" | "later" | "expired" | "excluded";

export interface VehicleView {
  v: VehicleRecord;
  compat: Compat;
  access: Access;
  need: number;
  /** Plus tard dans l'histoire (masqué en anti-spoiler strict). */
  later: boolean;
  /** Fenêtre dépassée (« seulement au chapitre 1 » alors que le joueur est plus loin). */
  expired: boolean;
  owned: VehicleState | null;
  /** Récupérable maintenant pour ce joueur. */
  now: boolean;
  /** À ne pas manquer : fenêtre limitée ou risque de perte documenté. */
  urgent: boolean;
  hidden: boolean;
}

export function viewOf(v: VehicleRecord, s: Pick<PersistedState, "profile" | "vehicles">): VehicleView {
  const compat = compatibility(v, s.profile.edition, s.profile.preorder);
  const rv = RVL_BY_ID.get(v.id);
  const need = rv ? rv.condition.chapterMin : chapterNeeded(v);
  // référentiel vérifié : une mission préalable non faite rend l'accès « plus tard », jamais « maintenant »
  const rvMissionPending = !!rv?.condition.afterMission && s.profile.chapter <= rv.condition.afterMission.chapter && !s.profile.missionsDone.some((m) => m.toLowerCase() === rv.condition.afterMission!.name.toLowerCase());
  // le chapitre d'accès n'est « établi » que s'il est cité, déduit d'une règle sourcée, ou si la source dit « accessible tôt »
  const accessKnown = !!rv || v.access.chapterMin != null || v.access.inferredChapter != null || v.access.early;
  const later = need > s.profile.chapter || rvMissionPending;
  const until = v.access.until?.value ?? null;
  const expired = until != null && s.profile.chapter > until;
  const owned = s.vehicles[v.id]?.state ?? null;
  const locatable = v.type === "vehicle" && v.location.precision !== "none" && v.kind !== "news";
  const compatible = compat === "ok";
  const now = (locatable || !!rv) && accessKnown && !later && !expired && compatible && v.reliability !== "rumor" && (!owned || owned === "spotted");
  const access: Access = compat === "ultimate-only" || compat === "preorder-no" ? "excluded" : expired ? "expired" : later ? "later" : now ? "now" : "confirm";
  // « À ne pas manquer » : seulement une fenêtre limitée explicite, encore ouverte, pour un contenu auquel le joueur a droit
  const urgent = until != null && !expired && !later && compatible && (!owned || owned === "spotted");
  const hidden = need > s.profile.chapter && s.profile.spoilerMode === "strict";
  return { v, compat, access, need, later, expired, owned, now, urgent, hidden };
}

export type GarageFilter = "now" | "confirm" | "hidden" | "ultimate" | "garages" | "urgent" | "owned" | "unconfirmed" | "locate";
export const FILTERS: Array<{ id: GarageFilter; label: string }> = [
  { id: "now", label: "Accessibles maintenant" },
  { id: "confirm", label: "Accès à confirmer" },
  { id: "hidden", label: "Garées ou en circulation" },
  { id: "ultimate", label: "Exclusifs Ultimate" },
  { id: "garages", label: "Garages et propriétés" },
  { id: "urgent", label: "À ne pas manquer" },
  { id: "owned", label: "Déjà possédés" },
  { id: "unconfirmed", label: "Non confirmées" },
  { id: "locate", label: "À localiser" },
];

export function matches(x: VehicleView, f: GarageFilter): boolean {
  switch (f) {
    case "now":
      return x.now;
    case "confirm":
      return x.access === "confirm" && x.v.type === "vehicle";
    case "hidden":
      return x.v.type === "vehicle" && (x.v.kind === "hidden" || x.v.kind === "dynamic");
    case "ultimate":
      return x.v.edition.exclusive === "ultimate";
    case "garages":
      return x.v.type === "garage";
    case "urgent":
      return x.urgent;
    case "owned":
      return x.owned != null && x.owned !== "spotted";
    case "unconfirmed":
      return x.v.reliability === "reported" || x.v.reliability === "rumor";
    case "locate":
      return x.v.type === "vehicle" && (x.v.location.precision === "none" || x.v.location.precision === "text");
  }
}

/**
 * Recommandations « voiture » : uniquement des véhicules récupérables maintenant, compatibles avec l'édition,
 * non possédés, et localisables (zone ou point). Les exclusivités non vérifiées ne sont jamais recommandées.
 */
export function vehicleRecommendations(list: VehicleRecord[], s: Pick<PersistedState, "profile" | "vehicles">, limit = 3): VehicleView[] {
  const RW = { official: 4, confirmed: 3, reported: 1, rumor: 0, personal: 0 } as const;
  return list
    .map((v) => viewOf(v, s))
    // localisable (zone ou point) — ou bonus remis au joueur (notification en jeu), qui n'a pas besoin d'être cherché
    .filter((x) => x.now && (x.v.location.precision === "zone" || x.v.location.precision === "exact" || x.v.kind === "delivery"))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.v.edition.exclusive === "ultimate") - Number(a.v.edition.exclusive === "ultimate") || RW[b.v.reliability] - RW[a.v.reliability] || b.v.evidence.length - a.v.evidence.length)
    .slice(0, limit);
}

export const KIND_FR: Record<VehicleRecord["kind"], string> = {
  hidden: "Garé à un endroit fixe",
  dynamic: "Apparition aléatoire",
  mission: "Lié à une mission",
  delivery: "Remis au joueur",
  news: "Emplacement inconnu",
};

export const COMPAT_FR: Record<Compat, string> = {
  ok: "Compatible avec ton édition",
  "ultimate-only": "Réservé à l'édition Ultimate",
  check: "Compatibilité à vérifier",
  preorder: "Bonus de précommande : renseigne ton éligibilité dans Profil",
  "preorder-no": "Bonus de précommande : tu n'y as pas droit",
};

export const ACCESS_FR: Record<Access, string> = {
  now: "Accessible maintenant",
  confirm: "Accès à confirmer",
  later: "Plus tard dans l'histoire",
  expired: "Fenêtre dépassée",
  excluded: "Non disponible pour toi",
};

/** Texte de conservation, sans rien inventer : bonus conservé d'office, règle d'immatriculation sourcée, ou inconnu. */
export function keepText(v: VehicleRecord): string {
  if (v.keep.mode === "yes") return "Conservé automatiquement (contenu remis au joueur).";
  if (v.keep.rule) {
    const t = v.keep.rule.tracker === "standard" ? " (véhicules à traqueur standard)" : v.keep.rule.tracker === "none" || v.keep.rule.tracker == null ? " (véhicules sans traqueur)" : "";
    return `À immatriculer à partir du chapitre ${v.keep.rule.chapter}${v.keep.rule.where ? `, ${v.keep.rule.where}` : ""}${t}.`;
  }
  return v.type === "garage" ? "Conditions d'accès non documentées." : "Méthode de conservation non documentée par les sources.";
}
