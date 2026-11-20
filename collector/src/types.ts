/**
 * Modèle de données du moteur de veille LEONIDA OS.
 * Les mêmes structures existent en tables SQL dans sql/001_schema.sql (cible Supabase).
 */

export type Reliability = "official" | "confirmed" | "reported" | "rumor" | "personal";

export type Category =
  | "weapon" | "vehicle" | "money" | "easter_egg" | "side_mission" | "unique_item"
  | "mechanic" | "missable" | "news" | "patch" | "guide" | "other";

/** État rédactionnel, distinct de la fiabilité : une info peut être fiable puis devenir périmée. */
export type ReviewStatus = "active" | "disputed" | "outdated" | "retracted";

export type ConnectorKind = "youtube-feed" | "youtube-api" | "rss" | "reddit" | "unsupported";

export interface SourceConfig {
  id: string;
  name: string;
  kind: ConnectorKind;
  /** Source émise par Rockstar elle-même. Seules ces sources peuvent produire « official ». */
  official: boolean;
  enabled: boolean;
  intervalMinutes: number;
  /** URL du flux ou de l'API (jamais de secret ici : les clés viennent des variables d'environnement). */
  url?: string;
  channelId?: string;
  queries?: string[];
  subreddits?: string[];
  /** Règles d'accès et d'usage retenues pour cette source. */
  access: string;
  /** Les contenus de cette source ne sont jamais envoyés à un modèle d'IA (ex. Rockstar, robots.txt). */
  noAI?: boolean;
  /** Langue principale. */
  lang: "en" | "fr";
  /** Confiance éditoriale de la source (n'implique jamais à elle seule « confirmed »). */
  trust: "official" | "high" | "medium" | "low";
}

/** Élément brut collecté : métadonnées + extrait court, jamais la page entière. */
export interface RawItem {
  key: string; // sourceId:externalId
  sourceId: string;
  externalId: string;
  url: string; // canonique
  title: string;
  excerpt: string; // ≤ 280 caractères
  publishedAt: string | null;
  fetchedAt: string;
  firstSeenAt: string;
  hash: string; // titre + extrait
  author: string | null;
  /** Identifiants de vidéos YouTube présents dans l'élément (sert à juger l'indépendance des preuves). */
  videoIds: string[];
  media: MediaRef | null;
  metrics?: { views?: number; likes?: number };
}

export interface MediaRef {
  kind: "youtube";
  videoId: string;
  url: string;
  thumbnail: string;
  credit: string;
  /** Base d'usage : affichage de la miniature hébergée par YouTube + lecteur intégré, jamais de copie. */
  rights: "youtube-terms";
}

export interface Evidence {
  rawKey: string;
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  official: boolean;
  /** Origine réelle de l'information : chaîne/domaine + vidéos citées. Deux preuves partageant une origine ne sont pas indépendantes. */
  origins: string[];
  /** Citations exactes tirées du texte collecté justifiant les champs extraits. */
  quotes: string[];
}

export interface Revision {
  at: string;
  reason: string;
  changes: string[];
}

export interface Location {
  regionId: string | null;
  place: string | null;
  /** none : rien d'établi · region/named-place : texte seulement · validated : point vérifié par un administrateur. */
  precision: "none" | "region" | "named-place" | "validated";
  x: number | null;
  y: number | null;
}

export interface Conditions {
  reward: string | null;
  money: number | null;
  requirement: string | null;
  missable: boolean | null;
  platform: string | null;
}

export interface RadarRecord {
  id: string;
  title: string;
  summary: string;
  category: Category;
  reliability: Reliability;
  status: ReviewStatus;
  reviewed: boolean;
  /** Raisons lisibles du classement (fiabilité, catégorie, spoiler…). */
  reasons: string[];
  spoiler: "low" | "high";
  actionable: boolean;
  location: Location;
  conditions: Conditions;
  evidence: Evidence[];
  media: MediaRef | null;
  firstSeenAt: string;
  updatedAt: string;
  publishedAt: string | null;
  lastVerifiedAt: string;
  revisions: Revision[];
  score: number;
  opportunity: { score: number; angle: "testé" | "vrai ou faux ?" | "actu"; ideas: string[] };
}

export interface RunLog {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  skipped?: string;
  fetched: number;
  newItems: number;
  updatedItems: number;
  errors: string[];
  attempts: number;
  quotaUsed?: number;
}

export interface SourceState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  etag?: string | null;
  quotaDay?: string;
  quotaUsed?: number;
  status: "ok" | "degraded" | "disabled" | "unsupported" | "never-run";
  statusDetail: string | null;
}

/** Corrections administrateur, éditables dans GitHub (collector/overrides.json) sans redéploiement. */
export interface Override {
  status?: ReviewStatus;
  reliability?: Reliability;
  location?: { regionId?: string; place?: string; x: number; y: number };
  note?: string;
}

/** Flux public lu par l'application. */
export interface RadarFeed {
  version: 1;
  generatedAt: string;
  sources: Array<{ id: string; name: string; kind: ConnectorKind; official: boolean; status: SourceState["status"]; statusDetail: string | null; lastSuccessAt: string | null; lastAttemptAt: string | null }>;
  lastRun: { at: string; newItems: number; updatedItems: number; errors: number } | null;
  items: RadarRecord[];
}
