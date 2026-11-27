import type { AiContext } from "../ai/engine";
import { nk } from "../missions";
import type { MissionAlertBrief } from "../types";
import { askCopilot } from "./engine";
import type { LlmTransport, WebSearchFn } from "./types";

/** Clé d'une analyse : nom de mission normalisé (une analyse par mission, jamais mélangées). */
export const briefKey = (mission: string) => nk(mission).replace(/'/g, "");

/** Une analyse de plus de 12 h est relancée à la demande : les guides web évoluent vite après une sortie. */
export const BRIEF_TTL_MS = 12 * 3600_000;

/**
 * Analyse « Rien à manquer » d'une mission, hors conversation : preuves LEONIDA RADAR + web (si disponible),
 * rédigée par Claude, validée par l'app (sources réelles, statut calculé). Portable : aucun accès à l'Artifact ici.
 */
export async function runMissionBrief(o: { mission: string; ctx: AiContext; transport: LlmTransport | null; search: WebSearchFn | null; signal?: AbortSignal; onStage?: (s: "search" | "write") => void }): Promise<MissionAlertBrief> {
  const c = await askCopilot({
    question: `Rien à manquer dans ${o.mission} ?`,
    ctx: o.ctx,
    topic: null,
    history: [],
    transport: o.transport,
    mode: "checklist",
    mission: o.mission,
    search: o.search,
    signal: o.signal,
    onStage: o.onStage,
  });
  return {
    mission: o.mission,
    at: new Date().toISOString(),
    summary: c.message.slice(0, 1_500),
    items: c.brief ?? [],
    web: c.web ?? null,
    engine: c.engine,
    model: c.model,
  };
}
