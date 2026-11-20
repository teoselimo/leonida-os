"use client";

import { useStore } from "@/lib/store";
import { spoilerVisibility, useLiveRadar } from "@/lib/live";
import { timeAgo } from "@/lib/useMedia";
import { ReliabilityBadge } from "./ui/primitives";
import { Icon } from "./ui/Icon";

/**
 * Accueil : la nouveauté officielle la plus récente (avec visuel si disponible) et les alertes « manquable »
 * étayées par une source. Le reste des nouveautés non validées reste dans Radar › À vérifier.
 */
export function LiveHighlights() {
  const { feed } = useLiveRadar();
  const { state, setView } = useStore();
  if (!feed) return null;
  const fresh = feed.items.filter((r) => r.status === "active" && spoilerVisibility(r, state.profile.spoilerMode) === "visible");
  const official = fresh.filter((r) => r.reliability === "official").sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0];
  const missables = fresh.filter((r) => r.conditions.missable && (r.reliability === "official" || r.reliability === "confirmed" || r.reliability === "reported")).slice(0, 2);
  const newCount = fresh.filter((r) => Date.now() - Date.parse(r.firstSeenAt) < 24 * 3600_000).length;
  if (!official && !missables.length && !newCount) return null;
  return (
    <section data-testid="live-highlights">
      <div className="shead">
        <h2>Veille GTA VI</h2>
        <button className="link" onClick={() => setView("radar")}>Radar <Icon name="chevronRight" size={14} /></button>
      </div>
      {official && (
        <a className="livehero" href={official.media?.url ?? official.evidence[0].url} target="_blank" rel="noreferrer">
          {official.media && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={official.media.thumbnail} alt="" loading="lazy" decoding="async" />
          )}
          <span className="livehero__body">
            <span className="row gap8"><ReliabilityBadge r="official" /><em>{timeAgo(official.publishedAt ?? official.firstSeenAt)}</em></span>
            <strong>{official.title}</strong>
            <span className="muted small">{official.evidence[0].sourceName}{official.media ? ` · © ${official.media.credit}` : ""}</span>
          </span>
        </a>
      )}
      {missables.map((r) => (
        <button key={r.id} className="alert alert--high" onClick={() => setView("radar")}>
          <span className="alert__dot" />
          <span className="alert__body"><strong>Manquable · {r.title}</strong><span>{r.reliability === "reported" ? "Signalé par une source, non confirmé" : "Confirmé"}</span></span>
          <Icon name="chevronRight" size={16} />
        </button>
      ))}
      {newCount > 0 && (
        <button className="alert alert--info" onClick={() => setView("radar")} data-testid="live-new-count">
          <span className="alert__dot" />
          <span className="alert__body"><strong>{newCount} nouveauté{newCount > 1 ? "s" : ""} détectée{newCount > 1 ? "s" : ""} en 24 h</strong><span>Classées par fiabilité : officiel, confirmé, à vérifier</span></span>
          <Icon name="chevronRight" size={16} />
        </button>
      )}
    </section>
  );
}
