import { LlmError } from "../types";
import type { LlmRequest, LlmResult, LlmTransport } from "../types";

/**
 * Transport « Claude dans un Artifact » : appelle Claude avec le compte du joueur (capacité `sample`,
 * contrat d'exécution des Artifacts). Aucune clé API, aucune facturation API : l'usage est décompté
 * de l'abonnement Claude du joueur, qui donne son accord au premier appel.
 *
 * C'est le SEUL fichier qui connaît `window.claude`. Hors d'un Artifact (GitHub Pages), il se déclare indisponible.
 */
type SampleFn = ((input: unknown, opts?: unknown) => Promise<{ text: string; truncated: boolean; modelTierApplied?: string; modelApplied?: string }>) | null;

let samplePromise: Promise<SampleFn> | null = null;
function getSample(): Promise<SampleFn> {
  if (samplePromise) return samplePromise;
  const c = typeof window !== "undefined" ? (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude : undefined;
  samplePromise = c?.use ? (c.use("sample") as Promise<SampleFn>).catch(() => null) : Promise.resolve(null);
  return samplePromise;
}

export const claudeArtifactTransport: LlmTransport = {
  id: "claude-artifact",
  label: "Claude · via ton compte",
  async available() {
    return !!(await getSample());
  },
  async generate(req: LlmRequest): Promise<LlmResult> {
    const sample = await getSample();
    if (!sample) throw new LlmError("unavailable");
    try {
      const r = await sample(req.messages, {
        cache: false, // une conversation doit toujours produire une nouvelle réponse
        modelTier: req.tier ?? "quick",
        signal: req.signal,
        onText: ({ text }: { text: string }) => req.onText?.(text),
      });
      return { text: r.text, truncated: r.truncated, model: r.modelApplied ?? (r.modelTierApplied ? `Claude (${r.modelTierApplied === "quick" ? "rapide" : r.modelTierApplied === "complex" ? "avancé" : "standard"})` : "Claude") };
    } catch (e) {
      const err = e as { code?: string; message?: string; text?: string };
      throw new LlmError(err?.code ?? "upstream_error", err?.message, err?.text);
    }
  },
};
