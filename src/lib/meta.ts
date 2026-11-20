import type { CategoryId, Chapter, ConsoleId, EditionId, Reliability } from "./types";

export const CATEGORIES: Record<CategoryId, { label: string; plural: string; color: string; icon: string }> = {
  mission: { label: "Mission annexe", plural: "Missions", color: "#FF3D8B", icon: "flag" },
  collectible: { label: "Collectible", plural: "Collectibles", color: "#FFB547", icon: "gem" },
  activity: { label: "Activité", plural: "Activités", color: "#2EE6D6", icon: "bolt" },
  vehicle: { label: "Véhicule", plural: "Véhicules", color: "#5AB8FF", icon: "car" },
  secret: { label: "Secret", plural: "Secrets", color: "#B98CFF", icon: "sparkle" },
  event: { label: "Événement", plural: "Événements", color: "#FF7A45", icon: "calendar" },
};

export const CATEGORY_ORDER: CategoryId[] = ["activity", "collectible", "vehicle", "secret", "mission", "event"];

export const RELIABILITY: Record<Reliability, { label: string; short: string; level: number; color: string }> = {
  official: { label: "Source officielle (Rockstar)", short: "Officiel", level: 4, color: "#7CF29A" },
  confirmed: { label: "Confirmé par plusieurs sources", short: "Confirmé", level: 3, color: "#2EE6D6" },
  reported: { label: "Signalement isolé", short: "Signalé", level: 2, color: "#FFB547" },
  rumor: { label: "Rumeur non confirmée", short: "Rumeur", level: 1, color: "#FF5C7A" },
  personal: { label: "Relevé personnel, non vérifié", short: "Perso · non vérifié", level: 0, color: "#A9A4BC" },
};

/** Seuil « fiable » : officiel ou confirmé. Un relevé personnel n'est jamais fiable par défaut. */
export const isReliable = (r: Reliability) => RELIABILITY[r].level >= 3;

export const CHAPTERS: Record<Chapter, string> = {
  0: "Début de partie",
  1: "Repère 1",
  2: "Repère 2",
  3: "Fin de partie",
};

export const CONSOLES: Record<ConsoleId, string> = {
  ps5: "PS5",
  ps5pro: "PS5 Pro",
  xsx: "Xbox Series X",
  xss: "Xbox Series S",
};

export const EDITIONS: Record<EditionId, string> = {
  standard: "Standard",
  special: "Spéciale / collector",
  unknown: "Non renseignée",
};

export const DIFFICULTY = ["", "Facile", "Moyen", "Exigeant"] as const;
