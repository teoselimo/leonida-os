/**
 * Modèle de domaine LEONIDA OS.
 * Ces types sont le contrat partagé entre l'UI, le moteur de recommandation
 * et la couche données (démo aujourd'hui, PostgreSQL demain — voir db/schema.sql).
 */

export type CategoryId = "mission" | "collectible" | "activity" | "vehicle" | "secret" | "event";

/**
 * Niveau de confiance d'une information. Les niveaux ne se mélangent jamais :
 *  - official  : fait publié par Rockstar
 *  - confirmed : recoupé par plusieurs sources indépendantes
 *  - reported  : signalement isolé
 *  - rumor     : rumeur non confirmée
 *  - personal  : relevé du joueur sur son appareil — jamais promu automatiquement
 */
export type Reliability = "official" | "confirmed" | "reported" | "rumor" | "personal";

/** Repère de progression narrative. Valeurs de démo, pas la structure réelle du jeu. */
export type Chapter = 0 | 1 | 2 | 3;

export type ConsoleId = "ps5" | "ps5pro" | "xsx" | "xss";
export type EditionId = "standard" | "special" | "unknown";
export type SpoilerMode = "strict" | "relaxed";

/** Fait vérifié (officiel) ou donnée de démonstration. Jamais de mélange implicite. */
export type Provenance =
  | { kind: "official"; source: string; checkedAt: string }
  | { kind: "demo" }
  | { kind: "player"; createdAt: string }
  /** Fiche issue de la veille automatique, placée sur la carte uniquement si son point a été validé. */
  | { kind: "live"; recordId: string; url: string; firstSeenAt: string };

export interface Region {
  id: string;
  name: string;
  provenance: Provenance;
  tagline: string;
  /** Position de l'étiquette, en coordonnées de jeu (x, y). */
  label: [number, number];
  hue: string;
}

export type Prerequisite =
  | { type: "discovery"; id: string }
  | { type: "chapter"; min: Chapter };

export interface Discovery {
  id: string;
  title: string;
  category: CategoryId;
  regionId: string;
  /** Coordonnées de jeu GTA VI (unités gtadb : origine au centre, y vers le nord). */
  x: number;
  y: number;
  summary: string;
  prerequisites: Prerequisite[];
  reward: string;
  durationMin: number;
  difficulty: 1 | 2 | 3;
  /** Niveau narratif au-delà duquel le contenu est considéré comme spoiler. */
  spoilerChapter: Chapter;
  contentPotential: number;
  source: { label: string; reliability: Reliability };
  /** Fenêtre d'événement (ISO) — uniquement pour la catégorie "event". */
  endsAt?: string;
  provenance: Provenance;
}

export interface RadarSignal {
  id: string;
  title: string;
  summary: string;
  regionId: string;
  category: CategoryId;
  reportedAt: string;
  reliability: Reliability;
  confirmations: number;
  contentPotential: number;
  potentialBreakdown: { visual: number; rarity: number; trend: number };
  spoilerChapter: Chapter;
  discoveryId?: string;
  provenance: Provenance;
}

export interface Profile {
  pseudo: string;
  console: ConsoleId;
  edition: EditionId;
  chapter: Chapter;
  spoilerMode: SpoilerMode;
}

/** État persistant (localStorage aujourd'hui, table player_progress demain). */
export interface PersistedState {
  schema: 1;
  profile: Profile;
  /** id découverte → date ISO de complétion */
  completed: Record<string, string>;
  trackedSignals: string[];
  seenSignals: string[];
  /** Découvertes débloquées par la dernière complétion (badge « Nouveau »). */
  freshUnlocks: string[];
  /** Relevés du joueur (mode cartographe). */
  custom: Discovery[];
  /** Afficher le jeu de données de démonstration. */
  showDemo: boolean;
}

export type DiscoveryStatus = "done" | "available" | "locked" | "chapter" | "hidden";

export interface Recommendation {
  discovery: Discovery;
  score: number;
  reasons: string[];
  isFresh: boolean;
}

export type ViewId = "accueil" | "carte" | "radar" | "profil";
