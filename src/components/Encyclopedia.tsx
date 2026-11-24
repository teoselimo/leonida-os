"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { HUB_MISSIONS, HUB_META, hubChapterStats, HUB_GRAPH_IDS, entsText, flagText } from "@/lib/hub/missions";
import { loadHubCatalog, loadHubPlaces } from "@/lib/hub/data";
import type { HubCatalogItem, HubMission, HubPlaces } from "@/lib/hub/model";
import { computeProgress } from "@/lib/progress";
import { PROG_BY_ID } from "@/data/progression";
import { nk } from "@/lib/missions";
import { Icon } from "./ui/Icon";

/**
 * Encyclopédie (V0.20) : ce que le Data Hub sait du jeu, par catégorie, avec la source et la date de chaque fiche.
 * Anti-spoiler : missions et personnages des chapitres non atteints masqués (strict) ou réduits à un compte (léger).
 */
type Tab = "missions" | "weapon" | "character" | "property" | "activity" | "animal" | "radio" | "map";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "missions", label: "Missions" },
  { id: "weapon", label: "Armes" },
  { id: "character", label: "Personnages" },
  { id: "property", label: "Propriétés" },
  { id: "activity", label: "Activités" },
  { id: "animal", label: "Animaux" },
  { id: "radio", label: "Radio" },
  { id: "map", label: "Repères" },
];
const KIND_FR: Record<HubMission["kind"], string> = { main: "Principale", side: "Facultative", stranger: "Étrangers et fous", activity: "Activité" };
const STATUS_FR: Record<string, string> = { terminé: "Faite", "en cours": "En cours", accessible: "Accessible", "potentiellement accessible": "Probablement accessible", verrouillé: "Verrouillée", inconnu: "Disponibilité inconnue", "plus disponible": "Plus disponible", "probablement faite": "Probablement faite" };
const FIELD_FR: Record<string, string> = { category: "Type", manufacturer: "Fabricant", price: "Prix", howToGet: "Obtention", role: "Rôle", occupation: "Métier", location: "Lieu", aka: "Surnoms", affiliation: "Proches", propertyType: "Type", style: "Style", region: "Région", capacity: "Places de garage", howToUnlock: "Déblocage", occupants: "Occupants", group: "Groupe", class: "Classe", habitat: "Habitat", size: "Taille", sections: "Contenu", species: "Espèce" };

function val(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return v.toLocaleString("fr-FR");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${x}`).join(" · ");
  return String(v);
}

function MissionRow({ m, status, names, hideDetails }: { m: HubMission; status: string | null; names: Map<string, string>; hideDetails: boolean }) {
  const [open, setOpen] = useState(false);
  const inGraph = !!m.leonida?.progression;
  const graphId = HUB_GRAPH_IDS.get(m.id);
  const node = graphId ? PROG_BY_ID.get(graphId) : null;
  const audited = m.chapter === 2 ? node?.prereq : null;
  const after = (m.after ?? []).map((a) => names.get(a)).filter(Boolean);
  return (
    <li className="gl encm" data-testid={`enc-m-${m.id.split("/").pop()}`}>
      <button className="gl__row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="gl__ico encm__n">{m.number ?? "·"}</span>
        <span className="gl__body">
          <strong>{m.name}</strong>
          <em>{[node?.kind === "activity" ? "Activité" : KIND_FR[m.kind], m.jason && m.lucia ? "Jason et Lucia" : m.jason ? "Jason" : m.lucia ? "Lucia" : null, !hideDetails && m.money ? `${m.money.toLocaleString("fr-FR")} $` : null].filter(Boolean).join(" · ")}</em>
        </span>
        <span className="encm__badges">
          {m.pnr && <span className="trust trust--low">Non-retour</span>}
          {m.missable && <span className="trust trust--warn">Manquable</span>}
          {status && <span className={`trust trust--${status === "terminé" ? "ok" : status === "accessible" || status === "potentiellement accessible" ? "warn" : "low"}`}>{STATUS_FR[status] ?? status}</span>}
        </span>
      </button>
      {open && hideDetails && <p className="fineprint">Étapes et conséquences masquées pendant cette mission.</p>}
      {open && !hideDetails && (
        <div className="encm__body">
          {audited && <p><strong>Déblocage documenté</strong> · {[...audited.all.map((id) => PROG_BY_ID.get(id)?.name), audited.condition].filter(Boolean).join(" · ")} · {audited.sources.map((src, i) => <span key={src.url}>{i ? " / " : ""}<a href={src.url} target="_blank" rel="noreferrer">{src.name}</a></span>)}</p>}
          {!audited && after.length > 0 && <p><strong>Après :</strong> {after.join(", ")}{m.weak ? " (lien habituel, à confirmer)" : ""}{m.afterAllMains ? ` et les autres missions principales du chapitre ${m.afterAllMains}` : ""}</p>}
          {m.cond?.length ? <p><strong>Conditions :</strong> {m.cond.join(", ")}</p> : null}
          {m.giver?.length ? <p><strong>Donneur :</strong> {m.giver.join(", ")}</p> : null}
          {m.rewards?.length ? <p><strong>Récompenses :</strong> {m.rewards.map((r) => `${r.v} (${r.l})`).join(" ; ")}</p> : null}
          {m.g?.flags.some((f) => f.k === "manquable" || f.k === "choix" || f.k === "non-retour") ? (
            <ul className="encm__flags" data-testid="enc-flags">{m.g.flags.filter((f) => f.k !== "conseil").map((f, i) => <li key={i}>{flagText(f, false)}</li>)}</ul>
          ) : null}
          {m.g?.steps.length ? (
            <details className="encm__guide" data-testid="enc-guide">
              <summary>Déroulé en {m.g.steps.length} étapes (révèle la mission)</summary>
              <ol>{m.g.steps.map((st, i) => <li key={i}><b>{st.t}</b>{st.e ? <em> — {entsText(st.e)}</em> : null}{st.$?.length ? <em> · {st.$.map((x) => `${x.toLocaleString("fr-FR")} $`).join(", ")}</em> : null}{m.g!.flags.filter((f) => f.step === st.t).map((f, j) => <span key={j} className={`encm__flag encm__flag--${f.k}`}>{f.k}</span>)}</li>)}</ol>
              <p className="fineprint">Faits tirés de la soluce GTABase (titres d&apos;étapes, noms cités, montants) — le texte de la soluce n&apos;est pas repris.</p>
            </details>
          ) : m.objectives?.length ? <p><strong>Objectifs :</strong> {m.objectives.join(" → ")}</p> : null}
          {m.req100 != null && <p><strong>Requise pour 100 % :</strong> {m.req100 ? "oui" : "non"}</p>}
          <p className="fineprint">
            {audited ? "Fiche et objectifs · " : inGraph ? "Prérequis audités par LEONIDA (prioritaires) · " : "Prérequis lus sur GTABase (une source) · "}
            <a href={m.url} target="_blank" rel="noreferrer">GTABase</a>{m.mod ? `, fiche du ${new Date(m.mod).toLocaleDateString("fr-FR")}` : ""}
          </p>
        </div>
      )}
    </li>
  );
}

export function Encyclopedia() {
  const { state } = useStore();
  const p = state.profile;
  const [tab, setTab] = useState<Tab>("missions");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<HubCatalogItem[] | null>(null);
  const [places, setPlaces] = useState<HubPlaces | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (tab === "missions" || cat) return;
    loadHubCatalog().then((r) => (setCat(r.data), setFailed(!r.ok)));
    if (!places) loadHubPlaces().then((r) => setPlaces(r.data));
  }, [tab, cat, places]);
  const v = useMemo(() => computeProgress(state), [state]);
  const names = useMemo(() => new Map(HUB_MISSIONS.map((m) => [m.id, m.name])), []);
  const n = nk(q);

  // anti-spoiler : chapitre atteint et précédents ; « léger » = compte des chapitres suivants ; « désactivé » = tout
  const visibleChapter = (c?: number) => c == null || c <= p.chapter || p.spoilerMode === "off";
  const missions = HUB_MISSIONS.filter((m) => m.kind !== "activity" && (!n || nk(m.name + " " + (m.giver ?? []).join(" ")).includes(n)));
  const chapters = [...new Set(missions.map((m) => m.chapter ?? 0))].sort((a, b) => a - b);
  const statusOf = (m: HubMission) => {
    const id = HUB_GRAPH_IDS.get(m.id);
    const st = id && PROG_BY_ID.get(id) ? v.byId.get(id) : null;
    return st ? (st.likelyDone ? "probablement faite" : st.status) : null;
  };

  const items = (cat ?? []).filter((c) => c.t === (tab === "map" ? "map-feature" : tab));
  const activities = HUB_MISSIONS.filter((m) => m.kind === "activity");
  const charVisible = (c: HubCatalogItem) => {
    if (p.spoilerMode === "off" || c.lk?.knowledge) return true;
    const ch = (c.rel ?? []).filter((r) => r.k === "appears_in").map((r) => HUB_MISSIONS.find((m) => m.id === r.to)?.chapter).filter((x): x is number => x != null);
    return ch.length > 0 && Math.min(...ch) <= p.chapter;
  };
  const shownItems = items.filter((c) => (tab !== "character" || charVisible(c)) && (!n || nk(c.n + " " + val(c.f)).includes(n)));
  const hiddenChars = tab === "character" ? items.filter((c) => !charVisible(c)).length : 0;
  const total = HUB_META.counts;

  return (
    <div className="enc" data-testid="encyclopedia">
      <p className="guide__fresh" data-testid="enc-fresh">
        <Icon name="clock" size={13} /> Data Hub : GTABase lu le {HUB_META.gtabase.discoveredAt ? new Date(HUB_META.gtabase.discoveredAt).toLocaleDateString("fr-FR") : "?"} ({HUB_META.gtabase.read ?? 0} pages, {HUB_META.gtabase.failed ?? 0} échec) · GTADB révision {HUB_META.gtadb.revision || "?"} du {HUB_META.gtadb.revisionDate ? new Date(HUB_META.gtadb.revisionDate).toLocaleDateString("fr-FR") : "?"}
      </p>
      <div className="guide__search">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mission, arme, personnage, lieu…" aria-label="Rechercher dans l'encyclopédie" data-testid="enc-search" />
        {q && <button onClick={() => setQ("")} aria-label="Effacer"><Icon name="close" size={14} /></button>}
      </div>
      <div className="guide__cats" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`fchip${tab === t.id ? " is-on" : ""}`} onClick={() => setTab(t.id)} data-testid={`enc-tab-${t.id}`}>{t.label}</button>
        ))}
      </div>

      {tab === "missions" && (
        <>
          <p className="fineprint" data-testid="enc-coverage">
            {total.missions} missions et {total.strangers} missions « étrangers et fous » connues · chapitre 1 audité par LEONIDA, chapitre 2 audité par fiche, autres chapitres issus de GTABase.
          </p>
          {chapters.map((c) => {
            const strictMotel = p.spoilerMode === "strict" && c === 2 && p.chapter === 2;
            const declared = new Set([...p.missionsDone, p.lastMission, p.nextMission].filter((x): x is string => !!x).map(nk));
            const ms = missions.filter((m) => (m.chapter ?? 0) === c && (!strictMotel || [m.name, ...(m.aliases ?? [])].some((name) => declared.has(nk(name)))));
            const st = hubChapterStats(c);
            if (!visibleChapter(c))
              return (
                <section key={c} className="enc__ch" data-testid={`enc-ch-${c}`}>
                  <h3>Chapitre {c}</h3>
                  <p className="muted small">{p.spoilerMode === "strict" ? "Masqué par l'anti-spoiler strict." : `${st.total} missions, dont ${st.missable} manquables et ${st.pnr} point(s) de non-retour — noms masqués (chapitre non atteint).`}</p>
                </section>
              );
            return (
              <section key={c} className="enc__ch" data-testid={`enc-ch-${c}`}>
                <h3>{c === 0 ? "Hors chapitre" : `Chapitre ${c}`} <em>{st.total} missions · {st.withPrereq} avec prérequis GTABase{st.pnr ? ` · ${st.pnr} non-retour` : ""}</em></h3>
                <ul className="glist">{ms.map((m) => <MissionRow key={m.id} m={m} status={statusOf(m)} names={names} hideDetails={strictMotel && statusOf(m) !== "terminé"} />)}</ul>
              </section>
            );
          })}
        </>
      )}

      {tab === "activity" && (
        <ul className="glist" data-testid="enc-list">
          {activities.filter((m) => !n || nk(m.name).includes(n)).map((m) => (
            <li key={m.id} className="gl"><a className="gl__row" href={m.url} target="_blank" rel="noreferrer"><span className="gl__ico"><Icon name="target" size={16} /></span><span className="gl__body"><strong>{m.name}</strong><em>{[m.location, m.cond?.join(", ")].filter(Boolean).join(" · ") || "Activité libre"}</em></span><span className="trust trust--warn">GTABase</span></a></li>
          ))}
        </ul>
      )}

      {tab !== "missions" && tab !== "activity" && (
        cat == null ? (
          <p className="card empty">Chargement…</p>
        ) : (
          <>
            {failed && <p className="note"><Icon name="alert" size={15} /> Catalogue indisponible (fichier non chargé).</p>}
            <p className="fineprint" data-testid="enc-count">{shownItems.length} fiche{shownItems.length > 1 ? "s" : ""}{hiddenChars ? ` · ${hiddenChars} personnage(s) masqué(s) par l'anti-spoiler` : ""}</p>
            <ul className="glist" data-testid="enc-list">
              {shownItems.slice(0, 120).map((c) => (
                <li key={c.id} className="gl" data-testid={`enc-i-${c.id.split("/").pop()}`}>
                  <a className="gl__row" href={c.u} target="_blank" rel="noreferrer">
                    <span className="gl__ico"><Icon name={tab === "weapon" ? "target" : tab === "property" ? "home" : tab === "character" ? "user" : tab === "map" ? "map" : "info"} size={16} /></span>
                    <span className="gl__body">
                      <strong>{c.n}</strong>
                      <em>{Object.entries(c.f ?? {}).filter(([k]) => k !== "sections" && k !== "stats").slice(0, 3).map(([k, x]) => `${FIELD_FR[k] ?? k} : ${val(x)}`).join(" · ") || "Fiche GTABase"}</em>
                    </span>
                    <span className="trust trust--warn">{c.mod ? new Date(c.mod).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "GTABase"}</span>
                  </a>
                </li>
              ))}
            </ul>
            {tab === "map" && places && (
              <p className="fineprint" data-testid="enc-unplaced">GTADB : {places.unplaced.length} lieux connus sans position (jamais placés au hasard) · {places.photosInGame} repères avec photo en jeu chez GTADB (non intégrées : voir docs/V0.20.md).</p>
            )}
          </>
        )
      )}
    </div>
  );
}
