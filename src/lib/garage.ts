import type { VehicleRecord } from "../../collector/src/types";
import type { EditionId, PersistedState, VehicleState } from "./types";

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

/** Compatibilité avec l'édition du joueur. */
export type Compat = "ok" | "ultimate-only" | "check" | "preorder";

export function compatibility(v: VehicleRecord, edition: EditionId): Compat {
  const ex = v.edition.exclusive;
  if (!ex) return "ok";
  if (ex === "preorder") return "preorder"; // bonus de précommande : les deux éditions, selon la date d'achat
  if (edition === "ultimate") return v.edition.status === "confirmed" ? "ok" : "check";
  if (edition === "standard") return v.edition.status === "confirmed" ? "ultimate-only" : "check";
  return "check";
}

/** Chapitre nécessaire : celui indiqué par les sources, ou déduit d'une règle (cloneur de clé…). */
export function chapterNeeded(v: VehicleRecord): number {
  return Math.max(v.access.chapterMin?.value ?? 0, v.access.inferredChapter?.value ?? 0);
}

export interface VehicleView {
  v: VehicleRecord;
  compat: Compat;
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
  const compat = compatibility(v, s.profile.edition);
  const need = chapterNeeded(v);
  const later = need > s.profile.chapter;
  const until = v.access.until?.value ?? null;
  const expired = until != null && s.profile.chapter > until;
  const owned = s.vehicles[v.id]?.state ?? null;
  const locatable = v.type === "vehicle" && v.location.precision !== "none" && v.kind !== "news";
  const now = locatable && !later && !expired && (compat === "ok" || compat === "preorder") && v.reliability !== "rumor" && (!owned || owned === "spotted");
  const urgent = !expired && !later && (until != null || v.risks.some((r) => /\b(lose|lost|disappear|only available)\b/i.test(r.quote))) && compat !== "ultimate-only";
  const hidden = later && s.profile.spoilerMode === "strict";
  return { v, compat, need, later, expired, owned, now, urgent, hidden };
}

export type GarageFilter = "now" | "hidden" | "ultimate" | "garages" | "urgent" | "owned" | "unconfirmed" | "locate";
export const FILTERS: Array<{ id: GarageFilter; label: string }> = [
  { id: "now", label: "Accessibles maintenant" },
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
    .filter((x) => x.now && x.compat !== "check" && (x.v.location.precision === "zone" || x.v.location.precision === "exact"))
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
  preorder: "Bonus de précommande (les deux éditions)",
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
