"use client";

import { useEffect, useMemo, useState } from "react";
import { DATASET_INFO } from "@/data/demo";
import { CC_BY_URL, GTADB_URL, loadMeta } from "@/lib/gtadb";
import type { GtadbMeta } from "@/lib/gtadb";
import { progress } from "@/lib/engine";
import { CATEGORIES, CHAPTER_LIST, CHAPTER_SHORT, CHAPTERS, CONSOLES, EDITIONS } from "@/lib/meta";
import { useLiveRadar } from "@/lib/live";
import { STATE_FR } from "@/lib/garage";
import { repo, useStore } from "@/lib/store";
import type { Chapter, ConsoleId, EditionId, SpoilerMode } from "@/lib/types";
import { ShieldChip } from "@/components/ShieldChip";
import { Icon } from "@/components/ui/Icon";
import { Bar, CategoryGlyph, SectionHead, Segmented } from "@/components/ui/primitives";

export function ProfileScreen() {
  const { state, setProfile, focusOnMap, reset, discoveries: all, setShowDemo, importCustom, notify, focusVehicle } = useStore();
  const { feed } = useLiveRadar();
  const owned = (feed?.vehicles ?? []).filter((v) => state.vehicles[v.id]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [meta, setMeta] = useState<GtadbMeta | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const exportJson = () =>
    JSON.stringify({ format: "leonida-os/releves", version: 1, exportedAt: new Date().toISOString(), items: state.custom }, null, 1);
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
  const p = useMemo(() => progress(all, state), [all, state]);
  const history = Object.entries(state.completed)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([id, at]) => ({ d: all.find((x) => x.id === id)!, at }))
    .filter((h) => h.d);
  const initials = state.profile.pseudo.trim().slice(0, 2).toUpperCase() || "J";

  return (
    <div className="screen profile">
      <header className="topbar">
        <div>
          <p className="eyebrow">Profil joueur</p>
          <h1 className="h1">Profil</h1>
        </div>
        <ShieldChip />
      </header>

      <div className="profile__grid">
        <div className="home__col">
          <section className="card idcard">
            <div className="avatar">{initials}</div>
            <div className="idcard__body">
              <label className="field">
                <span>Pseudo</span>
                <input value={state.profile.pseudo} maxLength={20} onChange={(e) => setProfile({ pseudo: e.target.value })} />
              </label>
              <p className="muted small">{p.done} découvertes · {Math.round(p.pct * 100)} % exploré</p>
            </div>
          </section>

          <section className="card form">
            <h4>Console</h4>
            <Segmented<ConsoleId> label="Console" value={state.profile.console} onChange={(v) => setProfile({ console: v })} options={(Object.keys(CONSOLES) as ConsoleId[]).map((id) => ({ id, label: CONSOLES[id] }))} />
            <h4>Édition du jeu</h4>
            <Segmented<EditionId> label="Édition" value={state.profile.edition} onChange={(v) => setProfile({ edition: v })} options={(Object.keys(EDITIONS) as EditionId[]).map((id) => ({ id, label: EDITIONS[id] }))} />
            <p className="muted small" data-testid="edition-note">
              {state.profile.edition === "ultimate" ? "Les véhicules, garages et bonus Ultimate vérifiés te sont proposés." : state.profile.edition === "standard" ? "Les exclusivités Ultimate vérifiées restent consultables mais ne te sont jamais recommandées." : "Tant que ton édition n'est pas renseignée, les exclusivités restent « compatibilité à vérifier »."} Ta progression est conservée si tu changes.
            </p>
          </section>

          <section className="card form">
            <h4>Progression narrative</h4>
            <p className="muted small">Détermine ce que la veille peut te montrer sans spoiler : un conseil ou une fiche rattachés à un chapitre plus avancé restent masqués.</p>
            <div className="stepper stepper--7" role="radiogroup" aria-label="Progression narrative">
              {CHAPTER_LIST.map((c: Chapter) => (
                <button key={c} role="radio" aria-checked={state.profile.chapter === c} className={`${state.profile.chapter >= c ? "is-reached" : ""} ${state.profile.chapter === c ? "is-on" : ""}`} onClick={() => setProfile({ chapter: c })} data-testid={`chapter-${c}`}>
                  <span className="stepper__dot" />
                  <span title={CHAPTERS[c]}>{CHAPTER_SHORT[c]}</span>
                </button>
              ))}
            </div>
            <h4>Anti-spoiler</h4>
            <Segmented<SpoilerMode>
              label="Mode anti-spoiler"
              value={state.profile.spoilerMode}
              onChange={(v) => setProfile({ spoilerMode: v })}
              options={[
                { id: "strict", label: "Strict — tout masquer" },
                { id: "relaxed", label: "Modéré — flouter" },
              ]}
            />
          </section>

          <section className="card form" data-testid="my-garage">
            <h4>Mon garage</h4>
            {owned.length === 0 ? (
              <p className="muted small">Aucun véhicule suivi. Ouvre Carte › 🚗 Voitures cachées et marque ce que tu repères, voles et conserves.</p>
            ) : (
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
            )}
          </section>
        </div>

        <div className="home__col">
          <section>
            <SectionHead title="Collection" />
            <div className="collection">
              {p.byCategory.map((c) => (
                <div key={c.id} className="coll">
                  <CategoryGlyph id={c.id} size={34} />
                  <div className="coll__body">
                    <span>{CATEGORIES[c.id].plural}</span>
                    <Bar value={c.total ? c.done / c.total : 0} color={CATEGORIES[c.id].color} />
                  </div>
                  <strong>{c.done}<small>/{c.total}</small></strong>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHead title="Historique" />
            <div className="history" data-testid="history">
              {history.length === 0 && <div className="card empty">Aucune découverte terminée pour l&apos;instant.</div>}
              {history.map(({ d, at }) => (
                <button key={d.id} className="hist" onClick={() => focusOnMap(d.id)}>
                  <span className="hist__line" />
                  <CategoryGlyph id={d.category} size={30} />
                  <span className="hist__body">
                    <strong>{d.title}</strong>
                    <span>{repo.regions().find((r) => r.id === d.regionId)!.name} · {new Date(at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          </section>

          <section className="card carto">
            <h4><Icon name="flag" size={16} /> Mes relevés · {state.custom.length}</h4>
            <p className="small muted">Les points ajoutés en mode cartographe (carte › Cartographe). Ils comptent dans ta progression et tes recommandations.</p>
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
            <label className="toggle">
              <input type="checkbox" checked={state.showDemo} onChange={(e) => setShowDemo(e.target.checked)} data-testid="toggle-demo" />
              <span className="toggle__ui" />
              <span>Afficher les données de démo</span>
            </label>
            <div className="row gap8 wrap">
              <button className="btn btn--ghost btn--sm" onClick={copyExport} disabled={!state.custom.length}><Icon name="bookmark" size={15} /> Copier l&apos;export</button>
              <button className="btn btn--ghost btn--sm" onClick={() => { setImportOpen((v) => !v); setImportMsg(""); }}><Icon name="plus" size={15} /> Importer</button>
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
                  <span>Colle un export LEONIDA OS</span>
                  <textarea rows={4} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"format":"leonida-os/releves", ...}' />
                </label>
                <button className="btn btn--sm btn--on" onClick={doImport} disabled={!importText.trim()}>Importer</button>
              </div>
            )}
            {importMsg && <p className="small muted">{importMsg}</p>}
          </section>

          <section className="card data">
            <h4><Icon name="info" size={16} /> {DATASET_INFO.label} · {DATASET_INFO.version}</h4>
            <p className="small">{DATASET_INFO.disclaimer}</p>
            <p className="small"><strong>Faits officiels utilisés :</strong></p>
            <ul className="small">
              {DATASET_INFO.officialFacts.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <p className="small">
              <strong>Carte et lieux :</strong> reconstitution communautaire <a href={GTADB_URL} target="_blank" rel="noreferrer">gtadb.org</a>, licence <a href={CC_BY_URL} target="_blank" rel="noreferrer">CC BY 4.0</a> (tuiles réassemblées et assombries, données réduites). Ce n&apos;est pas la carte officielle de Rockstar.
              {meta && <> {meta.landmarks.toLocaleString("fr-FR")} lieux · version du {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}.</>}
            </p>
            <p className="small muted">Progression enregistrée sur cet appareil (stockage local du navigateur).</p>
            {confirmReset ? (
              <div className="row gap8">
                <button className="btn btn--danger btn--sm" onClick={() => { reset(); setConfirmReset(false); }}>Confirmer la réinitialisation</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(false)}>Annuler</button>
              </div>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}><Icon name="reset" size={15} /> Réinitialiser la démo</button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
