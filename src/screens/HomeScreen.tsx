"use client";

import { useEffect, useMemo, useState } from "react";
import { alerts, progress, recommend } from "@/lib/engine";
import { CATEGORIES } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { sessionPlan } from "@/lib/session";
import { tick } from "@/lib/motion";
import { Icon } from "@/components/ui/Icon";
import { CategoryGlyph, DemoBadge, ProgressRing, SectionHead } from "@/components/ui/primitives";
import { RecoCard } from "@/components/RecoCard";
import { ShieldChip } from "@/components/ShieldChip";
import { CollectorAlert } from "@/components/LiveRadar";
import { useMissionBrief } from "@/components/MissionBrief";
import { discoverNow, DISCOVER_CATS } from "@/lib/discover";
import { buildBefore, BEFORE_KIND_FR } from "@/lib/before";
import type { BeforeItem } from "@/lib/before";
import { buildJournal, JOURNAL_FR } from "@/lib/journal";
import { loadLandmarks } from "@/lib/gtadb";
import type { Landmark } from "@/lib/gtadb";
import { computeProgress, progDoneKey } from "@/lib/progress";
import { progressDelta } from "@/lib/ai/progressAnswers";
import type { ProgressDelta } from "@/lib/ai/progressAnswers";
import { useRedact } from "@/lib/useRedact";
import { autopilot } from "@/lib/autopilot";
import type { Autopilot } from "@/lib/autopilot";
import { launchRisks } from "@/lib/story/engine";
import { StoryLaunch } from "@/components/StoryLaunch";

const SHOWN_CRITICAL = 3;
const SHOWN_OPTIONAL = 2;

/**
 * Accueil V0.14 — une mission, une priorité, des découvertes.
 * A. Mission (nom, état, changer, bouclier) · B. À faire avant de continuer (UNE liste priorisée)
 * C. Une action principale selon l'état · D. Si tu as le temps (2 suggestions, puis « Tout voir »).
 * Les sections vides disparaissent ; rien n'est dupliqué.
 */
export function HomeScreen() {
  const store = useStore();
  const { state, setMission, setMissionInProgress, setNextMission, notify, celebrate } = store;
  const { feed } = useLiveRadar();
  const plan = useMemo(() => sessionPlan(feed, state), [feed, state]);
  const p = state.profile;
  const mission = plan.mission.name;
  const live = !!p.missionInProgress && !!mission;
  const mb = useMissionBrief(mission);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  useEffect(() => void loadLandmarks().then(setLandmarks), []);
  const byName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of landmarks) if (!/^\?|Lieu non identifié/.test(l.name)) m.set(l.name.toLowerCase().replace(/^the /, ""), l.id);
    return (n: string) => m.get(n.toLowerCase().replace(/^the /, "").trim()) ?? null;
  }, [landmarks]);
  const discover = useMemo(() => discoverNow(feed, state, { landmarkByName: byName }), [feed, state, byName]);
  const view = useMemo(() => buildBefore(state, feed, discover, plan.before, mb.brief), [state, feed, discover, plan.before, mb.brief]);
  const [justDone, setJustDone] = useState<{ name: string; delta: ProgressDelta } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const finish = () => {
    if (!mission) return;
    tick();
    const delta = progressDelta(p, mission, state.done);
    setMission(mission, true);
    setConfirmEnd(false);
    setJustDone({ name: mission, delta });
    celebrate("Mission terminée");
  };
  const choose = (name: string, inProgress = false) => {
    tick();
    setNextMission(name, inProgress);
    setJustDone(null);
    notify(inProgress ? "Mission en cours" : "Prochaine mission notée", name, "flag");
  };
  // V0.18.1 : lancer une mission qui porte un point de non-retour ou des risques critiques documentés demande une
  // confirmation compacte (jamais un blocage) ; sans risque important, le lancement reste immédiat
  const [guard, setGuard] = useState<{ name: string; risks: NonNullable<ReturnType<typeof launchRisks>>; planned: boolean } | null>(null);
  const doLaunch = (name: string, planned: boolean) => {
    setGuard(null);
    if (planned) (tick(), setMissionInProgress(true), notify("Mission en cours", name, "flag"));
    else choose(name, true);
  };
  const launch = (name: string, planned: boolean) => {
    const risks = launchRisks(state, name);
    if (risks) return (tick(), setGuard({ name, risks, planned }));
    doLaunch(name, planned);
  };

  return (
    <div className="screen home home14">
      <MissionHeader mission={mission} live={live} onEnd={() => setConfirmEnd(true)} onStart={() => mission && launch(mission, true)} />
      <div className="home__main">
      <CollectorAlert hideSnapshot />

      {/* V0.18 : sans mission choisie, la proposition de l'Autopilot passe en premier (deux ou trois touchers après « Terminée ») */}
      {guard && (
        <section className="lguard glass" role="alertdialog" aria-label={`Avant de lancer ${guard.name}`} data-testid="launch-guard">
          <p className="lguard__head"><Icon name="alert" size={15} /> <span>Avant de lancer <b>{guard.name}</b> : {[guard.risks.pnr ? "point de non-retour" : "", guard.risks.count ? `${guard.risks.count} risque${guard.risks.count > 1 ? "s" : ""} critique${guard.risks.count > 1 ? "s" : ""} documenté${guard.risks.count > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")}</span></p>
          {guard.risks.lines.map((l, i) => <p key={i} className="lguard__line">{l}</p>)}
          <div className="row gap8">
            <button className="btn btn--sm btn--ghost press" onClick={() => (tick(), setGuard(null), !guard.planned && choose(guard.name))} data-testid="guard-review">Revoir d&apos;abord</button>
            <button className="btn btn--sm btn--primary press" onClick={() => doLaunch(guard.name, guard.planned)} data-testid="guard-go">Lancer quand même</button>
          </div>
        </section>
      )}
      {!mission && <NextChoice justDone={justDone} onChoose={(n, live) => (live ? launch(n, false) : choose(n))} choices={plan.mission.choices} />}

      {(mission || view.critical.length > 0) && (
        <section className="before glass" data-testid="before">
          <header className="before__head">
            <h2>{live ? "Pendant la mission" : "Avant de continuer"}</h2>
            {mission && <button className="before__meta press" onClick={() => { tick(); void mb.run(); }} disabled={mb.busy || !mb.canRun} data-testid="nothing-to-miss" aria-label="Mettre à jour l'analyse de la mission">
              <span data-testid="brief-meta">{mb.meta}</span>
              {mb.busy ? <span className="spin" aria-hidden /> : <Icon name="reset" size={14} />}
            </button>}
          </header>
          <BeforeList items={view.critical} shown={SHOWN_CRITICAL} mission={mission ?? ""} testid="before-item" empty={
            mb.busy
              ? "Analyse de la mission en cours…"
              : view.analysed
                ? "Aucune perte définitive documentée pour cette mission dans les sources consultées. Ce n'est pas une garantie : garde l'œil ouvert."
                : "Pas encore d'analyse pour cette mission. Aucune perte n'est documentée dans nos fiches, ce qui ne garantit rien."
          } />
          {view.pnr && (
            <p className="before__pnr" data-testid="pnr"><Icon name="clock" size={13} /><span>Point de non-retour {view.pnr} : les éléments marqués « non-retour » y sont perdus.</span></p>
          )}
          {mb.failed && <p className="before__note">L&apos;analyse n&apos;a pas abouti. Réessaie dans un instant.</p>}
          {mission && <StoryLaunch mission={mission} />}
        </section>
      )}

      {/* C — action principale */}
      {mission && !confirmEnd && !guard && (
        <button className={`maincta press${live ? " is-live" : ""}`} onClick={() => (live ? setConfirmEnd(true) : launch(mission, true))} data-testid={live ? "mission-done" : "mission-start"}>
          {live ? "J'ai terminé" : "Je lance la mission"}
        </button>
      )}
      {mission && confirmEnd && (
        <div className="maincta__confirm glass" data-testid="mission-done-confirm">
          <span>« {mission} » terminée ? Elle passera dans tes missions faites.</span>
          <div className="row gap8">
            <button className="btn btn--ghost btn--sm press" onClick={() => setConfirmEnd(false)}>Non</button>
            <button className="btn btn--primary btn--sm press" onClick={finish}>Oui, terminée</button>
          </div>
        </div>
      )}
      {live && <Objectives mission={mission!} />}


      </div>
      <div className="home__side">
        {view.optional.length > 0 && <MaybeList items={view.optional} />}
        <PartieMini />
      </div>

      {state.showDemo && <DemoSection regions={repo.regions()} all={store.discoveries} signals={store.signals} focusOnMap={store.focusOnMap} setView={store.setView} />}
    </div>
  );
}

/** A — mission principale : nom, état (menu), bouclier discret. */
function MissionHeader({ mission, live, onEnd, onStart }: { mission: string | null; live: boolean; onEnd: () => void; onStart: () => void }) {
  const { setMissionInProgress, setNextMission } = useStore();
  const [menu, setMenu] = useState(false);
  return (
    <header className="mhead" data-testid="home-header">
      <div className="mhead__main" data-testid="next-mission">
        <div className="mhead__row">
          <p className="mhead__eyebrow">{mission ? "Mission principale" : "Aucune mission choisie"}</p>
          {mission && (
            <div className="mhead__statewrap">
              <button className={`mstate14 press${live ? " is-live" : ""}`} onClick={() => (tick(), setMenu((v) => !v))} aria-haspopup="menu" aria-expanded={menu} data-testid={live ? "mission-live" : "mission-upcoming"}>
                <i aria-hidden /> {live ? "En cours" : "À venir"} <Icon name="chevronRight" size={12} />
              </button>
              {menu && (
                <div className="mstate14__menu" role="menu" data-testid="mission-state">
                  <button role="menuitem" onClick={() => (tick(), setMissionInProgress(false), setMenu(false))} data-testid="mission-stop">À venir</button>
                  <button role="menuitem" onClick={() => (setMenu(false), live ? undefined : onStart())} data-testid="mission-state-live">En cours</button>
                  <button role="menuitem" onClick={() => (setMenu(false), onEnd())}>Terminée…</button>
                  <button role="menuitem" onClick={() => (tick(), setNextMission(null), setMenu(false))} data-testid="mission-change">Changer de mission</button>
                </div>
              )}
            </div>
          )}
        </div>
        <h1 className="mhead__name" data-testid="next-mission-name">{mission ?? "Prochaine mission à choisir"}</h1>
      </div>
      <ShieldChip />
    </header>
  );
}

/** Marque « Fait » en un toucher (V0.14) — chaque type garde son stockage ; « Annuler » ~5 s, puis depuis Partie. */
function useDone() {
  const { markDone, addObjective, notifyUndo, undoObjective } = useStore();
  return (it: BeforeItem) => {
    tick();
    if (it.done.type === "done") markDone(it.done.key, JOURNAL_FR[it.done.kind].done, it.text);
    else {
      const { mission, text, source } = it.done;
      addObjective({ mission, text, basis: it.status === "Vérifié" ? "vérifié" : "incertain", source, done: true });
      notifyUndo(it.cat === "unique" ? "Objet récupéré" : "Noté comme fait", text, () => undoObjective(mission, text));
    }
  };
}

function TrustChip({ s }: { s: BeforeItem["status"] }) {
  return <i className={`trust trust--${s === "Vérifié" ? "ok" : s === "Probable" ? "warn" : "low"}`}>{s}</i>;
}

/** B — liste priorisée : 3 éléments visibles, détails au toucher, « Tout voir ». */
function BeforeList({ items, shown, empty, testid }: { items: BeforeItem[]; shown: number; mission: string; empty: string; testid: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const done = useDone();
  const { showPlace, focusVehicle, openRecord } = useStore();
  if (!items.length) return <p className="before__empty" data-testid="before-empty">{empty}</p>;
  const list = all ? items : items.slice(0, shown);
  return (
    <>
      <ul className="blist">
        {list.map((it) => {
          const isOpen = open === it.key;
          return (
            <li key={it.key} className={`bl${it.high ? " is-high" : ""}`} data-testid={testid} data-kind={it.kind} data-status={it.status}>
              <button className="bl__check press" onClick={() => done(it)} aria-label={`Fait : ${it.text}`} data-testid="done-btn"><span /></button>
              <button className="bl__body" onClick={() => setOpen(isOpen ? null : it.key)} aria-expanded={isOpen}>
                <strong>{it.text}</strong>
                <em>
                  <TrustChip s={it.status} />
                  {it.atPnr ? <b className="bl__pnr" title="Perdu au point de non-retour"><Icon name="clock" size={10} /> non-retour</b> : <span>{it.when ?? BEFORE_KIND_FR[it.kind]}</span>}
                </em>
              </button>
              {isOpen && (
                <div className="bl__detail" data-testid="before-detail">
                  <p className="bl__kind">{BEFORE_KIND_FR[it.kind]}{it.high ? " · important" : ""}</p>
                  {it.detail.map((d, i) => <p key={i}>{d}</p>)}
                  {it.sources.length > 0 && <p className="bl__src">{it.sources.slice(0, 4).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>)}</p>}
                  <div className="row gap8 wrap">
                    {it.map?.vehicleId && <button className="btn btn--xs btn--on press" onClick={() => focusVehicle(it.map!.vehicleId!)} data-testid="before-map">Voir sur la carte</button>}
                    {it.map?.landmarkId && <button className="btn btn--xs btn--on press" onClick={() => showPlace({ landmarkId: it.map!.landmarkId })} data-testid="before-map">Voir sur la carte</button>}
                    {it.recordId && <button className="btn btn--xs btn--ghost press" onClick={() => openRecord(it.recordId!)}>Fiche du Guide</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > shown && (
        <button className="before__all press" onClick={() => setAll((v) => !v)} data-testid="before-all">{all ? "Réduire" : `Tout voir (${items.length})`}</button>
      )}
    </>
  );
}

/** D — « Si tu as le temps » : annexes, véhicules, objets, argent, secrets. */
function MaybeList({ items }: { items: BeforeItem[] }) {
  const [all, setAll] = useState(false);
  const done = useDone();
  const { showPlace, focusVehicle, openRecord } = useStore();
  const list = all ? items : items.slice(0, SHOWN_OPTIONAL);
  return (
    <section className="maybe" data-testid="discover-now">
      <header className="maybe__head">
        <h2>Si tu as le temps</h2>
        {items.length > SHOWN_OPTIONAL && <button className="link small press" onClick={() => setAll((v) => !v)} data-testid="discover-all">{all ? "Réduire" : `Tout voir (${items.length})`}</button>}
      </header>
      <ul className="mlist">
        {list.map((it) => {
          const c = DISCOVER_CATS[it.cat];
          const go = it.map?.vehicleId ? () => focusVehicle(it.map!.vehicleId!) : it.map?.landmarkId ? () => showPlace({ landmarkId: it.map!.landmarkId }) : it.recordId ? () => openRecord(it.recordId!) : null;
          return (
            <li key={it.key} className="ml" style={{ ["--c" as string]: c.color }} data-testid={`discover-${it.key}`} data-cat={it.cat} data-status={it.status}>
              <span className="ml__ico" aria-hidden><Icon name={c.icon} size={15} /></span>
              <button className="ml__body" onClick={() => go?.()} disabled={!go}>
                <strong>{it.text}</strong>
                <em>{c.label} · <TrustChip s={it.status} /></em>
              </button>
              <button className="ml__done press" onClick={() => done(it)} aria-label={`Fait : ${it.text}`} data-testid="discover-done"><Icon name="check" size={15} /></button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** C bis — après « J'ai terminé » ou sans mission : ce qui s'ouvre, choix sans progression linéaire inventée. */
/**
 * V0.18.1 · Missions antérieures « probablement faites » : confirmation rapide de tout le lot, OU inspection de la liste
 * avec sélection individuelle. Rien n'est enregistré avant un toucher sur « Confirmer ».
 */
function LikelyConfirm({ likely }: { likely: Autopilot["likely"] }) {
  const { confirmPastMissions, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(likely.map((x) => x.realName)));
  const masked = !likely.every((x) => x.name === x.realName);
  const n = likely.length;
  const confirm = (names: string[]) => {
    if (!names.length) return;
    tick();
    confirmPastMissions(names);
    notify("Missions antérieures confirmées", `${names.length} mission${names.length > 1 ? "s" : ""}`, "check");
  };
  return (
    <div className="nextc__likely" data-testid="autopilot-likely">
      <div className="nextc__likelyhead">
        <span>
          {masked
            ? <>{n} mission{n > 1 ? "s" : ""} antérieure{n > 1 ? "s" : ""} probablement faite{n > 1 ? "s" : ""}, non déclarée{n > 1 ? "s" : ""} (noms masqués en mode strict)</>
            : <>Probablement déjà faite{n > 1 ? "s" : ""} (non déclarée{n > 1 ? "s" : ""}) : <b>{n > 3 ? `${likely[0].name} … ${likely.at(-1)!.name} (${n})` : likely.map((x) => x.name).join(", ")}</b></>}
        </span>
        <span className="row gap8">
          {!masked && n > 1 && <button className="btn btn--xs btn--ghost press" onClick={() => (tick(), setOpen((v) => !v))} aria-expanded={open} data-testid="likely-inspect">{open ? "Masquer" : "Voir la liste"}</button>}
          {!open && <button className="btn btn--xs btn--on press" onClick={() => confirm(likely.map((x) => x.realName))} data-testid="likely-confirm">{n > 1 ? "Tout confirmer" : "Oui, faite"}</button>}
        </span>
      </div>
      {open && (
        <>
          <ul className="nextc__likelylist" data-testid="likely-list">
            {likely.map((x) => (
              <li key={x.id}>
                <label>
                  <input type="checkbox" checked={sel.has(x.realName)} onChange={() => setSel((s) => { const t = new Set(s); if (t.has(x.realName)) t.delete(x.realName); else t.add(x.realName); return t; })} data-testid="likely-item" />
                  <span>{x.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row gap8">
            <button className="btn btn--xs btn--ghost press" onClick={() => setSel(sel.size === n ? new Set() : new Set(likely.map((x) => x.realName)))} data-testid="likely-toggle-all">{sel.size === n ? "Tout décocher" : "Tout cocher"}</button>
            <button className="btn btn--xs btn--on press" disabled={!sel.size} onClick={() => confirm(likely.filter((x) => sel.has(x.realName)).map((x) => x.realName))} data-testid="likely-confirm-selected">Confirmer la sélection ({sel.size})</button>
          </div>
        </>
      )}
    </div>
  );
}

function NextChoice({ justDone, onChoose, choices }: { justDone: { name: string; delta: ProgressDelta } | null; onChoose: (n: string, live?: boolean) => void; choices: string[] }) {
  const { state, setExploring, markDone, notify } = useStore();
  const [draft, setDraft] = useState("");
  const [actOpen, setActOpen] = useState<string | null>(null);
  // V0.18 Mission Autopilot : la suite vient du graphe sourcé (jamais de l'ordre d'un guide), le joueur confirme
  const a = useMemo(() => autopilot(state), [state]);
  const manual = useMemo(() => [...new Set([...a.manual, ...choices])].sort(), [a.manual, choices]);
  const lost = justDone?.delta.lost ?? [];
  if (a.mode === "exploration" && !justDone)
    return (
      <section className="nextc nextc--explore glass" data-testid="next-choice" data-mode="exploration">
        <p className="nextc__done"><Icon name="map" size={14} /> Exploration libre{a.last ? ` · dernière mission terminée : ${a.last.name}` : ""}</p>
        <button className="btn btn--xs btn--on press" onClick={() => (tick(), setExploring(false))} data-testid="explore-stop">Choisir une mission</button>
      </section>
    );
  const several = a.mains.length > 1;
  return (
    <section className="nextc glass" data-testid="next-choice" data-mode={a.mode}>
      <p className="nextc__done" data-testid="autopilot-last">
        <Icon name="check" size={14} /> {a.last ? <span>Dernière mission terminée : <b>{a.last.name}</b></span> : "Aucune mission terminée déclarée."}
      </p>
      <h2>{a.suggestion ? "Voici ce que tu peux faire ensuite" : several ? "Plusieurs suites possibles" : "Quelle mission ensuite ?"}</h2>
      {a.suggestion ? (
        <div className="nextc__sugg" data-testid="autopilot-suggestion">
          <span>
            <b>{a.suggestion.name}</b>
            {a.suggestion.fresh && <i className="nextc__new">débloquée</i>}
            <em>{a.suggestion.why}{a.suggestion.pnr ? " · point de non-retour" : ""}</em>
          </span>
          <div className="row gap8">
            <button className="btn btn--sm btn--primary press" onClick={() => onChoose(a.suggestion!.name)} data-testid="autopilot-plan">Je la prépare</button>
            <button className="btn btn--sm btn--ghost press" onClick={() => onChoose(a.suggestion!.name, true)} data-testid="autopilot-start">Je la lance</button>
          </div>
        </div>
      ) : several ? (
        <ul className="nextc__list">
          {a.mains.map((x) => (
            <li key={x.id}>
              <span>
                <b>{x.name}</b>
                {x.fresh && <i className="nextc__new">débloquée</i>}
                <em>{x.why}{x.pnr ? " · point de non-retour" : ""}</em>
              </span>
              <button className="btn btn--xs btn--on press" onClick={() => onChoose(x.name)} data-testid="choose-next">Choisir</button>
            </li>
          ))}
        </ul>
      ) : null}
      {a.uncertain && <p className="nextc__note" data-testid="autopilot-uncertain"><Icon name="info" size={13} /> {a.uncertain}</p>}
      {a.likely.length > 0 && <LikelyConfirm likely={a.likely} />}
      {a.sides.length > 0 && (
        <div className="nextc__sides" data-testid="autopilot-sides">
          <p className="nextc__line"><b>Missions secondaires</b>{a.sides.some((x) => x.missable) ? " · ⏳ disparaît plus tard" : ""}</p>
          <ul className="nextc__chips">
            {a.sides.slice(0, 3).map((x) => (
              <li key={x.id}><button className="chip press" onClick={() => onChoose(x.name)} data-testid="choose-side">{x.name}{x.missable ? " ⏳" : ""}</button></li>
            ))}
          </ul>
        </div>
      )}
      {a.activities.length > 0 && (
        <div className="nextc__sides" data-testid="autopilot-activities">
          <p className="nextc__line"><b>Activités libres</b> · à faire quand tu veux, ce ne sont pas des missions</p>
          <ul className="nextc__chips">
            {a.activities.map((x) => (
              <li key={x.id}>
                {actOpen === x.id ? (
                  <span className="nextc__act" data-testid="activity-open">
                    <span>{x.name}</span>
                    <button className="btn btn--xs btn--on press" onClick={() => (tick(), markDone(progDoneKey(x.id), JOURNAL_FR.activite.done, x.name), setActOpen(null))} data-testid="activity-done">C&apos;est fait</button>
                    <button className="btn btn--xs btn--ghost press" onClick={() => setActOpen(null)} aria-label="Fermer">×</button>
                  </span>
                ) : (
                  <button className="chip chip--act press" onClick={() => (tick(), setActOpen(x.id))} data-testid="choose-activity">{x.name}{x.missable ? " ⏳" : ""}</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lost.length > 0 && <p className="nextc__line is-lost"><b>Plus disponible :</b> {lost.map((x) => x.node.name).join(", ")}</p>}
      {a.pnr && <p className="nextc__line is-pnr" data-testid="autopilot-pnr"><Icon name="clock" size={12} /> Point de non-retour proche {a.pnr.where} : finis d&apos;abord ce qui compte pour toi.</p>}
      <form className="missionform" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onChoose(draft.trim()); }}>
        <input list="next-missions" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Autre mission (nom affiché en jeu)" aria-label="Prochaine mission" data-testid="next-mission-input" maxLength={80} />
        <datalist id="next-missions">{manual.map((c) => <option key={c} value={c} />)}</datalist>
        <button className="btn btn--primary btn--sm" disabled={!draft.trim()} data-testid="next-mission-save">Choisir</button>
      </form>
      <button className="link small press nextc__explore" onClick={() => (tick(), setExploring(true), notify("Exploration libre", "Je ne te propose plus de mission tant que tu n'en choisis pas une.", "map"))} data-testid="explore-free">
        Je préfère explorer librement
      </button>
    </section>
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


/** Grand écran (iPad) : résumé de partie dans la colonne de droite — masqué sur iPhone pour garder l'accueil court. */
function PartieMini() {
  const { state, setView } = useStore();
  const { feed } = useLiveRadar();
  const recent = useMemo(() => buildJournal(state, feed).filter((e) => e.at).slice(0, 3), [state, feed]);
  const sides = useMemo(() => buildJournal(state, feed).filter((e) => e.kind === "activite").length, [state, feed]);
  return (
    <section className="pmini glass" data-testid="partie-mini">
      <header className="pmini__head"><h2>Ta partie</h2><button className="link small press" onClick={() => setView("profil")}>Tout voir</button></header>
      <p className="pmini__stats"><b>Chapitre {state.profile.chapter}</b> · {state.profile.missionsDone.length} mission{state.profile.missionsDone.length > 1 ? "s" : ""} principale{state.profile.missionsDone.length > 1 ? "s" : ""} · {sides} activité{sides > 1 ? "s" : ""}</p>
      {recent.length > 0 && (
        <ul className="pmini__list">
          {recent.map((e) => <li key={e.id}><span>{e.name}</span><em>{JOURNAL_FR[e.kind].done} · {new Date(e.at!).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</em></li>)}
        </ul>
      )}
    </section>
  );
}
