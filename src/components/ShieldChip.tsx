"use client";

import { useStore } from "@/lib/store";
import { SPOILER_HINT, SPOILER_LABEL, SPOILER_NEXT, SPOILER_STATE } from "@/lib/meta";
import { tick } from "@/lib/motion";
import { Icon } from "./ui/Icon";

/**
 * Anti-spoiler (V0.11) : dit ce que le joueur VOIT (« Spoilers masqués / floutés / visibles ») plutôt qu'un nom de niveau.
 * Toucher = niveau suivant, confirmé par une notification. Couleur : vert masqués, violet floutés, ambre visibles.
 */
export function ShieldChip() {
  const { state, setProfile, notify } = useStore();
  const mode = state.profile.spoilerMode;
  const next = () => {
    tick();
    const n = SPOILER_NEXT[mode];
    setProfile({ spoilerMode: n });
    notify(`Spoilers ${SPOILER_STATE[n].toLowerCase()}`, SPOILER_HINT[n]);
  };
  return (
    <button className={`shield shield--${mode} press`} onClick={next} aria-label={`Anti-spoiler ${SPOILER_LABEL[mode].toLowerCase()} : spoilers ${SPOILER_STATE[mode].toLowerCase()}. Toucher pour changer.`} data-testid="shield" data-mode={mode}>
      <Icon name={mode === "off" ? "eye" : mode === "relaxed" ? "eyeOff" : "shieldCheck"} size={16} />
      <span className="shield__txt">
        <em>Spoilers</em>
        <b>{SPOILER_STATE[mode]}</b>
      </span>
    </button>
  );
}
