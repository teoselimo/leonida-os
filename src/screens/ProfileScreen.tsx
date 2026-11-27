"use client";

import { useEffect, useMemo, useState } from "react";
import { ChapterTransition } from "@/components/ChapterTransition";
import { DATASET_INFO } from "@/data/demo";
import { CC_BY_URL, GTADB_URL, loadMeta } from "@/lib/gtadb";
import type { GtadbMeta } from "@/lib/gtadb";
import { CHAPTER_LIST, CHAPTER_SHORT, CHAPTERS, EDITIONS, SPOILER_HINT } from "@/lib/meta";
import { useLiveRadar } from "@/lib/live";
import { STATE_FR } from "@/lib/garage";
import { glassPref, setGlassPref } from "@/lib/glass";
import type { GlassPref } from "@/lib/glass";
import { repo, useStore } from "@/lib/store";
import type { Chapter, EditionId, SpoilerMode } from "@/lib/types";
import { buildJournal, JOURNAL_FR } from "@/lib/journal";
import type { JournalEntry, JournalKind } from "@/lib/journal";
import { lowersProtection } from "@/lib/spoiler";
import { APP_VERSION } from "@/lib/version";
import { cloudDoc } from "@/lib/runtime/cloud";
import { Icon } from "@/components/ui/Icon";
import { WebDiag } from "@/components/WebDiag";
import { CategoryGlyph, Segmented } from "@/components/ui/primitives";

export function ProfileScreen() {
  const { state, setProfile, focusOnMap, reset, setShowDemo, importCustom, importProgress, notify, focusVehicle, setMission, setDone, setVehicle, toggleObjective, setPin } = useStore();
  const { feed } = useLiveRadar();
  const [missionText, setMissionText] = useState("");
  const [glass, setGlass] = useState<GlassPref>("auto");
  useEffect(() => setGlass(glassPref()), []);
  // Missions connues par la veille, sans spoiler : uniquement celles rattachées à un chapitre déjà atteint
  const knownMissions = Array.from(
    new Set(
      (feed?.items ?? [])
        .filter((r) => (r.details?.chapter?.value ?? 99) <= state.profile.chapter)
        .flatMap((r) => [r.details?.mission?.value, r.details?.unlockAfter?.value, r.details?.contextMissable?.value.until])
        .filter((m): m is string => !!m),
    ),
  ).sort();
  const owned = (feed?.vehicles ?? []).filter((v) => state.vehicles[v.id]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [meta, setMeta] = useState<GtadbMeta | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const exportJson = () =>
    JSON.stringify({ format: "leonida-os/releves", version: 1, exportedAt: new Date().toISOString(), items: state.custom }, null, 1);
  // Sauvegarde complète de la partie (profil, missions, activités, véhicules, relevés) : format portable,
  // réimportable dans l'Artifact comme dans l'app GitHub Pages
  const progressJson = () => JSON.stringify({ format: "leonida-os/progression", version: 1, exportedAt: new Date().toISOString(), state }, null, 1);
  const copyProgress = async () => {
    const txt = progressJson();
    try {
      await navigator.clipboard.writeText(txt);
      notify("Sauvegarde copiée", "Colle-la dans « Importer » sur un autre appareil ou dans l'autre version de l'app");
      setExportText(null);
    } catch {
      setExportText(txt);
    }
  };
  const copyExport = async () => {
    const txt = exportJson();
    try {
      await navigator.clipboard.writeText(txt);
      notify("Export copié", `${state.custom.length} relevé${state.custom.length > 1 ? "s" : ""} dans le presse-papiers`);
      setExportText(null);
    } catch {
      setExportText(txt);
    }
  };
  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (parsed?.format === "leonida-os/progression") {
        if (importProgress(parsed.state)) {
          setImportText("");
          setImportOpen(false);
          setImportMsg("Progression importée.");
          notify("Progression importée", "Ta partie a été restaurée");
        } else setImportMsg("Sauvegarde illisible ou d'un format inconnu.");
        return;
      }
      const items = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(items)) throw new Error("format");
      const n = importCustom(items);
      setImportMsg(n ? `${n} relevé${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""}.` : "Aucun relevé valide trouvé.");
      if (n) { setImportText(""); setImportOpen(false); notify("Import terminé", `${n} relevé${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} à la carte`); }
    } catch {
      setImportMsg("Texte illisible : colle l'export complet (format JSON).");
    }
  };
  useEffect(() => {
    loadMeta().then(setMeta);
  }, []);
  // Où vit réellement la sauvegarde : dit d'après le runtime, jamais supposé
  const [cloud, setCloud] = useState<boolean | null>(null);
  useEffect(() => {
    cloudDoc().then((d) => setCloud(!!d)).catch(() => setCloud(false));
  }, []);

  const journal = useMemo(() => buildJournal(state, feed), [state, feed]);
  const mainsDone = state.profile.missionsDone.length;
  const sidesDone = journal.filter((e) => e.kind === "activite").length;
  const current = state.profile.nextMission;

  // Anti-spoiler : baisser la protection demande une confirmation (même règle que le bouclier)
  const [spoilerAsk, setSpoilerAsk] = useState<SpoilerMode | null>(null);
  const pickSpoiler = (v: SpoilerMode) => {
    if (v === state.profile.spoilerMode) return;
    if (lowersProtection(state.profile.spoilerMode, v)) setSpoilerAsk(v);
    else setProfile({ spoilerMode: v });
  };

  return (
    <div className="screen profile partie">
      <header className="topbar">
        <div>
          <p className="eyebrow">Ma partie</p>
          <h1 className="h1">Partie</h1>
        </div>
      </header>

      <div className="profile__grid">
        <div className="home__col">
          <section className="card form" data-testid="my-progress">
            <h4>Ma progression</h4>
            <dl className="pstats">
              <div><dt>Chapitre</dt><dd data-testid="p-chapter">{CHAPTERS[state.profile.chapter]}</dd></div>
              <div><dt>{state.profile.missionInProgress ? "Mission en cours" : "Prochaine mission"}</dt><dd data-testid="p-current">{current ?? "Non renseignée"}</dd></div>
              <div><dt>Missions principales terminées</dt><dd data-testid="p-mains">{mainsDone}</dd></div>
              <div><dt>Missions annexes et activités</dt><dd data-testid="p-sides">{sidesDone}</dd></div>
            </dl>
            <p className="muted small">Uniquement ce que tu as déclaré : LEONIDA OS ne lit pas ta sauvegarde PS5 / Xbox.</p>
            <ChapterTransition />
            <h4>Chapitre atteint</h4>
            <div className="stepper stepper--7" role="radiogroup" aria-label="Progression narrative">
              {CHAPTER_LIST.map((c: Chapter) => (
                <button key={c} role="radio" aria-checked={state.profile.chapter === c} className={`${state.profile.chapter >= c ? "is-reached" : ""} ${state.profile.chapter === c ? "is-on" : ""}`} onClick={() => setProfile({ chapter: c })} data-testid={`chapter-${c}`}>
                  <span className="stepper__dot" />
                  <span title={CHAPTERS[c]}>{CHAPTER_SHORT[c]}</span>
                </button>
              ))}
            </div>
            <details className="pmore">
              <summary>Ajouter une mission terminée</summary>
              <form
                className="missionform"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (missionText.trim()) setMission(missionText.trim(), true);
                  setMissionText("");
                }}
              >
                <input list="missions-known" value={missionText} onChange={(e) => setMissionText(e.target.value)} placeholder={state.profile.lastMission ?? "Nom de la mission (ex. Tourist Trap)"} aria-label="Mission terminée" data-testid="mission-input" />
                <datalist id="missions-known">{knownMissions.map((m) => <option key={m} value={m} />)}</datalist>
                <button className="btn btn--sm btn--on" type="submit" data-testid="mission-save">Noter</button>
              </form>
            </details>
          </section>

          <Journal
            entries={journal}
            onUndo={(e) => {
              const u = e.undo;
              if (u.type === "done") setDone(u.key, false);
              else if (u.type === "vehicle") setVehicle(u.id, null);
              else if (u.type === "objective") toggleObjective(u.id);
              else if (u.type === "pin") setPin(u.id, null);
              else setMission(u.name, false);
              notify("Annulé", `${e.name} retiré de « Récupéré / Fait »`);
            }}
          />

          {owned.length > 0 && (
            <section className="card form" data-testid="my-garage">
              <h4>Mon garage</h4>
              <div className="inv">
                {owned.map((v) => {
                  const p = state.vehicles[v.id];
                  return (
                    <button key={v.id} className="inv__row" onClick={() => focusVehicle(v.id)} data-testid={`inv-${v.id}`}>
                      <span className={`inv__state inv__state--${p.state}`}>{STATE_FR[p.state]}</span>
                      <strong>{v.name}</strong>
                      <em>{v.type === "garage" ? "Garage" : p.storage ? `Rangé : ${p.storage}` : p.state === "stolen" ? "Pas encore conservé" : ""}</em>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="home__col">
          <details className="card form pfold" data-testid="settings" open>
            <summary><h4>Réglages</h4></summary>
            <h4>Anti-spoiler</h4>
            <Segmented<SpoilerMode>
              label="Mode anti-spoiler"
              value={state.profile.spoilerMode}
              onChange={pickSpoiler}
              options={[
                { id: "strict", label: "Strict" },
                { id: "relaxed", label: "Flouté" },
                { id: "off", label: "Désactivé" },
              ]}
            />
            {spoilerAsk ? (
              <div className="pconfirm" data-testid="spoiler-confirm">
                <p className="small">Réduire la protection ? Des noms ou détails de missions que tu n&apos;as pas encore jouées pourront apparaître.</p>
                <div className="row gap8">
                  <button className="btn btn--sm btn--on" onClick={() => { setProfile({ spoilerMode: spoilerAsk }); setSpoilerAsk(null); }} data-testid="spoiler-ok">Réduire</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setSpoilerAsk(null)} data-testid="spoiler-cancel">Garder</button>
                </div>
              </div>
            ) : (
              <p className="muted small">{state.profile.spoilerMode === "off" ? "Aucun filtre : tout est affiché, y compris les missions futures." : SPOILER_HINT[state.profile.spoilerMode]}</p>
            )}
            <h4>Édition du jeu</h4>
            <Segmented<EditionId> label="Édition" value={state.profile.edition} onChange={(v) => setProfile({ edition: v })} options={(Object.keys(EDITIONS) as EditionId[]).map((id) => ({ id, label: EDITIONS[id] }))} />
            <p className="muted small" data-testid="edition-note">
              {state.profile.edition === "ultimate" ? "Les véhicules, garages et bonus Ultimate vérifiés te sont proposés." : state.profile.edition === "standard" ? "Les exclusivités Ultimate vérifiées restent consultables mais ne te sont jamais recommandées." : "Tant que ton édition n'est pas renseignée, les exclusivités restent « compatibilité à vérifier »."}
            </p>
            <h4>Bonus de précommande</h4>
            <Segmented<"yes" | "no" | "unknown">
              label="Bonus de précommande"
              value={state.profile.preorder}
              onChange={(v) => setProfile({ preorder: v })}
              options={[
                { id: "yes", label: "J'y ai droit" },
                { id: "no", label: "Non" },
                { id: "unknown", label: "Je ne sais pas" },
              ]}
            />
            <label className="field">
              <span>Pseudo</span>
              <input value={state.profile.pseudo} maxLength={20} onChange={(e) => setProfile({ pseudo: e.target.value })} />
            </label>
          </details>

          <details className="card form pfold" data-testid="advanced">
            <summary><h4>Avancé</h4></summary>
            <h4>Sauvegarde</h4>
            <p className="small" data-testid="storage-note">
              {cloud === null
                ? "Vérification de l'emplacement de la sauvegarde…"
                : cloud
                  ? "Ta partie est enregistrée sur cet appareil et dans l'espace privé de cet Artifact lié à ton compte Claude : tu la retrouves sur ton iPhone et ton iPad. Personne d'autre n'y a accès."
                  : "Ta partie est enregistrée uniquement dans ce navigateur, sur cet appareil. Copie ta sauvegarde pour la garder ailleurs."}
            </p>
            <div className="row gap8 wrap">
              <button className="btn btn--ghost btn--sm" onClick={copyProgress} data-testid="export-progress"><Icon name="bookmark" size={15} /> Copier ma sauvegarde</button>
              <button className="btn btn--ghost btn--sm" onClick={() => { setImportOpen((v) => !v); setImportMsg(""); }} data-testid="import-open"><Icon name="plus" size={15} /> Restaurer / importer</button>
            </div>
            {exportText && (
              <label className="field">
                <span>Copie manuelle (sélectionne tout)</span>
                <textarea rows={4} readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
              </label>
            )}
            {importOpen && (
              <div className="form">
                <label className="field">
                  <span>Colle une sauvegarde ou un export de relevés (une sauvegarde remplace ta progression actuelle)</span>
                  <textarea rows={4} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"format":"leonida-os/progression", ...}' data-testid="import-text" />
                </label>
                <button className="btn btn--sm btn--on" onClick={doImport} disabled={!importText.trim()} data-testid="import-go">Importer</button>
              </div>
            )}
            {importMsg && <p className="small muted">{importMsg}</p>}

            <WebDiag />

            <h4><Icon name="flag" size={16} /> Mes relevés · {state.custom.length}</h4>
            <p className="small muted">Points ajoutés avec le Cartographe (Carte › menu).</p>
            {state.custom.length > 0 && (
              <div className="history">
                {state.custom.slice(-4).reverse().map((d) => (
                  <button key={d.id} className="hist" onClick={() => focusOnMap(d.id)}>
                    <CategoryGlyph id={d.category} size={28} />
                    <span className="hist__body"><strong>{d.title}</strong><span>{repo.regions().find((r) => r.id === d.regionId)?.name}</span></span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn--ghost btn--sm" onClick={copyExport} disabled={!state.custom.length}><Icon name="bookmark" size={15} /> Exporter mes relevés</button>

            <h4>Effets de verre</h4>
            <Segmented<GlassPref> label="Effets de verre" value={glass} onChange={(v) => { setGlass(v); setGlassPref(v); }} options={[{ id: "auto", label: "Auto" }, { id: "on", label: "Activés" }, { id: "off", label: "Réduits" }]} />
            <p className="muted small">Auto : le verre passe en version opaque si ton appareil perd des images pendant les transitions.</p>
            <label className="toggle">
              <input type="checkbox" checked={state.showDemo} onChange={(e) => setShowDemo(e.target.checked)} data-testid="toggle-demo" />
              <span className="toggle__ui" />
              <span>Mode démonstration (contenu fictif, jamais compté dans ta partie)</span>
            </label>
            {state.showDemo && (confirmReset ? (
              <div className="row gap8">
                <button className="btn btn--danger btn--sm" onClick={() => { reset(); setConfirmReset(false); }}>Confirmer</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(false)}>Annuler</button>
              </div>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}><Icon name="reset" size={15} /> Réinitialiser la démonstration (ta partie est conservée)</button>
            ))}

            <h4><Icon name="info" size={16} /> Crédits et version</h4>
            <p className="small" data-testid="partie-version">LEONIDA OS {APP_VERSION} · projet non officiel, sans lien avec Rockstar Games ni Take-Two.</p>
            <p className="small">{DATASET_INFO.disclaimer}</p>
            <p className="small">
              <strong>Carte et lieux :</strong> reconstitution communautaire <a href={GTADB_URL} target="_blank" rel="noreferrer">gtadb.org</a>, licence <a href={CC_BY_URL} target="_blank" rel="noreferrer">CC BY 4.0</a> (tuiles réassemblées et assombries, données réduites). Ce n&apos;est pas la carte officielle de Rockstar.
              {meta && <> {meta.landmarks.toLocaleString("fr-FR")} lieux · version du {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}.</>}
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}

const FILTERS: { id: string; label: string; kinds: JournalKind[] }[] = [
  { id: "all", label: "Tout", kinds: [] },
  { id: "armes", label: "Armes", kinds: ["arme"] },
  { id: "objets", label: "Objets", kinds: ["objet", "argent"] },
  { id: "decouvertes", label: "Découvertes", kinds: ["secret", "position"] },
  { id: "activites", label: "Missions annexes", kinds: ["activite", "objectif"] },
  { id: "vehicules", label: "Véhicules", kinds: ["vehicule"] },
  { id: "missions", label: "Missions", kinds: ["mission"] },
];

/** « Récupéré / Fait » : historique daté unifié, annulation propre à chaque type. */
function Journal({ entries, onUndo }: { entries: JournalEntry[]; onUndo: (e: JournalEntry) => void }) {
  const [filter, setFilter] = useState("all");
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const f = FILTERS.find((x) => x.id === filter)!;
  const list = f.kinds.length ? entries.filter((e) => f.kinds.includes(e.kind)) : entries;
  const shown = all ? list : list.slice(0, 8);
  const fmt = (at: string | null) => (at ? new Date(at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "date non enregistrée");
  return (
    <section className="card form" data-testid="journal">
      <h4>Récupéré / Fait · {entries.length}</h4>
      <div className="fchips" role="tablist" aria-label="Filtrer l'historique">
        {FILTERS.filter((x) => x.id === "all" || entries.some((e) => x.kinds.includes(e.kind))).map((x) => (
          <button key={x.id} role="tab" aria-selected={filter === x.id} className={`fchip${filter === x.id ? " is-on" : ""}`} onClick={() => { setFilter(x.id); setAll(false); }} data-testid={`journal-f-${x.id}`}>{x.label}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="muted small" data-testid="journal-empty">Rien de noté pour l&apos;instant. Touche « Fait » sur l&apos;accueil, le Guide ou la carte : chaque action arrive ici, datée, et reste annulable.</p>
      ) : (
        <ul className="jlist">
          {shown.map((e) => (
            <li key={e.id} className="jrow" data-testid={`journal-${e.id}`} data-kind={e.kind}>
              <span className="jrow__body">
                <strong>{e.name}</strong>
                <span>{JOURNAL_FR[e.kind].done} · {fmt(e.at)}</span>
              </span>
              {ask === e.id ? (
                <span className="row gap8">
                  <button className="btn btn--danger btn--sm" onClick={() => { onUndo(e); setAsk(null); }} data-testid="journal-undo-ok">Retirer</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setAsk(null)}>Garder</button>
                </span>
              ) : (
                <button className="btn btn--ghost btn--sm" onClick={() => (e.kind === "mission" ? setAsk(e.id) : onUndo(e))} data-testid="journal-undo">Annuler</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 8 && <button className="btn btn--ghost btn--sm" onClick={() => setAll((v) => !v)} data-testid="journal-all">{all ? "Réduire" : `Tout voir (${list.length})`}</button>}
    </section>
  );
}
