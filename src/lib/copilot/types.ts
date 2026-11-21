/**
 * LEONIDA AI — couche copilote portable.
 *
 * Séparation (issue #10) :
 *   1. interface (React, design system)            → src/components/AiCopilot.tsx
 *   2. profil et historique du joueur              → src/lib/store.tsx (+ synchronisation privée, src/lib/runtime/)
 *   3. recherche dans les connaissances GTA VI     → src/lib/ai/engine.ts (retrieval-first), missions.ts, poi.ts, fr.ts
 *   4. logique conversationnelle et actions        → src/lib/copilot/engine.ts, prompt.ts, context.ts
 *   5. fournisseur LLM (transport)                 → src/lib/copilot/transports/*
 *
 * Rien dans 1 à 4 ne dépend de l'environnement Artifact : seul `transports/claudeArtifact.ts` connaît `window.claude`.
 * Migrer vers l'API Claude = activer `transports/claudeApi.ts` + le backend sécurisé, sans toucher au reste.
 */
import type { AiAction, Reliab, Source, Topic } from "../ai/engine";

export type { AiAction, Source, Topic };
export type Trust = Reliab;

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  /** Conversation complète, commençant et finissant par un tour « user » (les consignes sont le premier tour). */
  messages: LlmMessage[];
  /** Texte complet reçu jusqu'ici (streaming). */
  onText?: (text: string) => void;
  signal?: AbortSignal;
  /** « quick » : réponse quasi immédiate ; « default » : plus réfléchie, plus lente. */
  tier?: "quick" | "default";
  /** Recherche web facultative, autorisée et plafonnée côté Worker. */
  web?: boolean;
}

export interface LlmResult {
  text: string;
  /** Modèle ou gamme qui a réellement répondu (preuve que la réponse vient de Claude). */
  model?: string;
  truncated?: boolean;
  /** URLs renvoyées par les annotations OpenAI, jamais par le modèle seul. */
  webSources?: { url: string; title: string }[];
}

/** Erreur de transport normalisée (codes du fournisseur conservés). */
export class LlmError extends Error {
  constructor(
    public code: string,
    message = code,
    public partial?: string,
  ) {
    super(message);
  }
}

export interface LlmTransport {
  id: "claude-artifact" | "claude-api" | "openai-api";
  /** Libellé montré au joueur (« Claude · via ton compte »). */
  label: string;
  /** Vrai seulement si un appel peut réellement aboutir dans cet environnement. */
  available(): Promise<boolean>;
  generate(req: LlmRequest): Promise<LlmResult>;
}

/** Réponse du copilote, identique quel que soit le moteur. */
export interface CopilotAnswer {
  intent: string;
  message: string;
  trust: Trust | null;
  sources: Source[];
  actions: AiAction[];
  topic: Topic | null;
  replies?: string[];
  more?: string[];
  /** « claude » : rédigé par Claude ; « direct » : moteur déterministe (sans IA générative). */
  engine: "claude" | "gpt" | "direct";
  model?: string;
  /** Remarque d'honnêteté (repli, limite atteinte, réponse écartée). */
  note?: string;
  evidence?: string[];
}
