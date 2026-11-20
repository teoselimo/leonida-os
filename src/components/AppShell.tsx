"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { alerts } from "@/lib/engine";
import type { ViewId } from "@/lib/types";
import { HomeScreen } from "@/screens/HomeScreen";
import { MapScreen } from "@/screens/MapScreen";
import { RadarScreen } from "@/screens/RadarScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { Icon } from "./ui/Icon";

const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: "accueil", label: "Accueil", icon: "home" },
  { id: "carte", label: "Carte", icon: "map" },
  { id: "radar", label: "Radar", icon: "radar" },
  { id: "profil", label: "Profil", icon: "user" },
];

export function AppShell() {
  const { view, setView, hydrated, state, toast, dismissToast, undo, focusOnMap, discoveries, signals } = useStore();
  const scroller = useRef<HTMLElement>(null);
  const live = useLiveRadar();
  const radarBadge = live.feed
    ? live.feed.items.filter((r) => Date.now() - Date.parse(r.firstSeenAt) < 6 * 3600_000 && !(r.spoiler === "high" && state.profile.spoilerMode === "strict")).length
    : signals.filter((g) => !state.seenSignals.includes(g.id) && g.spoilerChapter <= state.profile.chapter).length;
  const homeBadge = alerts(discoveries, signals, state).filter((a) => a.level === "high").length;

  const [mapMounted, setMapMounted] = useState(view === "carte");
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    if (view === "carte") setMapMounted(true);
  }, [view]);

  return (
    <div className={`app ${hydrated ? "is-ready" : ""} view-${view}`}>
      <nav className="nav" aria-label="Navigation principale">
        <div className="nav__brand">
          <span className="logo">L</span>
          <span className="nav__name">LEONIDA<b>OS</b></span>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav__item ${view === n.id ? "is-on" : ""}`} onClick={() => setView(n.id)} aria-current={view === n.id ? "page" : undefined} data-testid={`nav-${n.id}`}>
            <span className="nav__icon">
              <Icon name={n.icon} size={22} />
              {n.id === "radar" && radarBadge > 0 && <i className="nav__badge">{radarBadge > 99 ? "99+" : radarBadge}</i>}
              {n.id === "accueil" && homeBadge > 0 && <i className="nav__badge nav__badge--dot" />}
            </span>
            <span className="nav__label">{n.label}</span>
          </button>
        ))}
        <div className="nav__foot">V0.5 · veille auto</div>
      </nav>

      <div className="stage">
        <main ref={scroller} className="main" hidden={view === "carte"}>
          <div className="viewin" key={view}>
            {view === "accueil" && <HomeScreen />}
            {view === "radar" && <RadarScreen />}
            {view === "profil" && <ProfileScreen />}
          </div>
        </main>
        {/* La carte reste montée une fois ouverte : MapLibre, la caméra et les filtres sont conservés entre les onglets. */}
        {mapMounted && (
          <section className={`maplayer ${view === "carte" ? "is-active" : ""}`} aria-hidden={view !== "carte"} data-testid="maplayer">
            <MapScreen active={view === "carte"} />
          </section>
        )}
      </div>

      {toast && (
        <div className="toast" key={toast.key} role="status" data-testid="toast">
          <span className="toast__icon"><Icon name={toast.icon ?? "check"} size={18} stroke={2.6} /></span>
          <span className="toast__body">
            <strong>{toast.title}</strong>
            {toast.body && <span>{toast.body}</span>}
          </span>
          {toast.nextId && (
            <button className="toast__btn toast__btn--accent" onClick={() => { focusOnMap(toast.nextId!); dismissToast(); }}>Suivante</button>
          )}
          {toast.undoId && <button className="toast__btn" onClick={() => undo(toast.undoId!)}>Annuler</button>}
        </div>
      )}
    </div>
  );
}
