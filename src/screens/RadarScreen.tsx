"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { statusOf, visibleSignal } from "@/lib/engine";
import { CATEGORIES, CHAPTERS, isReliable } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { timeAgo } from "@/lib/useMedia";
import { ShieldChip } from "@/components/ShieldChip";
import { LiveRadar } from "@/components/LiveRadar";
import { useLiveRadar } from "@/lib/live";
import { Icon } from "@/components/ui/Icon";
import { CategoryGlyph, DemoBadge, ReliabilityBadge, Segmented, SpoilerText } from "@/components/ui/primitives";

type Filter = "all" | "reliable" | "potential" | "tracked";

export function RadarScreen() {
  const { state, track, markSeen, focusOnMap, signals, discoveries: all } = useStore();
  const live = useLiveRadar();
  const [filter, setFilter] = useState<Filter>("all");
  const regions = repo.regions();

  // « Nouveau » = non vu à l'ouverture de l'écran ; marqué comme vu ensuite.
  const unseenAtOpen = useRef(new Set(signals.filter((g) => !state.seenSignals.includes(g.id)).map((g) => g.id)));
  useEffect(() => {
    const t = setTimeout(() => markSeen(signals.map((g) => g.id)), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    let l = signals.filter((g) => visibleSignal(g, state) !== "hidden");
    if (filter === "reliable") l = l.filter((g) => isReliable(g.reliability));
    if (filter === "potential") l = [...l].sort((a, b) => b.contentPotential - a.contentPotential).filter((g) => g.contentPotential >= 80);
    if (filter === "tracked") l = l.filter((g) => state.trackedSignals.includes(g.id));
    return l;
  }, [signals, state, filter]);

  const hiddenCount = signals.filter((g) => visibleSignal(g, state) === "hidden").length;
  const reliable = signals.filter((g) => isReliable(g.reliability) && visibleSignal(g, state) !== "hidden").length;

  return (
    <div className="screen radar">
      <header className="topbar">
        <div>
          <p className="eyebrow"><span className="live" /> Veille GTA VI</p>
          <h1 className="h1">Radar</h1>
        </div>
        <ShieldChip />
      </header>

      {live.feed ? (
        <LiveRadar />
      ) : (
        <>
          <div className="note" data-testid="demo-banner">
            <Icon name="info" size={16} />
            {live.state === "disabled" ? "Mode démonstration : cette version n'est pas reliée au flux de veille." : live.state === "loading" ? "Connexion au flux de veille…" : "Flux de veille injoignable : affichage des signaux de démonstration."}
          </div>
      <div className="radar__summary">
        <div className="stat"><strong>{signals.length - hiddenCount}</strong><span>Signaux</span></div>
        <div className="stat"><strong>{reliable}</strong><span>Fiables</span></div>
        <div className="stat"><strong>{state.trackedSignals.length}</strong><span>Suivis</span></div>
      </div>

      <Segmented<Filter>
        label="Filtrer les signaux"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "Tous" },
          { id: "reliable", label: "Fiables" },
          { id: "potential", label: "Potentiel" },
          { id: "tracked", label: "Suivis" },
        ]}
      />

      <div className="signals">
        {list.length === 0 && <div className="card empty">Aucun signal dans ce filtre.</div>}
        {list.map((g) => {
          const vis = visibleSignal(g, state);
          const region = regions.find((r) => r.id === g.regionId)!;
          const linked = g.discoveryId ? all.find((d) => d.id === g.discoveryId) : undefined;
          const linkedStatus = linked ? statusOf(linked, state) : undefined;
          const isTracked = state.trackedSignals.includes(g.id);
          const hint = `Spoiler · ${CHAPTERS[g.spoilerChapter]}`;
          return (
            <article key={g.id} className={`signal${unseenAtOpen.current.has(g.id) ? " is-new" : ""}`} data-testid={`signal-${g.id}`}>
              <div className="signal__top">
                <CategoryGlyph id={g.category} size={36} />
                <div className="signal__meta">
                  <span style={{ color: CATEGORIES[g.category].color }}>{CATEGORIES[g.category].label}</span>
                  <span className="dot" />
                  <span>{region.name}</span>
                  <span className="dot" />
                  <span>{timeAgo(g.reportedAt)}</span>
                </div>
                {unseenAtOpen.current.has(g.id) && <em className="newtag">Nouveau</em>}
              </div>
              <h3>{vis === "blurred" ? <SpoilerText strict={false} hint={hint}>{g.title}</SpoilerText> : g.title}</h3>
              {vis === "visible" && <p className="muted">{g.summary}</p>}

              <div className="signal__scores">
                <div>
                  <span className="lbl">Fiabilité</span>
                  <ReliabilityBadge r={g.reliability} />
                  <span className="sub">{g.confirmations} confirmation{g.confirmations > 1 ? "s" : ""}</span>
                </div>
                <div>
                  <span className="lbl">Potentiel contenu</span>
                  <span className="pot"><strong>{g.contentPotential}</strong>/100</span>
                  <span className="potbars">
                    <i title="Visuel" style={{ width: `${g.potentialBreakdown.visual}%` }} />
                    <i title="Rareté" style={{ width: `${g.potentialBreakdown.rarity}%` }} />
                    <i title="Tendance" style={{ width: `${g.potentialBreakdown.trend}%` }} />
                  </span>
                  <span className="sub">Visuel · Rareté · Tendance</span>
                </div>
              </div>

              <div className="signal__actions">
                <button className={`btn btn--sm ${isTracked ? "btn--on" : "btn--ghost"}`} onClick={() => track(g.id)} aria-pressed={isTracked}>
                  <Icon name="bookmark" size={15} /> {isTracked ? "Suivi" : "Suivre"}
                </button>
                {linked && linkedStatus !== "hidden" && (
                  <button className="btn btn--sm btn--ghost" onClick={() => focusOnMap(linked.id)}>
                    <Icon name="map" size={15} /> Voir sur la carte
                  </button>
                )}
                <DemoBadge provenance={g.provenance} />
              </div>
            </article>
          );
        })}
        {hiddenCount > 0 && (
          <div className="note">
            <Icon name="shield" size={16} /> {hiddenCount > 1 ? `${hiddenCount} signaux masqués` : "1 signal masqué"} par l&apos;anti-spoiler strict.
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
