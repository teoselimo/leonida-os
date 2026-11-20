"use client";

import { useMemo, useState } from "react";
import { alerts, progress, recommend } from "@/lib/engine";
import { CATEGORIES, CHAPTERS, CONSOLES } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { Icon } from "@/components/ui/Icon";
import { Bar, CategoryGlyph, DemoBadge, ProgressRing, SectionHead } from "@/components/ui/primitives";
import { RecoCard } from "@/components/RecoCard";
import { ShieldChip } from "@/components/ShieldChip";
import { LiveHighlights } from "@/components/LiveHighlights";

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

export function HomeScreen() {
  const { state, focusOnMap, setView, discoveries: all, signals } = useStore();
  const regions = repo.regions();
  const p = useMemo(() => progress(all, state), [all, state]);
  const recs = useMemo(() => recommend(all, state, new Date(), 8), [all, state]);
  const next = recs[0];
  const later = recs.slice(1);
  const [showAll, setShowAll] = useState(false);
  // Pas de doublon : une alerte qui pointe vers l'action principale est déjà couverte par « Que faire maintenant ? »
  const shown = new Set(recs.slice(0, 4).map((r) => r.discovery.id));
  const al = useMemo(() => alerts(all, signals, state).filter((a) => !a.discoveryId || !shown.has(a.discoveryId)).slice(0, 2), [all, signals, state, recs]); // eslint-disable-line react-hooks/exhaustive-deps
  const collectibles = p.byCategory.find((c) => c.id === "collectible")!;

  return (
    <div className="screen home">
      <header className="topbar">
        <div>
          <p className="eyebrow">{greeting()}, {state.profile.pseudo}</p>
          <h1 className="h1">Ta session <span className="grad">Leonida</span></h1>
        </div>
        <ShieldChip />
      </header>

      <div className="home__grid">
        <div className="home__col">
          {next ? (
            <button className="now" onClick={() => focusOnMap(next.discovery.id)} data-testid="next-discovery" aria-label={`Que faire maintenant : ${next.discovery.title}`}>
              <div className="now__glow" style={{ background: CATEGORIES[next.discovery.category].color }} />
              <div className="now__q">
                <span>Que faire maintenant ?</span>
                <DemoBadge provenance={next.discovery.provenance} />
              </div>
              <div className="now__main">
                <CategoryGlyph id={next.discovery.category} size={54} />
                <div>
                  <h2>{next.discovery.title}</h2>
                  <p>{CATEGORIES[next.discovery.category].label} · {regions.find((r) => r.id === next.discovery.regionId)!.name} · ~{next.discovery.durationMin} min</p>
                </div>
              </div>
              <div className="now__why"><Icon name="sparkle" size={16} /> {next.reasons[0]}</div>
              <span className="now__go">Y aller sur la carte <Icon name="arrow" size={17} /></span>
            </button>
          ) : (
            <div className="card empty">
              {all.length === 0 ? (
                <>
                  <p>Aucune découverte pour l&apos;instant.</p>
                  <button className="btn btn--sm btn--on" style={{ marginTop: 12 }} onClick={() => setView("carte")}><Icon name="flag" size={15} /> Ajouter mes premiers relevés</button>
                </>
              ) : (
                <>Tout ce qui est accessible est terminé. Avance dans l&apos;histoire pour débloquer la suite.</>
              )}
            </div>
          )}

          {later.length > 0 && (
            <section>
              <SectionHead title="Ensuite" action={<button className="link" onClick={() => setView("carte")}>Carte <Icon name="chevronRight" size={14} /></button>} />
              <div className="list" data-testid="reco-list">
                {(showAll ? later : later.slice(0, 3)).map((r, i) => <RecoCard key={r.discovery.id} rec={r} rank={i + 2} />)}
                {later.length > 3 && (
                  <button className="link morebtn" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Afficher moins" : `Voir les ${later.length - 3} autres`}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="home__col">
          <section className="card progline" aria-label="Progression">
            <ProgressRing value={p.pct} size={76} stroke={8}>
              <strong className="ring__pct" data-testid="progress-pct">{Math.round(p.pct * 100)}<small>%</small></strong>
            </ProgressRing>
            <div className="progline__stats">
              <div className="stat"><strong data-testid="progress-count">{p.done}<small>/{p.total}</small></strong><span>Découvertes</span></div>
              <div className="stat"><strong>{p.regionsVisited}<small>/{regions.length}</small></strong><span>Régions</span></div>
              <div className="stat"><strong>{collectibles.done}<small>/{collectibles.total}</small></strong><span>Collection</span></div>
            </div>
          </section>

          <LiveHighlights />

          {al.length > 0 && (
            <section>
              <SectionHead title="À ne pas manquer" />
              <div className="alerts">
                {al.map((a) => (
                  <button key={a.id} className={`alert alert--${a.level}`} onClick={() => (a.action === "radar" ? setView("radar") : a.discoveryId && focusOnMap(a.discoveryId))}>
                    <span className="alert__dot" />
                    <span className="alert__body">
                      <strong>{a.title}</strong>
                      <span>{a.body}</span>
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                ))}
              </div>
            </section>
          )}

          <details className="regionsbox">
            <summary>Progression par région <Icon name="chevronRight" size={16} /></summary>
            <div className="regions">
              {regions.map((r) => {
                const rp = p.byRegion[r.id] ?? { done: 0, total: 0 };
                return (
                  <div key={r.id} className="regionrow">
                    <span className="regionrow__name"><i style={{ background: r.hue }} />{r.name}</span>
                    <Bar value={rp.total ? rp.done / rp.total : 0} color={r.hue} />
                    <span className="regionrow__n">{rp.done}/{rp.total}</span>
                  </div>
                );
              })}
            </div>
          </details>
          <p className="fineprint"><Icon name="gamepad" size={12} /> {CONSOLES[state.profile.console]} · {CHAPTERS[state.profile.chapter]}</p>
        </div>
      </div>
    </div>
  );
}
