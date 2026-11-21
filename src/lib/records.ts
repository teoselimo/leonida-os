import { CATEGORY_ORDER } from "./meta";
import type { Chapter, Discovery, Prerequisite } from "./types";

/**
 * Normalise tout relevé personnel (création, import, données anciennes).
 * Règle de sécurité : un relevé du joueur garde TOUJOURS la provenance « player »
 * et la fiabilité « personal », quelle que soit la donnée reçue. Il ne peut
 * devenir « confirmé » que par un futur processus de vérification explicite.
 */
export const PERSONAL_SOURCE = { label: "Mon relevé", reliability: "personal" as const };

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export function asPlayerRecord(input: Partial<Discovery> & { id: string; title: string; x: number; y: number }, now = new Date()): Discovery {
  const createdAt =
    input.provenance && input.provenance.kind === "player" && !Number.isNaN(Date.parse(input.provenance.createdAt))
      ? input.provenance.createdAt
      : now.toISOString();
  const chapter = clamp(Math.round(Number(input.spoilerChapter) || 0), 0, 6) as Chapter;
  const prerequisites: Prerequisite[] = Array.isArray(input.prerequisites)
    ? input.prerequisites.filter(
        (p): p is Prerequisite =>
          !!p && ((p.type === "discovery" && typeof p.id === "string") || (p.type === "chapter" && [1, 2, 3, 4, 5, 6].includes(p.min))),
      )
    : [];
  return {
    id: String(input.id),
    title: String(input.title).slice(0, 60),
    category: input.category && CATEGORY_ORDER.includes(input.category) ? input.category : "collectible",
    regionId: typeof input.regionId === "string" ? input.regionId : "vicecity",
    x: Number(input.x),
    y: Number(input.y),
    summary: String(input.summary ?? "Relevé personnel.").slice(0, 280),
    prerequisites,
    reward: String(input.reward ?? "—").slice(0, 80),
    durationMin: clamp(Math.round(Number(input.durationMin) || 10), 1, 240),
    difficulty: clamp(Math.round(Number(input.difficulty) || 1), 1, 3) as 1 | 2 | 3,
    spoilerChapter: chapter,
    contentPotential: clamp(Math.round(Number(input.contentPotential) || 50), 0, 100),
    source: { ...PERSONAL_SOURCE },
    provenance: { kind: "player", createdAt },
  };
}

export function isValidRecordInput(d: unknown): d is { id: string; title: string; x: number; y: number } {
  const o = d as Record<string, unknown> | null;
  return !!o && typeof o.id === "string" && typeof o.title === "string" && o.title.trim().length > 0 && Number.isFinite(o.x) && Number.isFinite(o.y);
}
