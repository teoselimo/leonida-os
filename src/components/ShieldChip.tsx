"use client";

import { useStore } from "@/lib/store";
import { Icon } from "./ui/Icon";

/** Indicateur anti-spoiler, présent sur chaque écran. Toucher = basculer strict/modéré. */
export function ShieldChip() {
  const { state, setProfile } = useStore();
  const strict = state.profile.spoilerMode === "strict";
  return (
    <button
      className={`shield ${strict ? "is-strict" : ""}`}
      onClick={() => setProfile({ spoilerMode: strict ? "relaxed" : "strict" })}
      aria-label={`Anti-spoiler ${strict ? "strict" : "modéré"} — toucher pour changer`}
    >
      <Icon name="shieldCheck" size={16} />
      <span>{strict ? "Strict" : "Modéré"}</span>
    </button>
  );
}
