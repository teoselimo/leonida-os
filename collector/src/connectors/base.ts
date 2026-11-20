import type { MediaRef, SourceConfig, SourceState } from "../types.ts";

/** Élément tel que renvoyé par un connecteur, avant normalisation. */
export interface CollectedItem {
  externalId: string;
  url: string;
  title: string;
  text: string; // texte disponible (description / extrait), tronqué ensuite
  publishedAt: string | null;
  author: string | null;
  videoIds: string[];
  media: MediaRef | null;
  metrics?: { views?: number; likes?: number };
  /** La source signale explicitement que l'élément a été supprimé (ex. Reddit). */
  deleted?: boolean;
}

export interface ConnectorContext {
  source: SourceConfig;
  state: SourceState;
  env: Record<string, string | undefined>;
  now: Date;
  fetchImpl?: typeof fetch;
}

export interface ConnectorResult {
  items: CollectedItem[];
  attempts: number;
  etag?: string | null;
  notModified?: boolean;
  quotaUsed?: number;
  /** État de quota à persister (ex. curseur de rotation des requêtes). */
  statePatch?: Partial<SourceState> & Record<string, unknown>;
}

/** Le connecteur ne peut pas tourner (clé absente, source non supportée, quota épuisé) : ce n'est pas une panne. */
export class ConnectorUnavailable extends Error {
  constructor(public reason: "missing-credentials" | "unsupported" | "quota" | "disabled", message: string) {
    super(message);
  }
}

export type Connector = (ctx: ConnectorContext) => Promise<ConnectorResult>;
