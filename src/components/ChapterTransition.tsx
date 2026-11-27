import { nk } from "@/lib/missions";
import { useStore } from "@/lib/store";

export function ChapterTransition() {
  const { state: { profile }, setProfile } = useStore();
  const completed = [...profile.missionsDone, profile.lastMission].map((m) => nk(m ?? ""));
  if (profile.chapter !== 1 || !completed.includes("discharge time")) return null;
  const clearCompleted = profile.nextMission && completed.includes(nk(profile.nextMission));
  return (
    <button className="btn" data-testid="confirm-chapter-two" onClick={() =>
      setProfile({ chapter: 2, ...(clearCompleted ? { nextMission: null, missionInProgress: false } : {}) })
    }>
      Mon jeu affiche le chapitre 2 · confirmer le passage
    </button>
  );
}
