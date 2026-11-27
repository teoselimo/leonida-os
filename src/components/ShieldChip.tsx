"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { SPOILER_HINT, SPOILER_STATE } from "@/lib/meta";
import { lowersProtection, SPOILER_ORDER } from "@/lib/spoiler";
import type { SpoilerMode } from "@/lib/types";
import { tick } from "@/lib/motion";
import { Icon } from "./ui/Icon";

const ICON: Record<SpoilerMode, "shieldCheck" | "eyeOff" | "eye"> = { strict: "shieldCheck", relaxed: "eyeOff", off: "eye" };

/**
 * Anti-spoiler (V0.14) : bouclier DISCRET. Un toucher ouvre un menu de choix ; il ne change jamais de niveau tout seul.
 * Toute réduction de protection demande une confirmation explicite, qui ne dévoile aucun contenu.
 */
export function ShieldChip({ inline = false }: { inline?: boolean }) {
  const { state, setProfile, notify } = useStore();
  const mode = state.profile.spoilerMode;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<SpoilerMode | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) (setOpen(false), setAsk(null));
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const apply = (m: SpoilerMode) => {
    tick();
    setProfile({ spoilerMode: m });
    notify(`Spoilers ${SPOILER_STATE[m].toLowerCase()}`, SPOILER_HINT[m]);
    setAsk(null);
    setOpen(false);
  };
  const choose = (m: SpoilerMode) => {
    if (m === mode) return setOpen(false);
    if (lowersProtection(mode, m)) return setAsk(m);
    apply(m);
  };
  return (
    <div className={`shieldwrap${inline ? " is-inline" : ""}`} ref={ref}>
      <button
        className={`shield shield--icon is-${mode} press`}
        onClick={() => (tick(), setOpen((v) => !v), setAsk(null))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Anti-spoiler : spoilers ${SPOILER_STATE[mode].toLowerCase()}. Toucher pour choisir.`}
        data-testid="shield"
        data-mode={mode}
      >
        <Icon name={ICON[mode]} size={17} />
      </button>
      {open && (
        <div className="shieldmenu" role="menu" data-testid="shield-menu">
          {ask ? (
            <div className="shieldmenu__ask" data-testid="shield-confirm">
              <strong>Réduire la protection ?</strong>
              <p>{ask === "off" ? "Tout sera affiché, révélations de l'histoire comprises." : "Des éléments de la suite pourront apparaître, floutés ou nommés."} Tu pourras revenir en arrière ici.</p>
              <div className="row gap8">
                <button className="btn btn--sm btn--ghost press" style={{ width: "auto" }} onClick={() => setAsk(null)} data-testid="shield-cancel">Annuler</button>
                <button className="btn btn--sm btn--primary press" style={{ width: "auto" }} onClick={() => apply(ask)} data-testid="shield-ok">Confirmer</button>
              </div>
            </div>
          ) : (
            <>
              <p className="shieldmenu__t">Spoilers</p>
              {SPOILER_ORDER.map((m) => (
                <button key={m} role="menuitemradio" aria-checked={m === mode} className={`shieldmenu__opt${m === mode ? " is-on" : ""}`} onClick={() => choose(m)} data-testid={`shield-${m}`}>
                  <Icon name={ICON[m]} size={16} />
                  <span><b>{SPOILER_STATE[m]}</b><em>{SPOILER_HINT[m]}</em></span>
                  {m === mode && <Icon name="check" size={15} />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
