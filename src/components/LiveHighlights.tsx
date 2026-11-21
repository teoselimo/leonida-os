"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { liveAdvice, LIVE_CATEGORY, readDoneAdvice, spoilerVisibility, useLiveRadar, writeDoneAdvice } from "@/lib/live";
import { CHAPTERS } from "@/lib/meta";
import { CollectorAlert } from "./LiveRadar";
import { vehicleRecommendations } from "@/lib/garage";
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
  const fresh = feed.items.filter((r) => r.status === "active" && spoilerVisibility(r, state.profile.spoilerMode, state.profile.chapter) === "visible");
  const official = fresh.filter((r) => r.reliability === "official").sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0];
  const missables = fresh.filter((r) => r.conditions.missable && (r.reliability === "official" || r.reliability === "confirmed" || r.reliability === "reported")).slice(0, 2);
  const newCount = fresh.filter((r) => Date.now() - Date.parse(r.firstSeenAt) < 24 * 3600_000).length;
  if (!official && !missables.length && !newCount) return <CollectorAlert />;
  return (
    <section data-testid="live-highlights">
      <CollectorAlert />
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

/**
 * « Que faire maintenant ? » côté veille : conseils tirés des fiches confirmées ou officielles,
 * filtrés par le chapitre du joueur et l'anti-spoiler. Chaque conseil renvoie à ses preuves.
 */
export function LiveAdvice() {
  const { feed } = useLiveRadar();
  const { state, setView, focusVehicle } = useStore();
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => setDone(readDoneAdvice()), []);
  const { now, later } = liveAdvice(feed, state.profile, done);
  const cars = vehicleRecommendations(feed?.vehicles ?? [], state, 2);
  if (!now.length && !cars.length) return null;
  const mark = (id: string) => {
    const next = [...done, id];
    setDone(next);
    writeDoneAdvice(next);
  };
  return (
    <section className="advice" data-testid="live-advice">
      <div className="shead">
        <h2>Que faire maintenant ? · d&apos;après la veille</h2>
        <span className="small muted">{CHAPTERS[state.profile.chapter as 0 | 1 | 2 | 3]}</span>
      </div>
      {now.slice(0, 3).map((r) => {
        const cat = LIVE_CATEGORY[r.category] ?? LIVE_CATEGORY.other;
        const a = r.advice!;
        return (
          <article key={r.id} className={`advice__item${a.urgency === "now" ? " is-urgent" : ""}`} data-testid={`advice-${r.id}`}>
            <span className="glyph" style={{ width: 34, height: 34, color: cat.color, background: `${cat.color}1f` }}><Icon name={cat.icon} size={17} /></span>
            <div className="advice__body">
              <div className="row gap8">
                <ReliabilityBadge r={r.reliability} />
                {a.urgency === "now" && <span className="pill pill--warn">À faire avant de continuer</span>}
              </div>
              <strong>{r.title}</strong>
              <p>{a.text}</p>
              <div className="row gap8 advice__actions">
                <a className="link" href={r.evidence[0].url} target="_blank" rel="noreferrer">{r.evidence.length} preuve{r.evidence.length > 1 ? "s" : ""}</a>
                <button className="link" onClick={() => setView("radar")}>Fiche complète</button>
                <button className="link" onClick={() => mark(r.id)} data-testid="advice-done">C&apos;est fait</button>
              </div>
            </div>
          </article>
        );
      })}
      {cars.map((x) => (
        <button key={x.v.id} className={`advice__item advice__car${x.urgent ? " is-urgent" : ""}`} onClick={() => focusVehicle(x.v.id)} data-testid={`car-advice-${x.v.id}`}>
          <span className="glyph" style={{ width: 34, height: 34, color: "#5AB8FF", background: "#5AB8FF1f" }}><Icon name="car" size={17} /></span>
          <span className="advice__body">
            <span className="row gap8">
              <ReliabilityBadge r={x.v.reliability} />
              {x.v.edition.exclusive === "ultimate" && <span className="edtag">ULTIMATE</span>}
              {x.urgent && <span className="pill pill--warn">À ne pas manquer</span>}
            </span>
            <strong>🚗 {x.v.name}</strong>
            <span className="small muted">{x.v.location.district ? `Zone : ${x.v.location.district}` : "Emplacement cité"} · récupérable maintenant</span>
          </span>
        </button>
      ))}
      {later > 0 && <p className="fineprint"><Icon name="shield" size={12} /> {later} autre{later > 1 ? "s" : ""} conseil{later > 1 ? "s" : ""} gardé{later > 1 ? "s" : ""} pour plus tard (chapitre suivant ou spoiler).</p>}
    </section>
  );
}
