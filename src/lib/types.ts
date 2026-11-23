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

/** Progression narrative : prologue puis chapitres (cités par les guides publics). Le nombre total de chapitres n'est pas établi : 6 = « chapitre 6 ou plus ». */
export type Chapter = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ConsoleId = "ps5" | "ps5pro" | "xsx" | "xss";
/** Édition possédée : décide des véhicules, garages et bonus exclusifs proposés. */
export type EditionId = "standard" | "ultimate" | "unknown";
/** Anti-spoiler : complet (masquer), léger (flouter, révélable au toucher), aucun (tout afficher). */
export type SpoilerMode = "strict" | "relaxed" | "off";

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
  /** Éligibilité aux bonus de précommande : indépendante de l'édition (achat avant la date limite). */
  preorder: "yes" | "no" | "unknown";
  chapter: Chapter;
  /** Dernière mission principale terminée (saisie par le joueur ; aucune lecture de sauvegarde PS5). */
  lastMission: string | null;
  /** Prochaine mission principale, choisie ou confirmée par le joueur (jamais déduite du seul chapitre). */
  nextMission: string | null;
  /** Missions déclarées terminées (sert à savoir qu'une mission limitée a disparu). */
  missionsDone: string[];
  spoilerMode: SpoilerMode;
  /** La prochaine mission est lancée (« en cours ») : déclaré par le joueur, jamais déduit. */
  missionInProgress?: boolean;
  /** Objectifs facultatifs identifiés (par le joueur ou proposés par l'analyse « Rien à manquer »). */
  objectives?: Objective[];
}

/** Objectif facultatif lié à une mission, avec son niveau de preuve. */
export interface Objective {
  id: string;
  mission: string;
  text: string;
  done: boolean;
  /** vérifié = source(s) LEONIDA RADAR fiable(s) ; incertain = une source isolée ou web non recoupé ; perso = ajouté par le joueur. */
  basis: "vérifié" | "incertain" | "perso";
  source?: { name: string; url: string };
  at: string;
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
  /** Garage des légendes : état de chaque véhicule pour ce joueur (repéré → rangé au garage). */
  vehicles: Record<string, VehicleProgress>;
  /** Activités de la veille déclarées faites (id de fiche → date). */
  done: Record<string, string>;
  /** Version de migration appliquée. */
  rev?: number;
  /** Analyses « Rien à manquer », une par mission (clé = nom normalisé). Jamais mélangées entre missions. */
  briefs?: Record<string, MissionAlertBrief>;
  /** Positions d'établissements observées en jeu par le joueur (id d'établissement → point). V0.13. */
  pins?: Record<string, { x: number; y: number; at: string; by: "joueur" }>;
  /** Preuves ajoutées par le joueur (lien ou capture réduite), par véhicule ou découverte. Jamais comptées comme sources indépendantes. */
  proofs?: Record<string, import("./evidence").PlayerProof[]>;
  /** Mesures des dernières réponses du copilote (latence, appels, recherches) — comparaison avant / après V0.13. */
  metrics?: import("./copilot/route").TurnMetrics[];
  /** Story Intelligence (V0.17) : argent déclaré (facultatif) et choix narratifs déclarés. Jamais déduit. */
  story?: StoryState;
}

/** Montant déclaré par le joueur : exact, ou tranche (max null = « plus de min »). Absent = inconnu. */
export type Gauge = { mode: "exact"; value: number } | { mode: "range"; min: number; max: number | null };
export interface StoryState {
  money?: Partial<Record<import("./story/model").ResourceId, Gauge>>;
  /** Date de la dernière saisie d'argent (un solde ancien est signalé comme tel). */
  moneyAt?: string;
  /** Choix narratifs déclarés (id de règle → option). */
  choices?: Record<string, string>;
}

export type BriefWhen = "avant" | "pendant" | "apres";
export type BriefKind = "manquable" | "objet_unique" | "facultatif" | "decision" | "non_retour" | "preparation";
/** Statut calculé par l'app (pas déclaré par le modèle) : fiche fiable ou ≥ 2 sites distincts = confirmé. */
export type BriefStatus = "confirmé" | "contradictoire" | "une source";
export interface BriefItem {
  text: string;
  when: BriefWhen;
  kind: BriefKind;
  priority: "haute" | "normale";
  status: BriefStatus;
  /** Ce sur quoi les sources divergent (statut contradictoire). */
  note?: string;
  sources: Array<{ name: string; url: string }>;
}
export interface MissionAlertBrief {
  mission: string;
  at: string;
  summary: string;
  items: BriefItem[];
  web: { status: string; count: number } | null;
  engine: "claude" | "direct";
  model?: string;
}

/** Repéré, volé et possédé sont trois choses différentes. */
export type VehicleState = "spotted" | "stolen" | "registered" | "stored";
export interface VehicleProgress {
  state: VehicleState;
  at: string;
  /** Garage ou lieu de stockage choisi par le joueur (texte libre ou garage du catalogue). */
  storage?: string;
}

export type DiscoveryStatus = "done" | "available" | "locked" | "chapter" | "hidden";

export interface Recommendation {
  discovery: Discovery;
  score: number;
  reasons: string[];
  isFresh: boolean;
}

export type ViewId = "accueil" | "carte" | "radar" | "profil";
