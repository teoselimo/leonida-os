import type { CategoryId, Chapter, ConsoleId, EditionId, Reliability, SpoilerMode } from "./types";

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
  0: "Prologue",
  1: "Chapitre 1",
  2: "Chapitre 2",
  3: "Chapitre 3",
  4: "Chapitre 4",
  5: "Chapitre 5",
  6: "Chapitre 6 et +",
};
export const CHAPTER_SHORT: Record<Chapter, string> = { 0: "Prol.", 1: "Ch. 1", 2: "Ch. 2", 3: "Ch. 3", 4: "Ch. 4", 5: "Ch. 5", 6: "Ch. 6+" };
export const CHAPTER_LIST: Chapter[] = [0, 1, 2, 3, 4, 5, 6];

export const CONSOLES: Record<ConsoleId, string> = {
  ps5: "PS5",
  ps5pro: "PS5 Pro",
  xsx: "Xbox Series X",
  xss: "Xbox Series S",
};

export const EDITIONS: Record<EditionId, string> = {
  standard: "Standard",
  ultimate: "Ultimate",
  unknown: "Je ne sais pas",
};

export const DIFFICULTY = ["", "Facile", "Moyen", "Exigeant"] as const;

/** Anti-spoiler : libellés courts (puce) et cycle au toucher. */
export const SPOILER_LABEL: Record<SpoilerMode, string> = { strict: "Complet", relaxed: "Léger", off: "Aucun" };
export const SPOILER_NEXT: Record<SpoilerMode, SpoilerMode> = { strict: "relaxed", relaxed: "off", off: "strict" };
export const SPOILER_FR: Record<SpoilerMode, string> = {
  strict: "complet — ne rien révéler au-delà du chapitre et de la mission atteints (ni nom de mission future, ni personnage, ni lieu de l'histoire)",
  relaxed: "léger — tu peux évoquer la suite sans détail d'intrigue (pas de rebondissement, pas de fin de mission), en le signalant",
  off: "aucun — le joueur accepte les révélations",
};
