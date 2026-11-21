"use client";

import { useMemo, useState } from "react";
import { alerts, progress, recommend } from "@/lib/engine";
import { CATEGORIES, CHAPTERS, EDITIONS } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { sessionPlan } from "@/lib/session";
import type { SessionItem } from "@/lib/session";
import { tick } from "@/lib/motion";
import { Icon } from "@/components/ui/Icon";
import { CategoryGlyph, DemoBadge, ProgressRing, SectionHead } from "@/components/ui/primitives";
import { Visual } from "@/components/ui/Visual";
import { RecoCard } from "@/components/RecoCard";
import { ShieldChip } from "@/components/ShieldChip";
import { CollectorAlert } from "@/components/LiveRadar";
import { BrandMark } from "@/components/Brand";

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

function Thumb({ it, size = "thumb" }: { it: SessionItem; size?: "thumb" | "hero" }) {
  return <Visual media={it.media} icon={it.icon} color={it.color} label={it.title} size={size} />;
}

/** Ligne « Avant de la lancer » : un visuel, un titre français, une phrase, deux actions. */
function BeforeRow({ it, i, onGo, onDone }: { it: SessionItem; i: number; onGo: () => void; onDone: () => void }) {
  return (
    <article className={`brow${it.urgent ? " is-urgent" : ""}`} style={{ ["--i" as string]: i }} data-testid={it.vehicleId ? `car-advice-${it.vehicleId}` : `advice-${it.recordId}`}>
      <button className="brow__main press" onClick={onGo} aria-label={`${it.go === "guide" ? "Me guider vers" : "Voir"} ${it.title}`}>
        <Thumb it={it} />
        <span className="brow__body">
          <strong>{it.title}</strong>
          <em>
            {it.ultimate && <b className="edtag edtag--mini">ULTIMATE</b>}
            {it.urgent && <b className="pill pill--warn pill--mini">À ne pas rater</b>}
            {it.sub}
          </em>
        </span>
      </button>
      <div className="brow__actions">
        <button className="btn btn--xs btn--on press" onClick={onGo}>{it.go === "guide" ? "Me guider" : "Voir"}</button>
        <button className="btn btn--xs btn--ghost press" onClick={onDone} data-testid="advice-done">C&apos;est fait</button>
      </div>
    </article>
  );
}

function FunCard({ it, onGo }: { it: SessionItem; onGo: () => void }) {
  return (
    <button className="funcard press" onClick={onGo} data-testid={it.vehicleId ? `car-advice-${it.vehicleId}` : `fun-${it.recordId}`}>
      <span className="funcard__media">
        <Thumb it={it} size="hero" />
        {!it.media && <span className="funcard__ill">Illustration</span>}
      </span>
      <span className="funcard__body">
        <strong>{it.kind === "vehicle" ? `🚗 ${it.title}` : it.title}</strong>
        <em>{it.ultimate && <b className="edtag edtag--mini">ULTIMATE</b>}{it.sub}</em>
        <span className="funcard__go"><Icon name={it.go === "guide" ? "locate" : "arrow"} size={14} /> {it.go === "guide" ? "Voir sur la carte" : "Voir"}</span>
      </span>
    </button>
  );
}

export function HomeScreen() {
  const { state, focusOnMap, setView, discoveries: all, signals, focusVehicle, openRecord, setDone, setVehicle, setAiOpen, celebrate, setNextMission, setMission, setMissionInProgress } = useStore();
  const { feed } = useLiveRadar();
  const regions = repo.regions();
  const plan = useMemo(() => sessionPlan(feed, state), [feed, state]);
  const p = state.profile;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDone, setConfirmDone] = useState(false);
  const m = plan.mission;

  const go = (it: SessionItem) => {
    tick();
    if (it.vehicleId) focusVehicle(it.vehicleId);
    else if (it.recordId) openRecord(it.recordId);
  };
  const done = (it: SessionItem) => {
    tick();
    if (it.recordId) setDone(it.recordId, true);
    if (it.vehicleId) setVehicle(it.vehicleId, "stolen");
    celebrate(it.vehicleId ? "Véhicule récupéré" : "Activité terminée");
  };
  const prepare = () => {
    if (!m.name) return;
    tick();
    const q = p.missionInProgress ? `Je suis en pleine mission ${m.name}` : `Je vais lancer ${m.name}`;
    window.dispatchEvent(new CustomEvent("leonida:ask", { detail: { question: q, topic: { kind: "mission", name: m.name, known: !!m.info } } }));
    setAiOpen(true);
  };
  const checklist = () => {
    if (!m.name) return;
    tick();
    window.dispatchEvent(new CustomEvent("leonida:ask", { detail: { question: `Rien à manquer dans ${m.name} ?`, topic: { kind: "mission", name: m.name, known: !!m.info }, mode: "checklist", mission: m.name } }));
    setAiOpen(true);
  };
  const saveNext = (name: string, inProgress = false) => {
    const n = name.trim();
    if (!n) return;
    tick();
    setNextMission(n, inProgress);
    setEditing(false);
    setDraft("");
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

      <CollectorAlert />

      <div className="home__grid">
        <div className="home__col">
          {/* A — Ta prochaine mission */}
          <section className="missioncard glass" data-testid="next-mission">
            <p className="missioncard__eyebrow">
              <Icon name="flag" size={14} /> {m.name && p.missionInProgress && !editing ? "Mission en cours" : "Ta prochaine mission"}
              {m.name && p.missionInProgress && !editing && <b className="pill pill--live pill--mini" data-testid="mission-live">EN COURS</b>}
            </p>
            {m.name && !editing ? (
              <>
                <h2 className="missioncard__name" data-testid="next-mission-name">{m.name}</h2>
                <p className="missioncard__meta">
                  {!m.info ? "Pas encore documentée par la veille" : m.info.chapter != null ? `Chapitre ${m.info.chapter}` : "Chapitre non documenté"}
                  {m.brief?.guide ? " · guide disponible" : ""}
                </p>
                <p className="missioncard__during" data-testid="mission-during">
                  <b>À récupérer pendant :</b> {m.during ?? "aucune récompense particulière confirmée pour le moment."}
                </p>
                {m.risk && <p className="missioncard__risk"><Icon name="alert" size={13} /> {m.risk}</p>}
                <div className="missioncard__ctas">
                  <button className="btn btn--primary missioncard__cta press" onClick={checklist} data-testid="nothing-to-miss">
                    <Icon name="check" size={18} /> Rien à manquer
                  </button>
                  <button className="btn btn--ghost missioncard__cta press" onClick={prepare} data-testid="prepare-mission">
                    <BrandMark size={18} /> {p.missionInProgress ? "Aide en mission" : "Préparer ma mission"}
                  </button>
                </div>
                <Objectives mission={m.name} />
                <div className="missioncard__links">
                  {confirmDone ? (
                    <span className="confirm" data-testid="mission-done-confirm">
                      <span>« {m.name} » terminée ?</span>
                      <button className="btn btn--primary btn--xs" onClick={() => { setMission(m.name!, true); setConfirmDone(false); celebrate("Mission terminée"); }}>Oui</button>
                      <button className="btn btn--ghost btn--xs" onClick={() => setConfirmDone(false)}>Non</button>
                    </span>
                  ) : (
                    <>
                      {p.missionInProgress ? (
                        <button className="link small" onClick={() => setMissionInProgress(false)} data-testid="mission-stop">Pas encore lancée</button>
                      ) : (
                        <button className="link small" onClick={() => { tick(); setMissionInProgress(true); }} data-testid="mission-start">Je l&apos;ai lancée</button>
                      )}
                      <button className="link small" onClick={() => setConfirmDone(true)} data-testid="mission-done">Je l&apos;ai terminée</button>
                      <button className="link small" onClick={() => { setDraft(""); setEditing(true); }} data-testid="mission-change">Changer</button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2 className="missioncard__name">{m.guess && !editing ? `« ${m.guess.name} » ?` : "Quelle est ta prochaine mission ?"}</h2>
                <p className="missioncard__meta">
                  {m.guess && !editing ? `Proposition ${m.guess.basis}. Confirme-la, je ne la devine pas.` : "Je ne la déduis pas de ton chapitre : indique-la pour préparer ta session."}
                </p>
                {m.guess && !editing ? (
                  <div className="row gap8 wrap">
                    <button className="btn btn--primary btn--sm press" onClick={() => saveNext(m.guess!.name)} data-testid="confirm-guess">Oui, c&apos;est elle</button>
                    <button className="btn btn--ghost btn--sm press" onClick={() => setEditing(true)}>Une autre</button>
                  </div>
                ) : (
                  <form className="missionform" onSubmit={(e) => { e.preventDefault(); saveNext(draft); }}>
                    <input list="next-missions" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Nom de la mission (ex. Tourist Trap)" aria-label="Prochaine mission" data-testid="next-mission-input" maxLength={80} />
                    <datalist id="next-missions">{m.choices.map((c) => <option key={c} value={c} />)}</datalist>
                    <button className="btn btn--primary btn--sm" disabled={!draft.trim()} data-testid="next-mission-save">À venir</button>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={!draft.trim()} onClick={() => saveNext(draft, true)} data-testid="next-mission-live">En cours</button>
                  </form>
                )}
              </>
            )}
          </section>

          {/* B — Avant de la lancer */}
          <section className="beforesec" data-testid="live-advice">
            <SectionHead title={m.name ? "Avant de la lancer" : "Avant de continuer"} />
            {plan.before.length ? (
              <div className="brows stagger">
                {plan.before.map((it, i) => <BeforeRow key={it.id} it={it} i={i} onGo={() => go(it)} onDone={() => done(it)} />)}
              </div>
            ) : (
              <p className="card empty" data-testid="now-empty">{feed ? `Rien d'urgent confirmé avant ${m.name ? "cette mission" : "de continuer"}.` : "Chargement de la veille…"}</p>
            )}
          </section>
        </div>

        <div className="home__col">
          {/* C — Envie de t'amuser ? */}
          {plan.fun.length > 0 && (
            <section className="funsec" data-testid="fun-picks">
              <SectionHead title="Envie de t’amuser avant de poursuivre ?" />
              <div className="funrow">
                {plan.fun.map((it) => <FunCard key={it.id} it={it} onGo={() => go(it)} />)}
              </div>
            </section>
          )}

          {/* D — Le reste : progression compacte, liens vers les onglets */}
          <section className="progcompact" data-testid="my-game">
            <button className="progcompact__line press" onClick={() => setView("profil")} data-testid="context-bar">
              <span>{CHAPTERS[p.chapter]}</span><i />
              <span>{EDITIONS[p.edition] === "Je ne sais pas" ? "Édition ?" : EDITIONS[p.edition]}</span><i />
              <span>{plan.stats.missions} mission{plan.stats.missions > 1 ? "s" : ""}</span><i />
              <span>{plan.stats.vehicles} véhicule{plan.stats.vehicles > 1 ? "s" : ""} gardé{plan.stats.vehicles > 1 ? "s" : ""}</span>
              <Icon name="chevronRight" size={14} />
            </button>
            <button className="link small" onClick={() => setView("radar")} data-testid="explore-more">Explorer davantage <Icon name="chevronRight" size={12} /></button>
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

/** Objectifs facultatifs de la mission : cochables, avec leur niveau de preuve ; ajout libre par le joueur. */
function Objectives({ mission }: { mission: string }) {
  const { state, addObjective, toggleObjective, removeObjective } = useStore();
  const [txt, setTxt] = useState("");
  const [open, setOpen] = useState(false);
  const list = (state.profile.objectives ?? []).filter((o) => o.mission.toLowerCase() === mission.toLowerCase());
  const left = list.filter((o) => !o.done).length;
  return (
    <div className="objs" data-testid="objectives">
      <button className="objs__head press" onClick={() => setOpen((v) => !v)} aria-expanded={open || list.length > 0}>
        <span>Objectifs facultatifs</span>
        <em>{list.length ? `${list.length - left}/${list.length}` : "aucun noté"}</em>
      </button>
      {list.length > 0 && (
        <ul className="objs__list">
          {list.map((o) => (
            <li key={o.id} className={o.done ? "is-done" : ""} data-testid="objective">
              <button className="objs__check press" onClick={() => { tick(); toggleObjective(o.id); }} aria-pressed={o.done} aria-label={`${o.done ? "Rouvrir" : "Cocher"} : ${o.text}`}>
                {o.done ? <Icon name="check" size={20} /> : <span className="objs__box" />}
              </button>
              <span className="objs__text">
                {o.text}
                <b className={`objs__basis objs__basis--${o.basis === "vérifié" ? "ok" : o.basis === "incertain" ? "warn" : "me"}`}>{o.basis === "perso" ? "noté par toi" : o.basis}</b>
              </span>
              <button className="objs__rm" onClick={() => removeObjective(o.id)} aria-label={`Retirer : ${o.text}`}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {(open || list.length > 0) && (
        <form className="objs__add" onSubmit={(e) => { e.preventDefault(); if (txt.trim()) { addObjective({ mission, text: txt, basis: "perso" }); setTxt(""); } }}>
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Ajouter un objectif (ex. ne pas abîmer la voiture)" maxLength={160} aria-label="Nouvel objectif" data-testid="objective-input" />
          <button className="btn btn--xs btn--on" disabled={!txt.trim()} data-testid="objective-add">Ajouter</button>
        </form>
      )}
    </div>
  );
}
