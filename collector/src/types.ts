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

export type ConnectorKind = "youtube-feed" | "youtube-api" | "rss" | "reddit" | "sitemap" | "unsupported";

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
  /** Sitemap : motif des URL retenues, nombre de sous-sitemaps récents suivis, plafond d'URL par passage. */
  urlFilter?: string;
  followChildren?: number;
  maxItems?: number;
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
  /** Lecture approfondie de l'article (si robots.txt l'autorise) : faits extraits, jamais le texte complet. */
  deep?: DeepRead;
}

export interface FactRef<T> {
  value: T;
  quote: string;
  url: string;
}

export interface DeepRead {
  /** Version des règles d'extraction : une amélioration des règles relance la lecture des articles concernés. */
  v?: number;
  /** Relecture échouée : faits précédents conservés, nouvel essai après cette date. */
  retryAfter?: string;
  at: string;
  ok: boolean;
  reason: string | null;
  /** Le site refuse les robots d'IA : aucune analyse par modèle sur ce contenu. */
  aiOptOut: boolean;
  method: "rules" | "rules+ai";
  facts: {
    chapter: FactRef<number> | null;
    money: FactRef<{ amount: number; max: number | null; approx: boolean }> | null;
    mission: FactRef<string> | null;
    giver: FactRef<string> | null;
    unlockAfter: FactRef<string> | null;
    place: FactRef<{ name: string; district: string | null; regionId: string | null }> | null;
    missable: FactRef<boolean> | null;
    contextMissable: FactRef<{ subject: string | null; until: string | null }> | null;
    handsOn: FactRef<boolean> | null;
    keywords: string[];
  } | null;
  videoIds: string[];
  /** Véhicules, garages et règles de conservation extraits (V0.6). */
  vehicles?: VehicleMention[];
  mechanics?: Mechanics;
  /** Sites cités par l'article comme sa propre source : ils ne comptent pas comme confirmation indépendante. */
  cites?: string[];
}

/** Un champ consolidé d'une fiche, avec toutes les sources qui l'appuient (jamais de valeur sans citation). */
export interface DetailField<T> {
  value: T;
  support: Array<{ sourceName: string; url: string; quote: string }>;
  /** Sources qui contredisent la valeur retenue. */
  conflicts: Array<{ sourceName: string; url: string; quote: string }>;
}

export interface RecordDetails {
  chapter: DetailField<number> | null;
  money: DetailField<{ min: number; max: number | null; approx: boolean }> | null;
  mission: DetailField<string> | null;
  giver: DetailField<string> | null;
  unlockAfter: DetailField<string> | null;
  place: DetailField<{ name: string; district: string | null }> | null;
  missable: DetailField<boolean> | null;
  contextMissable: DetailField<{ subject: string | null; until: string | null }> | null;
  handsOn: boolean;
  /** Champs demandés par le format de fiche mais introuvables dans les sources : laissés vides. */
  missing: string[];
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
  /** Point proposé (repère exact de la carte communautaire) en attente de validation : jamais affiché comme épingle. */
  suggestion?: { x: number; y: number; landmark: string } | null;
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
  /** Fiche structurée issue de la lecture des guides (V0.5.1). */
  details?: RecordDetails | null;
  /** Conseil prêt à afficher dans « Que faire maintenant ? » si la fiche est exploitable. */
  advice?: { text: string; chapterMin: number | null; urgency: "now" | "soon" | "anytime" } | null;
  /** Capture personnelle validée par l'administrateur (droits détenus). */
  capture?: { src: string; credit: string; alt?: string } | null;
  /** Identifiants de fiches fusionnées dans celle-ci (même découverte décrite par plusieurs sources). */
  mergedFrom?: string[];
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
  /** Capture de gameplay personnelle (fichier dans public/gameplay/), affichée à la place de la miniature. */
  capture?: { src: string; credit: string; alt?: string };
}

/** Un passage complet du collecteur (toutes sources dues), pour prouver la régularité du cron. */
export interface CycleLog {
  at: string;
  /** schedule (cron GitHub), workflow_dispatch, push, local… */
  trigger: string;
  runId: string | null;
  sourcesAttempted: number;
  sourcesOk: number;
  newItems: number;
  updatedItems: number;
  deepReads: number;
  merged: number;
  vehicles?: number;
}

export interface RadarFeed {
  version: 1;
  generatedAt: string;
  /** Santé du collecteur : cadence attendue et derniers cycles (pour détecter un arrêt). */
  health?: { cadenceMinutes: number; cycles: CycleLog[] };
  /** Garage des légendes : véhicules et garages consolidés (V0.6). */
  vehicles?: VehicleRecord[];
  sources: Array<{ id: string; name: string; kind: ConnectorKind; official: boolean; status: SourceState["status"]; statusDetail: string | null; lastSuccessAt: string | null; lastAttemptAt: string | null }>;
  lastRun: { at: string; newItems: number; updatedItems: number; errors: number } | null;
  items: RadarRecord[];
}

// ── Garage des légendes (V0.6) ────────────────────────────────────────────────
export interface SourceRef {
  sourceName: string;
  url: string;
  quote: string;
}

export interface VField<T> {
  value: T;
  support: SourceRef[];
  conflicts: SourceRef[];
}

/** Fiche automobile consolidée à partir de toutes les sources (jamais saisie à la main). */
export interface VehicleRecord {
  id: string;
  type: "vehicle" | "garage";
  name: string;
  make: string;
  model: string;
  year: string | null;
  /** Voiture réelle dont le modèle s'inspire, selon les sources (alias appris). */
  aliases: VField<string[]> | null;
  /** hidden : garé à un endroit fixe · dynamic : apparition aléatoire · mission · delivery : remis au joueur (bonus) · news : pas d'emplacement */
  kind: "hidden" | "dynamic" | "mission" | "delivery" | "news";
  variant: VField<string> | null;
  edition: { exclusive: "ultimate" | "preorder" | null; status: "confirmed" | "reported" | "none"; support: SourceRef[] };
  location: {
    text: VField<string> | null;
    district: string | null;
    regionId: string | null;
    /** exact : point validé · zone : zone de recherche dérivée du quartier · text : adresse seulement · none */
    precision: "exact" | "zone" | "text" | "none";
    zone: { x: number; y: number; radius: number; widened: boolean } | null;
    point: { x: number; y: number } | null;
    alternatives: Array<{ district: string | null; text: string; sourceName: string; url: string }>;
  };
  access: {
    chapterMin: VField<number> | null;
    /** Chapitre déduit d'une règle générale (ex. cloneur de clé au chapitre 3), avec sa source. */
    inferredChapter: { value: number; why: string; source: SourceRef } | null;
    until: VField<number> | null;
    mission: VField<string> | null;
    early: boolean;
    keyCloner: VField<boolean> | null;
    tracker: VField<"none" | "standard" | "advanced"> | null;
    alarm: VField<boolean> | null;
  };
  keep: {
    text: VField<string> | null;
    /** Règle générale d'immatriculation applicable, avec sa source. */
    rule: { chapter: number; where: string | null; tracker: string | null; source: SourceRef } | null;
    /** yes : conservé d'office (bonus) · register : à immatriculer · unknown */
    mode: "yes" | "register" | "unknown";
  };
  steps: SourceRef[];
  risks: SourceRef[];
  price: VField<number> | null;
  media: MediaRef | null;
  evidence: Array<{ sourceName: string; url: string; title: string; official: boolean; readAt: string | null }>;
  reliability: Reliability;
  reasons: string[];
  missing: string[];
  firstSeenAt: string;
  updatedAt: string;
  revisions: Revision[];
}

// ── Extraction automobile (faits par article) ─────────────────────────────────
export interface VFact<T> {
  value: T;
  quote: string;
  url: string;
}

export interface VehicleMention {
  /** Nom tel qu'écrit par la source (« Maibatsu '97 Penumbra FF »). */
  name: string;
  make: string;
  model: string;
  year: string | null;
  /** Clé canonique : marque + modèle, sans l'année (« maibatsu-penumbra-ff »). */
  key: string;
  type: "vehicle" | "garage";
  variant: VFact<string> | null;
  location: VFact<{ text: string; district: string | null; relative: boolean }> | null;
  spawn: VFact<"fixed" | "dynamic" | "mission" | "delivery"> | null;
  edition: VFact<"ultimate" | "preorder"> | null;
  chapter: VFact<number> | null;
  mission: VFact<string> | null;
  early: VFact<boolean> | null;
  keyCloner: VFact<boolean> | null;
  tracker: VFact<"none" | "standard" | "advanced"> | null;
  alarm: VFact<boolean> | null;
  keep: VFact<string> | null;
  price: VFact<number> | null;
  steps: VFact<string>[];
  risks: VFact<string>[];
  /** Disponible seulement jusqu'à ce chapitre inclus (« only available in Chapter 1 »). */
  until: VFact<number> | null;
  /** Voitures réelles associées par la même source (alias), avec la phrase qui les lie. */
  aliases?: VFact<string[]> | null;
  /** Mention non résolue : l'article ne cite qu'une voiture réelle (« Mitsubishi Eclipse »). */
  unresolved?: boolean;
}

export interface Mechanics {
  /** Immatriculation d'un véhicule volé (chapitre, lieu, condition sur le traqueur). */
  register: Array<VFact<{ chapter: number; where: string | null; tracker: "none" | "standard" | "advanced" | null }>>;
  /** Obtention du cloneur de clé. */
  keyCloner: VFact<{ chapter: number | null; mission: string | null }> | null;
  /** Achat de garages supplémentaires. */
  garages: VFact<{ chapter: number | null; how: string }> | null;
}

export interface VehicleFacts {
  vehicles: VehicleMention[];
  mechanics: Mechanics;
}

