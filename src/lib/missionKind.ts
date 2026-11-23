import { STORY_NODES } from "@/data/story";
import { nodeByName } from "./progress";
import { nk } from "./missions";

/**
 * V0.19 · Classification UNIQUE d'un nom saisi : mission principale, mission secondaire, activité libre ou lieu.
 * Sources : graphe du chapitre 1 (progression) puis inventaire Story Intelligence (chapitres 2 à 5).
 * null = nom inconnu (le joueur peut toujours saisir une mission que LEONIDA ne connaît pas).
 */
export type MissionKind = "main" | "side" | "activity" | "place";

const key = (s: string) => nk(s).replace(/['!.]/g, "").trim();

export function missionKind(name: string | null | undefined): MissionKind | null {
  if (!name) return null;
  const g = nodeByName(name);
  if (g) return g.kind;
  const k = key(name);
  if (!k) return null;
  const n = STORY_NODES.find((x) => key(x.name) === k || (x.aliases ?? []).some((a) => key(a) === k));
  return n ? n.kind : null;
}

/** Une activité libre ou un lieu ne sont jamais une mission envisagée ou commencée. */
export const notAMission = (name: string | null | undefined) => {
  const k = missionKind(name);
  return k === "activity" || k === "place";
};
