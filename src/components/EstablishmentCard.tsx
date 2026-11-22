"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { EST_CATS, ESTABLISHMENTS } from "@/data/establishments";
import type { Landmark } from "@/lib/gtadb";
import { placementOf, PRECISION_FR } from "@/lib/places";
import { computeProgress } from "@/lib/progress";
import { Icon } from "./ui/Icon";

/**
 * Fiche d'un établissement confirmé (référentiel LEONIDA), visible même SANS position :
 * description, sources, précision de la position (point / zone probable / inconnue) et sa provenance.
 * « Je l'ai trouvé » : le joueur pose le point exact depuis la carte (observation en jeu, sauvegardée).
 */
export function EstablishmentCard({ id, landmarks, onClose, onPlace }: { id: string; landmarks: Landmark[]; onClose: () => void; onPlace: (id: string) => void }) {
  const { state, setPin, notify } = useStore();
  const e = ESTABLISHMENTS.find((x) => x.id === id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setConfirmRemove(false), [id]);
  if (!e) return null;
  const pl = placementOf(e, landmarks, state.pins ?? {});
  const pinned = !!state.pins?.[e.id];
  const unlockSt = e.unlock ? computeProgress(state).byId.get(e.unlock.node) : null;
  return (
    <div className="detail" data-testid="est-card" data-precision={pl.precision}>
      <div className="detail__top">
        <span className="glyph glyph--lm" style={{ color: "#7CF29A" }}><Icon name="check" size={18} /></span>
        <div className="detail__meta"><span className="lmsrc" style={{ color: "#7CF29A" }}>{e.cats.map((c) => EST_CATS[c].label).join(" · ")}</span></div>
        <button className="iconbtn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
      </div>
      <h3 className="detail__title">{e.name}</h3>
      <p className="muted">{e.district === "Mariana County" ? "Comté de Mariana (île non précisée)" : e.district}</p>
      <div className="estbox" data-testid="establishment">
        <p className="estbox__head"><Icon name="check" size={14} /> Établissement {e.verification}{e.kind ? ` · ${e.kind}` : ""}</p>
        {e.what && <p className="estbox__what">{e.what}</p>}
        {e.unlock && <p className="estbox__what">{unlockSt?.status === "terminé" || unlockSt?.likelyDone ? "Ouvert pour ta progression" : `S'ouvre ${e.unlock.text}`}</p>}
        <p className="estbox__src">
          Sources : {e.sources.slice(0, 4).map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
          ))}
        </p>
      </div>
      <div className={`precision precision--${pl.precision}`} data-testid="est-precision">
        <strong>{PRECISION_FR[pl.precision]}</strong>
        <span>{pl.provenance}</span>
      </div>
      <div className="row gap8 wrap">
        <button className="btn btn--sm" style={{ width: "auto" }} onClick={() => onPlace(e.id)} data-testid="est-place">
          <Icon name="flag" size={15} /> {pinned ? "Corriger ma position" : "Je l'ai trouvé : le placer"}
        </button>
        {pinned && (
          confirmRemove ? (
            <button className="btn btn--sm btn--danger" style={{ width: "auto" }} onClick={() => { setPin(e.id, null); notify("Position retirée", e.name, "flag"); setConfirmRemove(false); }} data-testid="est-unpin-confirm">Confirmer le retrait</button>
          ) : (
            <button className="btn btn--sm btn--ghost" style={{ width: "auto" }} onClick={() => setConfirmRemove(true)} data-testid="est-unpin">Retirer ma position</button>
          )
        )}
      </div>
      <p className="fineprint">Une position placée par toi est enregistrée dans ta sauvegarde avec sa date ; elle passe avant toute estimation.</p>
    </div>
  );
}
