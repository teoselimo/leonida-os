"use client";

import { useStore } from "@/lib/store";
import { SPOILER_LABEL, SPOILER_NEXT } from "@/lib/meta";
import { Icon } from "./ui/Icon";

/** Indicateur anti-spoiler, présent sur chaque écran. Toucher = niveau suivant (complet → léger → aucun). */
export function ShieldChip() {
  const { state, setProfile } = useStore();
  const mode = state.profile.spoilerMode;
  return (
    <button
      className={`shield ${mode === "strict" ? "is-strict" : mode === "off" ? "is-off" : ""}`}
      onClick={() => setProfile({ spoilerMode: SPOILER_NEXT[mode] })}
      aria-label={`Anti-spoiler ${SPOILER_LABEL[mode].toLowerCase()} — toucher pour changer`}
      data-testid="shield"
      data-mode={mode}
    >
      <Icon name="shieldCheck" size={16} />
      <span>{SPOILER_LABEL[mode]}</span>
    </button>
  );
}
