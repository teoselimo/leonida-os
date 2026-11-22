"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { discoverNow, DISCOVER_CATS } from "@/lib/discover";
import type { DiscoverItem } from "@/lib/discover";
import { loadLandmarks } from "@/lib/gtadb";
import type { Landmark } from "@/lib/gtadb";
import { tick } from "@/lib/motion";
import { Icon } from "./ui/Icon";

const SHOWN = 4;
const STATUS_FR = { vérifié: "Vérifié", probable: "Probable", inconnu: "Inconnu" } as const;

/**
 * « À découvrir maintenant » (V0.13) — juste sous la mission principale : 3 à 5 suggestions calculées par le moteur
 * de progression, sans doublon avec « Rien à manquer », les objectifs et le reste de l'accueil (`exclude`).
 */
export function DiscoverNow({ exclude }: { exclude: Set<string> }) {
  const { state, setDone, showPlace, focusVehicle, openRecord, notify } = useStore();
  const { feed } = useLiveRadar();
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  useEffect(() => {
    loadLandmarks().then(setLandmarks);
  }, []);
  const byName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of landmarks) if (!/^\?|Lieu non identifié/.test(l.name)) m.set(l.name.toLowerCase().replace(/^the /, ""), l.id);
    return (n: string) => m.get(n.toLowerCase().replace(/^the /, "").trim()) ?? null;
  }, [landmarks]);
  const items = useMemo(() => discoverNow(feed, state, { exclude, landmarkByName: byName }), [feed, state, exclude, byName]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, SHOWN);

  const markDone = (it: DiscoverItem) => {
    tick();
    setDone(it.key, true);
    setAsk(null);
    setOpen(null);
    notify("Noté comme fait", `${it.name} · retiré des suggestions (date conservée)`, "check");
  };
  const toMap = (it: DiscoverItem) => {
    tick();
    if (it.map?.vehicleId) focusVehicle(it.map.vehicleId);
    else if (it.map?.landmarkId) showPlace({ landmarkId: it.map.landmarkId });
  };

  return (
    <section className="discover" data-testid="discover-now">
      <header className="discover__head">
        <h3>À découvrir maintenant</h3>
        {items.length > SHOWN && (
          <button className="link small" onClick={() => setAll((v) => !v)} data-testid="discover-all">
            {all ? "Réduire" : `Tout voir (${items.length})`}
          </button>
        )}
      </header>
      <ul className="discover__list">
        {shown.map((it) => {
          const c = DISCOVER_CATS[it.cat];
          const isOpen = open === it.key;
          return (
            <li key={it.key} className={`dsc${it.importance === "haute" ? " is-high" : ""}${isOpen ? " is-open" : ""}`} style={{ ["--c" as string]: c.color }} data-testid={`discover-${it.key}`} data-cat={it.cat} data-status={it.status}>
              <button className="dsc__main press" onClick={() => setOpen(isOpen ? null : it.key)} aria-expanded={isOpen}>
                <span className="dsc__ico" aria-hidden><Icon name={c.icon} size={15} /></span>
                <span className="dsc__body">
                  <strong>{it.name}</strong>
                  <em>
                    {c.label}
                    <i className={`dsc__st dsc__st--${it.status}`}>{STATUS_FR[it.status]}</i>
                    {it.sources.length > 0 && <i className="dsc__src">{it.sources.length} source{it.sources.length > 1 ? "s" : ""}</i>}
                  </em>
                  {it.noReturn && <span className="dsc__pnr"><Icon name="clock" size={12} /> {it.noReturn}</span>}
                </span>
                <Icon name="chevronRight" size={14} />
              </button>
              {isOpen && (
                <div className="dsc__detail" data-testid="discover-detail">
                  {it.detail.map((d, i) => <p key={i}>{d}</p>)}
                  {it.sources.length > 0 && (
                    <p className="dsc__links">
                      {it.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>)}
                    </p>
                  )}
                  <div className="row gap8 wrap">
                    {ask === it.key ? (
                      <span className="confirm" data-testid="discover-confirm">
                        <span>Marquer comme fait ?</span>
                        <button className="btn btn--primary btn--xs" onClick={() => markDone(it)} data-testid="discover-yes">Oui</button>
                        <button className="btn btn--ghost btn--xs" onClick={() => setAsk(null)}>Non</button>
                      </span>
                    ) : (
                      <button className="btn btn--xs btn--ghost press" onClick={() => setAsk(it.key)} data-testid="discover-done"><Icon name="check" size={13} /> Fait</button>
                    )}
                    {it.map && <button className="btn btn--xs btn--on press" onClick={() => toMap(it)} data-testid="discover-map"><Icon name="locate" size={13} /> Voir sur la carte</button>}
                    {it.recordId && !it.map && <button className="btn btn--xs btn--ghost press" onClick={() => openRecord(it.recordId!)}>Fiche</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
