"use client";

import { useMemo, useState } from "react";
import { alerts, progress, recommend } from "@/lib/engine";
import { CATEGORIES, CHAPTERS, CONSOLES, EDITIONS } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { nowPicks } from "@/lib/now";
import type { NowPick } from "@/lib/now";
import { starters } from "@/lib/ai/engine";
import { tick } from "@/lib/motion";
import { Icon } from "@/components/ui/Icon";
import { CategoryGlyph, DemoBadge, ProgressRing, ReliabilityBadge, SectionHead } from "@/components/ui/primitives";
import { Visual } from "@/components/ui/Visual";
import { RecoCard } from "@/components/RecoCard";
import { ShieldChip } from "@/components/ShieldChip";
import { LiveHighlights } from "@/components/LiveHighlights";
import { CollectorAlert } from "@/components/LiveRadar";
import { BrandMark } from "@/components/Brand";

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

/** Grande carte éditoriale : visuel, gain, accessibilité, une action principale. */
function HeroPick({ p, onGo, onDone }: { p: NowPick; onGo: () => void; onDone?: () => void }) {
  return (
    <article className={`feat press${p.urgent ? " is-urgent" : ""}`} data-testid={p.vehicleId ? `car-advice-${p.vehicleId}` : `advice-${p.recordId}`}>
      <button className="feat__media" onClick={onGo} aria-label={`Ouvrir ${p.title}`}>
        <Visual media={p.media} icon={p.icon} color={p.color} label={p.title} />
        <span className="feat__badges">
          {p.urgent && <span className="pill pill--warn">À ne pas manquer</span>}
          {p.ultimate && <span className="edtag">ULTIMATE</span>}
        </span>
      </button>
      <div className="feat__body">
        <div className="row gap8 wrap">
          <ReliabilityBadge r={p.reliability} />
          <span className="small muted">{p.access}</span>
        </div>
        <h2>{p.kind === "vehicle" ? `🚗 ${p.title}` : p.title}</h2>
        <p>{p.text}</p>
        <div className="feat__actions">
          <button className="btn btn--primary btn--sm" onClick={onGo} data-testid="hero-go">
            <Icon name={p.kind === "vehicle" ? "locate" : "arrow"} size={16} /> {p.kind === "vehicle" ? "Me guider" : "Voir la fiche"}
          </button>
          {onDone && <button className="btn btn--ghost btn--sm" onClick={onDone} data-testid="advice-done">C&apos;est fait</button>}
        </div>
      </div>
    </article>
  );
}

function CompactPick({ p, onGo, i }: { p: NowPick; onGo: () => void; i: number }) {
  return (
    <button className="compact press" onClick={onGo} style={{ ["--i" as string]: i }} data-testid={p.vehicleId ? `car-advice-${p.vehicleId}` : `advice-${p.recordId}`}>
      <Visual media={p.media} icon={p.icon} color={p.color} size="thumb" />
      <span className="compact__body">
        <strong>{p.kind === "vehicle" ? `🚗 ${p.title}` : p.title}</strong>
        <em>
          {p.ultimate && <b className="edtag edtag--mini">ULTIMATE</b>}
          {p.urgent ? <span className="is-warn">{p.access}</span> : p.access}
          {p.where ? ` · ${p.where}` : ""}
        </em>
      </span>
      <Icon name="chevronRight" size={16} />
    </button>
  );
}

export function HomeScreen() {
  const { state, focusOnMap, setView, discoveries: all, signals, focusVehicle, openRecord, setDone, setAiOpen, celebrate } = useStore();
  const { feed } = useLiveRadar();
  const regions = repo.regions();
  const picks = useMemo(() => nowPicks(feed, state, 4), [feed, state]);
  const [hero, ...rest] = picks;
  const go = (p: NowPick) => {
    tick();
    if (p.vehicleId) focusVehicle(p.vehicleId);
    else if (p.recordId) openRecord(p.recordId);
  };
  const owned = Object.values(state.vehicles).filter((v) => v.state !== "spotted").length;
  const doneCount = Object.keys(state.done).length;
  const p = state.profile;
  const ask = (q: string) => {
    tick();
    window.dispatchEvent(new CustomEvent("leonida:ask", { detail: q }));
    setAiOpen(true);
  };

  return (
    <div className="screen home">
      <header className="topbar">
        <div>
          <p className="eyebrow"><BrandMark size={18} /> {greeting()}{p.pseudo && p.pseudo !== "Joueur" ? `, ${p.pseudo}` : ""}</p>
          <h1 className="h1">Ta session <span className="grad">Leonida</span></h1>
        </div>
        <ShieldChip />
      </header>

      <button className="ctxbar press" onClick={() => setView("profil")} data-testid="context-bar">
        <span>{CHAPTERS[p.chapter]}</span>
        <i />
        <span>{EDITIONS[p.edition] === "Je ne sais pas" ? "Édition ?" : EDITIONS[p.edition]}</span>
        <i />
        <span>{CONSOLES[p.console]}</span>
        {p.lastMission && <><i /><span className="ctxbar__mission">Dernière mission : {p.lastMission}</span></>}
        <Icon name="chevronRight" size={14} />
      </button>

      <CollectorAlert />

      <div className="home__grid">
        <div className="home__col">
          <section className="nowsec" data-testid="live-advice">
            <SectionHead title="Que faire maintenant ?" />
            {hero ? (
              <div className="stagger">
                <HeroPick
                  p={hero}
                  onGo={() => go(hero)}
                  onDone={
                    hero.recordId
                      ? () => {
                          setDone(hero.recordId!, true);
                          celebrate("Activité terminée");
                        }
                      : undefined
                  }
                />
                {rest.length > 0 && (
                  <div className="compacts">
                    {rest.map((x, i) => <CompactPick key={x.id} p={x} i={i} onGo={() => go(x)} />)}
                  </div>
                )}
              </div>
            ) : (
              <div className="card empty" data-testid="now-empty">
                {feed ? "Rien d'urgent pour ta progression. Explore les voitures cachées ou demande à Leonida." : "Chargement de la veille…"}
              </div>
            )}
          </section>

          <section className="askcard glass" data-testid="ask-card">
            <div className="askcard__head">
              <BrandMark size={26} />
              <div>
                <strong>Demander à Leonida</strong>
                <span>Réponses tirées des guides collectés, adaptées à ta partie.</span>
              </div>
            </div>
            <div className="askcard__chips">
              {starters({ feed, state }).map((q) => (
                <button key={q} className="chip press" onClick={() => ask(q)}>{q}</button>
              ))}
            </div>
          </section>
        </div>

        <div className="home__col">
          <LiveHighlights />
          <section className="card mygame" data-testid="my-game">
            <h4>Ma partie</h4>
            <div className="mygame__stats">
              <div className="stat"><strong>{owned}</strong><span>Véhicules gardés</span></div>
              <div className="stat"><strong>{doneCount}</strong><span>Activités faites</span></div>
              <div className="stat"><strong>{p.missionsDone.length}</strong><span>Missions notées</span></div>
            </div>
            <p className="fineprint">Progression saisie par toi : LEONIDA OS ne lit pas ta sauvegarde PS5.</p>
          </section>
        </div>
      </div>

      {state.showDemo && <DemoSection regions={regions} all={all} signals={signals} focusOnMap={focusOnMap} setView={setView} />}
    </div>
  );
}

/** Espace démo : contenu fictif, séparé et étiqueté (activable dans Profil). */
function DemoSection({ regions, all, signals, focusOnMap, setView }: { regions: ReturnType<typeof repo.regions>; all: ReturnType<typeof useStore>["discoveries"]; signals: ReturnType<typeof useStore>["signals"]; focusOnMap: (id: string) => void; setView: (v: "carte") => void }) {
  const { state } = useStore();
  const p = useMemo(() => progress(all, state), [all, state]);
  const recs = useMemo(() => recommend(all, state, new Date(), 8), [all, state]);
  const [showAll, setShowAll] = useState(false);
  const next = recs[0];
  const later = recs.slice(1);
  const shown = new Set(recs.slice(0, 4).map((r) => r.discovery.id));
  const al = alerts(all, signals, state).filter((a) => !a.discoveryId || !shown.has(a.discoveryId)).slice(0, 2);
  return (
    <section className="demo" data-testid="demo-section">
      <div className="demo__banner"><Icon name="info" size={15} /> Mode démonstration — contenu fictif, séparé de ta vraie partie.</div>
      <div className="home__grid">
        <div className="home__col">
          {next && (
            <button className="now press" onClick={() => focusOnMap(next.discovery.id)} data-testid="next-discovery" aria-label={`Démo : ${next.discovery.title}`}>
              <div className="now__glow" style={{ background: CATEGORIES[next.discovery.category].color }} />
              <div className="now__q"><span>Démo · à faire</span><DemoBadge provenance={next.discovery.provenance} /></div>
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
          )}
          {later.length > 0 && (
            <section>
              <SectionHead title="Ensuite (démo)" action={<button className="link" onClick={() => setView("carte")}>Carte <Icon name="chevronRight" size={14} /></button>} />
              <div className="list" data-testid="reco-list">
                {(showAll ? later : later.slice(0, 3)).map((r, i) => <RecoCard key={r.discovery.id} rec={r} rank={i + 2} />)}
                {later.length > 3 && <button className="link morebtn" onClick={() => setShowAll((v) => !v)}>{showAll ? "Afficher moins" : `Voir les ${later.length - 3} autres`}</button>}
              </div>
            </section>
          )}
        </div>
        <div className="home__col">
          <section className="card progline" aria-label="Progression de démo">
            <ProgressRing value={p.pct} size={76} stroke={8}>
              <strong className="ring__pct" data-testid="progress-pct">{Math.round(p.pct * 100)}<small>%</small></strong>
            </ProgressRing>
            <div className="progline__stats">
              <div className="stat"><strong data-testid="progress-count">{p.done}<small>/{p.total}</small></strong><span>Découvertes</span></div>
              <div className="stat"><strong>{p.regionsVisited}<small>/{regions.length}</small></strong><span>Régions</span></div>
            </div>
          </section>
          {al.length > 0 && (
            <div className="alerts">
              {al.map((a) => (
                <button key={a.id} className={`alert alert--${a.level}`} onClick={() => a.discoveryId && focusOnMap(a.discoveryId)}>
                  <span className="alert__dot" />
                  <span className="alert__body"><strong>{a.title}</strong><span>{a.body}</span></span>
                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
