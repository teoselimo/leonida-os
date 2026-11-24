/**
 * LEONIDA DATA HUB (V0.20) — format commun des données importées (GTABase, GTADB), produit par `hub/refresh.py`.
 *
 * Un enregistrement Hub = identité + type + champs réellement présents dans la source + relations + provenance
 * (URL, date de modification, date de collecte) + confiance + couverture. Les bundles de l'app en sont des vues
 * compactes : missions (embarquées), véhicules, catalogue, lieux (chargés à la demande).
 * Règles : une valeur absente reste absente (jamais de défaut inventé) ; une contradiction est conservée, pas
 * appliquée ; une seule source = confiance « moyenne » au mieux.
 */

export type HubType = "mission" | "stranger" | "activity" | "vehicle" | "weapon" | "character" | "property" | "place" | "map-feature" | "animal" | "radio" | "gang" | "random-event" | "cheat" | "guide";

export interface HubMission {
  id: string;
  name: string;
  kind: "main" | "side" | "stranger" | "activity";
  chapter?: number;
  /** Rang chronologique selon GTABase (affichage : jamais une preuve de prérequis). */
  number?: number;
  order?: number;
  jason?: boolean;
  lucia?: boolean;
  giver?: string[];
  money?: number;
  rewards?: Array<{ v: string; l: string }>;
  /** Missions citées comme préalables par la phrase « How To Unlock » (ids Hub). */
  after?: string[];
  /** La phrase dit « usually » : lien probable seulement. */
  weak?: boolean;
  unlockKnown?: boolean;
  afterAllMains?: number;
  /** Devient indisponible au lancement de cette mission (id Hub). */
  lostAt?: string;
  cond?: string[];
  optional?: boolean;
  missable?: boolean;
  pnr?: boolean;
  req100?: boolean;
  objectives?: string[];
  location?: string;
  url: string;
  mod?: string;
  leonida?: { progression?: string; story?: string; basis?: string };
  aliases?: string[];
}

/** Faits GTABase rattachés à un nœud du graphe (affichés, jamais substitués aux prérequis validés). */
export interface HubFacts {
  url: string;
  mod?: string;
  number?: number;
  giver?: string[];
  money?: number;
  rewards?: Array<{ v: string; l: string }>;
  objectives?: string[];
  req100?: boolean;
  missable?: boolean;
  pnr?: boolean;
  cond?: string[];
  protagonist?: "Jason" | "Lucia" | "les deux";
  /** Préalables selon GTABase quand ils diffèrent du graphe validé (contradiction conservée, non appliquée). */
  differs?: string[];
}

/** Véhicule GTABase (clés courtes : le fichier est chargé sur iPhone). */
export interface HubVehicle {
  id: string;
  n: string;
  c?: string;
  m?: string;
  e?: string;
  st?: string;
  sp?: string;
  set?: string;
  seats?: number;
  dt?: string;
  g?: number;
  kg?: number;
  sto?: number;
  b?: string;
  p?: number;
  reg?: number;
  sell?: number;
  tr?: string;
  cond?: string;
  how?: string;
  ed?: string;
  s?: { speed?: number; acceleration?: number; handling?: number; offroad?: number; strength?: number };
  r?: number;
  /** model = modèle de base · variant = variante (modèle de base indiqué) · unique = exemplaire nommé (propriétaire). */
  t?: "model" | "variant" | "unique";
  base?: string;
  vars?: string[];
  own?: string[];
  u: string;
  mod?: string;
  lk?: { rareVehicle?: string; knowledge?: string };
  alt?: boolean;
}

export interface HubCatalogItem {
  id: string;
  t: HubType;
  n: string;
  f?: Record<string, unknown>;
  rel?: Array<{ k: string; to: string | string[] }>;
  u: string;
  mod?: string;
  lk?: { knowledge?: string };
}

export interface HubPlaces {
  enrich: Record<string, { hub?: string[]; photo?: 1; flags?: string[] }>;
  unplaced: Array<{ id: string; n: string; d?: string; tags?: string[] }>;
  photosInGame: number;
}

export interface HubMeta {
  runAt: string;
  counts: Record<string, number>;
  gtabase: { status?: string; read?: number; failed?: number; discoveredAt?: string; latestModified?: string | null };
  gtadb: { status?: string; revision?: string; revisionDate?: string; upToDate?: boolean };
  missionIndex: number;
}
