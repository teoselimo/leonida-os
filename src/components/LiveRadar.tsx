"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { frHeadline, frSummary } from "@/lib/fr";
import { glossaryOf } from "@/lib/missions";
import { useStore } from "@/lib/store";
/** Build de l'Artifact : flux = instantané daté embarqué (NEXT_PUBLIC_FEED_SNAPSHOT=1). */
const FEED_SNAPSHOT = process.env.NEXT_PUBLIC_FEED_SNAPSHOT === "1";
import { collectorHealth, LIVE_CATEGORY, proposePointUrl, spoilerVisibility, tabOf, TRIGGER_FR, useLiveRadar } from "@/lib/live";
import { assetUrl } from "@/lib/gtadb";
import type { LiveTab, RadarRecord } from "@/lib/live";
import { timeAgo } from "@/lib/useMedia";
import { ReliabilityBadge, Segmented, SpoilerText } from "./ui/primitives";
import { Icon } from "./ui/Icon";

const REGION_NAMES: Record<string, string> = { vicecity: "Vice City", keys: "Leonida Keys", grassrivers: "Grassrivers", gellhorn: "Port Gellhorn", ambrosia: "Ambrosia", kalaga: "Mount Kalaga" };
const STATUS_FR: Record<string, string> = { disputed: "Contesté", outdated: "Périmé" };

/** Indicateur de synchronisation : dernière collecte serveur + état de chaque source. */
export function SyncStatus() {
  const { feed, state, fetchedAt, refresh } = useLiveRadar();
  const [open, setOpen] = useState(false);
  if (!feed) return null;
  const ok = feed.sources.filter((s) => s.status === "ok").length;
  const degraded = feed.sources.filter((s) => s.status === "degraded").length;
  const lastSync = feed.sources.map((s) => s.lastSuccessAt).filter(Boolean).sort().pop() ?? feed.generatedAt;
  const health = collectorHealth(feed);
  if (FEED_SNAPSHOT) {
    // Pilote Artifact : le flux est un instantané daté embarqué, jamais présenté comme « en direct »
    return (
      <div className="sync is-stale" data-testid="sync-status">
        <div className="sync__main">
          <span className="live live--off" />
          <span>
            <strong>Instantané de la veille</strong>
            <em>Données collectées le {new Date(feed.generatedAt).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {feed.items.length} fiches · mises à jour à chaque nouvelle version de l&apos;Artifact (l&apos;app GitHub Pages reste en direct)</em>
          </span>
        </div>
      </div>
    );
  }
  const stale = health.level !== "ok";
  const cycles = (feed.health?.cycles ?? []).slice(-8).reverse();
  return (
    <div className={`sync ${stale || state === "offline" ? "is-stale" : degraded ? "is-degraded" : ""}`} data-testid="sync-status">
      <button className="sync__main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="live" />
        <span>
          <strong>{state === "offline" ? "Hors ligne · dernières données connues" : health.level === "stopped" ? "Collecteur arrêté" : health.level === "late" ? "Collecte en retard" : "Veille automatique active"}</strong>
          <em>Dernière collecte {timeAgo(lastSync)} · {ok}/{feed.sources.length} sources OK{degraded ? ` · ${degraded} en difficulté` : ""}{feed.lastRun ? ` · ${feed.lastRun.newItems} nouveauté${feed.lastRun.newItems > 1 ? "s" : ""}` : ""}</em>
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
      {open && (
        <div className="sync__list">
          {feed.sources.map((s) => (
            <div key={s.id} className={`srcrow srcrow--${s.status}`}>
              <i />
              <span className="srcrow__name">{s.name}{s.official && <b> · officiel</b>}</span>
              <span className="srcrow__detail">{s.status === "ok" ? `OK · ${s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : ""}` : s.statusDetail}</span>
            </div>
          ))}
          {cycles.length > 0 && (
            <div className="cycles" data-testid="cycles">
              <h4>Derniers cycles du collecteur</h4>
              {cycles.map((c) => (
                <div key={c.at} className={`cycle cycle--${c.trigger}`}>
                  <span>{new Date(c.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <b>{TRIGGER_FR[c.trigger] ?? c.trigger}</b>
                  <em>{c.sourcesOk}/{c.sourcesAttempted} sources · +{c.newItems}{c.deepReads ? ` · ${c.deepReads} lus` : ""}{c.merged ? ` · ${c.merged} fusion` : ""}</em>
                </div>
              ))}
              <p className="fineprint">{health.lastCron ? `Dernier cycle planifié ${timeAgo(health.lastCron)} · ${health.cronCount24h} en 24 h` : "Aucun cycle planifié enregistré pour l'instant"} · cadence prévue {health.cadence} min</p>
            </div>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => refresh()}><Icon name="reset" size={14} /> Relire le flux</button>
          {fetchedAt && <p className="fineprint">Flux relu {timeAgo(fetchedAt)} · généré {timeAgo(feed.generatedAt)}</p>}
        </div>
      )}
    </div>
  );
}

/** Bandeau d'alerte : flux non renouvelé (collecteur en retard ou arrêté). Silencieux quand tout va bien. */
export function CollectorAlert() {
  const { feed, state } = useLiveRadar();
  if (!feed) return null;
  if (FEED_SNAPSHOT) {
    const days = Math.floor((Date.now() - Date.parse(feed.generatedAt)) / 86_400_000);
    return (
      <div className="collector-alert collector-alert--snapshot" role="status" data-testid="snapshot-banner">
        <Icon name="info" size={16} />
        <span>
          <strong>Instantané du {new Date(feed.generatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</strong> — les découvertes plus récentes sont dans l&apos;app en direct{days >= 2 ? ` (instantané vieux de ${days} jours)` : ""}.
        </span>
      </div>
    );
  }
  const h = collectorHealth(feed);
  if (h.level === "ok" && state !== "offline") return null;
  const age = h.ageMin < 120 ? `${h.ageMin} min` : `${Math.round(h.ageMin / 60)} h`;
  return (
    <div className={`collector-alert collector-alert--${state === "offline" ? "offline" : h.level}`} role="status" data-testid="collector-alert">
      <Icon name="alert" size={16} />
      <span>
        <strong>{state === "offline" ? "Pas de connexion au flux" : h.level === "stopped" ? "Veille arrêtée" : "Veille en retard"}</strong>
        {state === "offline" ? " — affichage des dernières données connues." : ` — aucune nouvelle collecte depuis ${age} (prévu toutes les ${h.cadence} min). Les informations peuvent être périmées.`}
      </span>
    </div>
  );
}

const fmtDate = (d: string) => new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Fiche structurée : chaque champ affiche sa valeur et le nombre de sources ; un champ non établi reste vide. */
function FactSheet({ r }: { r: RadarRecord }) {
  const d = r.details;
  const [open, setOpen] = useState<string | null>(null);
  if (!d) return null;
  type Row = { k: string; label: string; value: string | null; field: { support: { sourceName: string; url: string; quote: string }[]; conflicts: { sourceName: string; quote: string }[] } | null; warn?: boolean };
  const rows: Row[] = [
    { k: "money", label: "Récompense", value: r.conditions.reward, field: d.money },
    { k: "place", label: "Lieu", value: r.location.place, field: d.place },
    { k: "mission", label: "Mission / contexte", value: d.mission ? `${d.mission.value}${d.giver ? ` (${d.giver.value})` : ""}` : d.giver ? `Via ${d.giver.value}` : null, field: d.mission ?? d.giver },
    { k: "unlock", label: "Accès", value: d.unlockAfter ? `Après « ${d.unlockAfter.value} »` : null, field: d.unlockAfter },
    { k: "chapter", label: "Chapitre", value: d.chapter ? `Chapitre ${d.chapter.value}` : null, field: d.chapter },
    {
      k: "missable",
      label: "Risque de manquer",
      value: d.contextMissable ? `${d.contextMissable.value.subject ? `« ${d.contextMissable.value.subject} »` : "La mission"} disparaît${d.contextMissable.value.until ? ` au lancement de « ${d.contextMissable.value.until} »` : ""}${d.missable?.value === false ? " · le lieu reste accessible" : ""}` : d.missable ? (d.missable.value ? "Manquable" : "Non manquable") : null,
      field: d.contextMissable ?? d.missable,
      warn: !!d.contextMissable || d.missable?.value === true,
    },
  ];
  return (
    <div className="factsheet" data-testid="fact-sheet">
      {rows.map((row) => (
        <div key={row.k} className={`fsrow${row.value ? "" : " is-empty"}${row.warn ? " is-warn" : ""}`}>
          <span className="fsrow__label">{row.label}</span>
          {row.value ? (
            <button className="fsrow__value" onClick={() => setOpen(open === row.k ? null : row.k)} aria-expanded={open === row.k}>
              {row.value}
              <small>{row.field ? `${row.field.support.length} source${row.field.support.length > 1 ? "s" : ""}` : ""}{row.field?.conflicts.length ? " · contesté" : ""}</small>
            </button>
          ) : (
            <span className="fsrow__value">— non établi</span>
          )}
          {open === row.k && row.field && (
            <div className="fsrow__proof">
              {row.field.support.map((p) => <q key={p.url + p.quote}><a href={p.url} target="_blank" rel="noreferrer">{p.sourceName}</a> « {p.quote} »</q>)}
              {row.field.conflicts.map((p) => <q key={"c" + p.quote} className="is-conflict">Contredit par {p.sourceName} : « {p.quote} »</q>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const cleanName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "");

function LiveCard({ r, blurred, focused }: { r: RadarRecord; blurred: boolean; focused?: boolean }) {
  const [open, setOpen] = useState(!!focused);
  const ref = useRef<HTMLElement>(null);
  const { state, setDone, celebrate } = useStore();
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);
  const cat = LIVE_CATEGORY[r.category] ?? LIVE_CATEGORY.other;
  const lead = r.evidence[0];
  const sources = Array.from(new Set(r.evidence.map((e) => cleanName(e.sourceName))));
  const { feed } = useLiveRadar();
  const title = frHeadline(r, glossaryOf(feed));
  const isDone = !!state.done[r.id];
  return (
    <article ref={ref} className={`signal live-card${Date.now() - Date.parse(r.firstSeenAt) < 6 * 3600_000 ? " is-new" : ""}${focused ? " is-focused" : ""}${isDone ? " is-done" : ""}`} data-testid={`live-${r.id}`}>
      <div className="signal__top">
        <span className="glyph" style={{ width: 36, height: 36, color: cat.color, background: `${cat.color}1f`, boxShadow: `inset 0 0 0 1px ${cat.color}40` }}>
          <Icon name={cat.icon} size={18} />
        </span>
        <div className="signal__meta">
          <span style={{ color: cat.color }}>{cat.label}</span>
          <span className="dot" />
          <span>{sources[0]}{sources.length > 1 ? ` +${sources.length - 1}` : ""}</span>
          <span className="dot" />
          <span>{timeAgo(r.publishedAt ?? r.firstSeenAt)}</span>
        </div>
        <ReliabilityBadge r={r.reliability} />
      </div>

      {r.capture && !blurred && (
        <figure className="live-thumb live-thumb--capture">
          {/* Capture personnelle (droits détenus) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl(r.capture.src)} alt={r.capture.alt ?? ""} loading="lazy" decoding="async" />
          <span className="live-thumb__credit">Capture © {r.capture.credit}</span>
        </figure>
      )}
      {r.media && !r.capture && !blurred && (
        <a className="live-thumb" href={r.media.url} target="_blank" rel="noreferrer" aria-label="Voir la vidéo sur YouTube">
          {/* Miniature hébergée par YouTube (non copiée), créditée */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.media.thumbnail} alt="" loading="lazy" decoding="async" width={480} height={360} />
          <span className="live-thumb__play"><Icon name="arrow" size={18} /></span>
          <span className="live-thumb__credit">© {r.media.credit} · YouTube</span>
        </a>
      )}

      <h3>{blurred ? <SpoilerText strict={false} hint="Spoiler possible">{title}</SpoilerText> : title}</h3>
      {!blurred && (r.category === "news" || r.category === "patch") && title !== r.title && <p className="small muted live-orig" lang="en">Titre d’origine (en anglais) : {r.title}</p>}
      {!blurred && <p className="muted" data-testid="live-summary">{frSummary(r)}</p>}
      {!blurred && <FactSheet r={r} />}

      <div className="live-tags">
        {r.status !== "active" && <span className="pill pill--locked">{STATUS_FR[r.status] ?? r.status}</span>}
        {r.location.precision !== "none" && !r.details?.place && (
          <span className="tagchip"><Icon name="map" size={12} /> {r.location.place ?? REGION_NAMES[r.location.regionId ?? ""] ?? "Lieu cité"}{r.location.precision === "validated" ? " · point vérifié" : " · non localisé"}</span>
        )}
        {r.conditions.money != null && !r.details?.money && <span className="tagchip">{r.conditions.money.toLocaleString("fr-FR")} $ cités</span>}
        {r.conditions.missable && <span className="tagchip tagchip--warn">Manquable (selon la source)</span>}
        {r.evidence.length > 1 && <span className="tagchip">{r.evidence.length} preuves</span>}
      </div>

      <div className="signal__actions">
        <a className="btn btn--sm btn--ghost" href={lead.url} target="_blank" rel="noreferrer" data-testid="open-proof"><Icon name="info" size={15} /> Ouvrir la preuve</a>
        {r.media && <a className="btn btn--sm btn--ghost" href={r.media.url} target="_blank" rel="noreferrer"><Icon name="arrow" size={15} /> Voir la vidéo</a>}
        {r.location.precision === "named-place" && r.actionable && (
          <a className="btn btn--sm btn--ghost" href={proposePointUrl(r)} target="_blank" rel="noreferrer" data-testid="propose-point" title="Aucune épingle n'est posée sans validation">
            <Icon name="map" size={15} /> {r.location.suggestion ? "Valider le point proposé" : "Proposer le point"}
          </a>
        )}
        {(r.actionable || r.details) && (
          <button className={`btn btn--sm ${isDone ? "btn--on" : "btn--ghost"}`} onClick={() => { setDone(r.id, !isDone); if (!isDone) celebrate("Activité terminée"); }} data-testid="record-done" aria-pressed={isDone}>
            <Icon name="check" size={15} /> {isDone ? "Fait" : "C'est fait"}
          </button>
        )}
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Moins" : "Détails"}</button>
      </div>

      {open && (
        <div className="live-detail">
          <h4>Pourquoi ce statut</h4>
          <ul>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Sources et preuves ({r.evidence.length}) — textes d’origine en anglais</h4>
          <ul className="live-sources">
            {r.evidence.map((e) => (
              <li key={e.rawKey}>
                <a href={e.url} target="_blank" rel="noreferrer">{cleanName(e.sourceName)}</a> · {e.publishedAt ? fmtDate(e.publishedAt) : "date inconnue"}
                <em className="small muted live-orig" lang="en"> · Titre d’origine : {e.title}</em>
                {e.deep && <span className="small muted"> · {e.deep.ok ? `article lu ${timeAgo(e.deep.at)}${e.deep.aiOptOut ? " · IA exclue (souhait du site)" : ""}` : `non lu : ${e.deep.reason}`}</span>}
                {e.quotes.length > 0 && <q>{e.quotes.join(" … ")}</q>}
              </li>
            ))}
          </ul>
          <h4>Historique</h4>
          <ul>{r.revisions.slice(-4).reverse().map((v, i) => <li key={i}>{new Date(v.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — {v.reason}{v.changes.length ? ` (${v.changes.slice(0, 2).join(" ; ")})` : ""}</li>)}</ul>
          <div className="creator">
            <h4><Icon name="sparkle" size={14} /> Idées de vidéo · intérêt {r.opportunity.score}/100</h4>
            <p className="small muted">Angle « {r.opportunity.angle} » — brouillons, jamais publiés automatiquement.</p>
            <ul>{r.opportunity.ideas.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <p className="fineprint">Vérifiée {timeAgo(r.lastVerifiedAt)} · classement automatique.</p>
        </div>
      )}
    </article>
  );
}

export function LiveRadar() {
  const { feed } = useLiveRadar();
  const { state, radarFocus, filterRadar } = useStore();
  const [tab, setTab] = useState<LiveTab>("new");
  const focusRec = radarFocus.id ? items0(feed).find((r) => r.id === radarFocus.id) ?? null : null;
  const cat = radarFocus.category;
  useEffect(() => {
    if (focusRec) setTab(tabOf(focusRec)[tabOf(focusRec).length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarFocus.nonce]);
  const items = feed?.items ?? [];

  const { list, hidden, counts } = useMemo(() => {
    const counts: Record<LiveTab, number> = { new: 0, confirmed: 0, verify: 0, news: 0 };
    let hidden = 0;
    const visible = items.filter((r) => {
      if (spoilerVisibility(r, state.profile.spoilerMode, state.profile.chapter) === "hidden") {
        hidden++;
        return false;
      }
      return true;
    });
    const scoped = cat ? visible.filter((r) => r.category === cat) : visible;
    scoped.forEach((r) => tabOf(r).forEach((t) => counts[t]++));
    const list = cat ? scoped : scoped.filter((r) => tabOf(r).includes(tab));
    if (tab === "new") list.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || b.score - a.score);
    return { list: list.slice(0, 60), hidden, counts };
  }, [items, state.profile.spoilerMode, state.profile.chapter, tab, cat]);

  return (
    <>
      <CollectorAlert />
      <SyncStatus />
      {cat && (
        <div className="catfilter" data-testid="radar-category">
          <span>Filtre : {LIVE_CATEGORY[cat]?.label ?? cat}</span>
          <button className="link small" onClick={() => filterRadar(null)}>Tout afficher</button>
        </div>
      )}
      {!cat && <Segmented<LiveTab>
        label="Onglets du Radar"
        value={tab}
        onChange={setTab}
        options={[
          { id: "new", label: `Nouveau ${counts.new}` },
          { id: "confirmed", label: `Confirmé ${counts.confirmed}` },
          { id: "verify", label: `À vérifier ${counts.verify}` },
          { id: "news", label: `Actualités ${counts.news}` },
        ]}
      />}
      {tab === "verify" && <div className="note"><Icon name="alert" size={16} /> Signalements et rumeurs non confirmés : ne pas les prendre pour des faits.</div>}
      <div className="signals" data-testid="live-list">
        {list.length === 0 && <div className="card empty">Rien dans cet onglet pour l&apos;instant.</div>}
        {focusRec && !list.some((r) => r.id === focusRec.id) && spoilerVisibility(focusRec, state.profile.spoilerMode, state.profile.chapter) !== "hidden" && (
          <LiveCard key={`f-${focusRec.id}`} r={focusRec} focused blurred={false} />
        )}
        {list.map((r) => <LiveCard key={r.id} r={r} focused={r.id === radarFocus.id} blurred={spoilerVisibility(r, state.profile.spoilerMode, state.profile.chapter) === "blurred"} />)}
        {hidden > 0 && (
          <div className="note" data-testid="live-hidden"><Icon name="shield" size={16} /> {hidden} fiche{hidden > 1 ? "s" : ""} masquée{hidden > 1 ? "s" : ""} par l&apos;anti-spoiler strict (fin d&apos;histoire ou chapitre plus avancé que le tien).</div>
        )}
      </div>
    </>
  );
}

function items0(feed: ReturnType<typeof useLiveRadar>["feed"]) {
  return feed?.items ?? [];
}
