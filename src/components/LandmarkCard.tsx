"use client";

import { repo, useStore } from "@/lib/store";
import { statusOf } from "@/lib/engine";
import { CC_BY_URL, GTADB_URL, tagFr } from "@/lib/gtadb";
import type { Landmark } from "@/lib/gtadb";
import { Icon } from "./ui/Icon";
import { POI_CATS, POI_STATUS_FR, poiCategory, poiName, poiStatus } from "@/lib/poi";
import { EST_CATS, establishmentForLandmark } from "@/data/establishments";
import { computeProgress } from "@/lib/progress";

/** Fiche d'un lieu de la carte communautaire gtadb.org. */
export function LandmarkCard({ lm, onClose }: { lm: Landmark; onClose: () => void }) {
  const { state, focusOnMap, discoveries } = useStore();
  const near = discoveries
    .filter((d) => statusOf(d, state) !== "hidden")
    .map((d) => ({ d, dist: Math.hypot(d.x - lm.x, d.y - lm.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  const tags = lm.tags.filter((t) => t !== "unconfirmed");
  const cat = POI_CATS[poiCategory(lm)];
  const status = poiStatus(lm);
  // Établissement confirmé (référentiel LEONIDA, distinct de gtadb) rattaché à ce repère par son nom
  const est = establishmentForLandmark(lm.id);
  const unlockSt = est?.unlock ? computeProgress(state).byId.get(est.unlock.node) : null;
  return (
    <div className="detail" data-testid="landmark">
      <div className="detail__top">
        <span className="glyph glyph--lm" style={{ color: cat.color }}><b style={{ fontSize: 20 }}>{cat.glyph}</b></span>
        <div className="detail__meta"><span className="lmsrc" style={{ color: cat.color }}>{cat.label}</span></div>
        <button className="iconbtn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
      </div>
      <h3 className="detail__title">{poiName(lm)}</h3>
      {lm.district && <p className="muted">{lm.district}</p>}
      {est ? (
        <div className="estbox" data-testid="establishment">
          <p className="estbox__head"><Icon name="check" size={14} /> Établissement {est.verification} · {est.cats.map((c) => EST_CATS[c].label).join(", ")}</p>
          {est.what && <p className="estbox__what">{est.what}</p>}
          {est.unlock && <p className="estbox__what">{unlockSt?.status === "terminé" || unlockSt?.likelyDone ? "Ouvert pour ta progression" : `S'ouvre ${est.unlock.text}`}</p>}
          <p className="estbox__src">
            Sources : {est.sources.slice(0, 3).map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
            ))}
          </p>
          <p className="estbox__pos">Position : repère de la carte communautaire gtadb (nom identique), non vérifiée en jeu.</p>
        </div>
      ) : (
        <p className={`lmstatus lmstatus--${status}`} data-testid="poi-status"><Icon name={status === "uncertain" ? "alert" : "info"} size={13} /> {POI_STATUS_FR[status]}</p>
      )}
      <div className="row gap8 wrap">
        {tags.map((t) => <span key={t} className="tagchip">{tagFr(t)}</span>)}
      </div>
      {lm.real && (
        <div className="block">
          <h4>Équivalent réel (Floride)</h4>
          <p className="irl"><Icon name="map" size={16} /> {lm.real}</p>
        </div>
      )}
      {near && near.dist < 1500 && (
        <div className="block">
          <h4>À proximité</h4>
          <button className="nearbtn" onClick={() => focusOnMap(near.d.id)}>
            <span>{near.d.title}</span>
            <em>{near.dist < 200 ? "sur place" : `à ~${Math.round(near.dist / 50) * 50} unités`}{near.d.provenance?.kind === "live" ? "" : " · DÉMO"}</em>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}
      <p className="fineprint">
        Données : <a href={GTADB_URL} target="_blank" rel="noreferrer">GTA VI Landmarks Data</a> (<a href={CC_BY_URL} target="_blank" rel="noreferrer">CC BY 4.0</a>) — reconstitution communautaire, pas la carte officielle de Rockstar.
      </p>
    </div>
  );
}
