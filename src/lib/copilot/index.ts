import { claudeArtifactTransport } from "./transports/claudeArtifact";
import { claudeApiTransport } from "./transports/claudeApi";
import type { LlmTransport } from "./types";

export * from "./types";
export { askCopilot, fromDirect, parseReply, visiblePart } from "./engine";
export { PROMPT_VERSION } from "./prompt";

/**
 * Choix du moteur, sans reconstruire l'app : Claude dans l'Artifact si disponible, sinon l'API (si activée),
 * sinon aucun → mode direct (moteur déterministe, annoncé comme tel).
 */
export async function pickTransport(candidates: LlmTransport[] = [claudeArtifactTransport, claudeApiTransport]): Promise<LlmTransport | null> {
  for (const t of candidates) if (await t.available().catch(() => false)) return t;
  return null;
}
