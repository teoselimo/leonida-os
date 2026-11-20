"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { LIVE_CATEGORY, spoilerVisibility, tabOf, useLiveRadar } from "@/lib/live";
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
  const stale = Date.now() - Date.parse(feed.generatedAt) > 3 * 3600_000;
  return (
    <div className={`sync ${stale || state === "offline" ? "is-stale" : degraded ? "is-degraded" : ""}`} data-testid="sync-status">
      <button className="sync__main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="live" />
        <span>
          <strong>{state === "offline" ? "Hors ligne · dernières données connues" : stale ? "Synchronisation en retard" : "Veille automatique active"}</strong>
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
          <button className="btn btn--ghost btn--sm" onClick={() => refresh()}><Icon name="reset" size={14} /> Relire le flux</button>
          {fetchedAt && <p className="fineprint">Flux relu {timeAgo(fetchedAt)} · généré {timeAgo(feed.generatedAt)}</p>}
        </div>
      )}
    </div>
  );
}

function LiveCard({ r, blurred }: { r: RadarRecord; blurred: boolean }) {
  const [open, setOpen] = useState(false);
  const cat = LIVE_CATEGORY[r.category] ?? LIVE_CATEGORY.other;
  const lead = r.evidence[0];
  const sources = Array.from(new Set(r.evidence.map((e) => e.sourceName)));
  const title = (r as RadarRecord & { titleFr?: string }).titleFr ?? r.title;
  return (
    <article className={`signal live-card${Date.now() - Date.parse(r.firstSeenAt) < 6 * 3600_000 ? " is-new" : ""}`} data-testid={`live-${r.id}`}>
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

      {r.media && !blurred && (
        <a className="live-thumb" href={r.media.url} target="_blank" rel="noreferrer" aria-label="Voir la vidéo sur YouTube">
          {/* Miniature hébergée par YouTube (non copiée), créditée */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.media.thumbnail} alt="" loading="lazy" decoding="async" width={480} height={360} />
          <span className="live-thumb__play"><Icon name="arrow" size={18} /></span>
          <span className="live-thumb__credit">© {r.media.credit} · YouTube</span>
        </a>
      )}

      <h3>{blurred ? <SpoilerText strict={false} hint="Spoiler possible">{title}</SpoilerText> : title}</h3>
      {!blurred && <p className="muted">{lead.excerpt}</p>}

      <div className="live-tags">
        {r.status !== "active" && <span className="pill pill--locked">{STATUS_FR[r.status] ?? r.status}</span>}
        {r.location.precision !== "none" && (
          <span className="tagchip"><Icon name="map" size={12} /> {r.location.place ?? REGION_NAMES[r.location.regionId ?? ""] ?? "Lieu cité"}{r.location.precision === "validated" ? " · point vérifié" : " · non localisé"}</span>
        )}
        {r.conditions.money != null && <span className="tagchip">{r.conditions.money.toLocaleString("fr-FR")} $ cités</span>}
        {r.conditions.missable && <span className="tagchip tagchip--warn">Manquable (selon la source)</span>}
        {r.evidence.length > 1 && <span className="tagchip">{r.evidence.length} preuves</span>}
      </div>

      <div className="signal__actions">
        <a className="btn btn--sm btn--ghost" href={lead.url} target="_blank" rel="noreferrer" data-testid="open-proof"><Icon name="info" size={15} /> Ouvrir la preuve</a>
        {r.media && <a className="btn btn--sm btn--ghost" href={r.media.url} target="_blank" rel="noreferrer"><Icon name="arrow" size={15} /> Voir la vidéo</a>}
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Moins" : "Détails"}</button>
      </div>

      {open && (
        <div className="live-detail">
          <h4>Pourquoi ce statut</h4>
          <ul>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Sources ({r.evidence.length})</h4>
          <ul className="live-sources">
            {r.evidence.map((e) => (
              <li key={e.rawKey}>
                <a href={e.url} target="_blank" rel="noreferrer">{e.sourceName}</a> · {e.publishedAt ? new Date(e.publishedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "date inconnue"}
                {e.quotes.length > 0 && <q>{e.quotes.join(" … ")}</q>}
              </li>
            ))}
          </ul>
          <h4>Historique</h4>
          <ul>{r.revisions.slice(-4).reverse().map((v, i) => <li key={i}>{new Date(v.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — {v.reason}{v.changes.length ? ` (${v.changes.slice(0, 2).join(" ; ")})` : ""}</li>)}</ul>
          <div className="creator">
            <h4><Icon name="sparkle" size={14} /> ViceScopeIV · opportunité {r.opportunity.score}/100</h4>
            <p className="small muted">Angle « {r.opportunity.angle} » — brouillons à valider, jamais publiés automatiquement.</p>
            <ul>{r.opportunity.ideas.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <p className="fineprint">Fiche {r.id} · vérifiée {timeAgo(r.lastVerifiedAt)} · classement automatique, corrigeable par un administrateur.</p>
        </div>
      )}
    </article>
  );
}

export function LiveRadar() {
  const { feed } = useLiveRadar();
  const { state } = useStore();
  const [tab, setTab] = useState<LiveTab>("new");
  const items = feed?.items ?? [];

  const { list, hidden, counts } = useMemo(() => {
    const counts: Record<LiveTab, number> = { new: 0, confirmed: 0, verify: 0, news: 0 };
    let hidden = 0;
    const visible = items.filter((r) => {
      if (spoilerVisibility(r, state.profile.spoilerMode) === "hidden") {
        hidden++;
        return false;
      }
      return true;
    });
    visible.forEach((r) => tabOf(r).forEach((t) => counts[t]++));
    const list = visible.filter((r) => tabOf(r).includes(tab));
    if (tab === "new") list.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || b.score - a.score);
    return { list: list.slice(0, 60), hidden, counts };
  }, [items, state.profile.spoilerMode, tab]);

  return (
    <>
      <SyncStatus />
      <Segmented<LiveTab>
        label="Onglets du Radar"
        value={tab}
        onChange={setTab}
        options={[
          { id: "new", label: `Nouveau ${counts.new}` },
          { id: "confirmed", label: `Confirmé ${counts.confirmed}` },
          { id: "verify", label: `À vérifier ${counts.verify}` },
          { id: "news", label: `Actualités ${counts.news}` },
        ]}
      />
      {tab === "verify" && <div className="note"><Icon name="alert" size={16} /> Signalements et rumeurs non confirmés : ne pas les prendre pour des faits.</div>}
      <div className="signals" data-testid="live-list">
        {list.length === 0 && <div className="card empty">Rien dans cet onglet pour l&apos;instant.</div>}
        {list.map((r) => <LiveCard key={r.id} r={r} blurred={spoilerVisibility(r, state.profile.spoilerMode) === "blurred"} />)}
        {hidden > 0 && (
          <div className="note" data-testid="live-hidden"><Icon name="shield" size={16} /> {hidden} fiche{hidden > 1 ? "s" : ""} masquée{hidden > 1 ? "s" : ""} par l&apos;anti-spoiler strict.</div>
        )}
      </div>
    </>
  );
}
