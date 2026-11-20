"use client";

import { repo, useStore } from "@/lib/store";
import { statusOf } from "@/lib/engine";
import { CC_BY_URL, GTADB_URL, tagFr } from "@/lib/gtadb";
import type { Landmark } from "@/lib/gtadb";
import { Icon } from "./ui/Icon";

/** Fiche d'un lieu de la carte communautaire gtadb.org. */
export function LandmarkCard({ lm, onClose }: { lm: Landmark; onClose: () => void }) {
  const { state, focusOnMap, discoveries } = useStore();
  const near = discoveries
    .filter((d) => statusOf(d, state) !== "hidden")
    .map((d) => ({ d, dist: Math.hypot(d.x - lm.x, d.y - lm.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  const tags = lm.tags.filter((t) => t !== "unconfirmed");
  return (
    <div className="detail" data-testid="landmark">
      <div className="detail__top">
        <span className="glyph glyph--lm"><Icon name="target" size={22} /></span>
        <div className="detail__meta"><span className="lmsrc">Lieu · carte communautaire</span></div>
        <button className="iconbtn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
      </div>
      <h3 className="detail__title">{lm.name}</h3>
      {lm.district && <p className="muted">{lm.district}</p>}
      <div className="row gap8 wrap">
        {lm.tags.includes("unconfirmed") && <span className="pill pill--locked"><Icon name="alert" size={13} /> Position non confirmée</span>}
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
            <em>{near.dist < 200 ? "sur place" : `à ~${Math.round(near.dist / 50) * 50} unités`} · DÉMO</em>
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
