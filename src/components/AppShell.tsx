"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { applyGlass, sampleTransition } from "@/lib/glass";
import { AiCopilot } from "./AiCopilot";
import { BrandMark, CopilotGlyph } from "./Brand";
import { tick } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { alerts } from "@/lib/engine";
import type { ViewId } from "@/lib/types";
import { HomeScreen } from "@/screens/HomeScreen";
import { MapScreen } from "@/screens/MapScreen";
import { RadarScreen } from "@/screens/RadarScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { Icon } from "./ui/Icon";
import { APP_VERSION } from "@/lib/version";

/**
 * Navigation V0.14 : Accueil | Carte | LEONIDA | Guide | Partie. LEONIDA est une ACTION (ouvre le copilote), pas un onglet.
 * Les identifiants internes restent « radar » et « profil » : ancres (#radar, #profil) et actions existantes préservées.
 */
const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: "accueil", label: "Accueil", icon: "home" },
  { id: "carte", label: "Carte", icon: "map" },
  { id: "radar", label: "Guide", icon: "layers" },
  { id: "profil", label: "Partie", icon: "user" },
];
/** Position de la pastille active dans le dock à 5 positions (le centre est LEONIDA). */
const SLOT: Record<ViewId, number> = { accueil: 0, carte: 1, radar: 3, profil: 4 } as Record<ViewId, number>;

export function AppShell() {
  const { view, setView, hydrated, state, toast, dismissToast, undo, focusOnMap, discoveries, signals, celebration, aiOpen, setAiOpen } = useStore();
  // Sens de la transition entre onglets (comme une pile de navigation iOS)
  const order: ViewId[] = ["accueil", "carte", "radar", "profil"];
  const prev = useRef<ViewId>(view);
  const dir = Math.sign(order.indexOf(view) - order.indexOf(prev.current)) || 0;
  useEffect(() => {
    if (prev.current !== view) sampleTransition();
    prev.current = view;
  }, [view]);
  useEffect(() => applyGlass(), []);
  const scroller = useRef<HTMLElement>(null);
  const live = useLiveRadar();
  const radarBadge = live.feed
    ? live.feed.items.filter((r) => Date.now() - Date.parse(r.firstSeenAt) < 6 * 3600_000 && !(r.spoiler === "high" && state.profile.spoilerMode === "strict")).length
    : signals.filter((g) => !state.seenSignals.includes(g.id) && g.spoilerChapter <= state.profile.chapter).length;
  const homeBadge = state.showDemo ? alerts(discoveries, signals, state).filter((a) => a.level === "high").length : 0;

  const [mapMounted, setMapMounted] = useState(view === "carte");
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    if (view === "carte") setMapMounted(true);
  }, [view]);

  return (
    <div className={`app ${hydrated ? "is-ready" : ""} view-${view}`} style={{ ["--dir" as string]: dir }}>
      <nav className="nav nav5 glass" aria-label="Navigation principale" style={{ ["--idx" as string]: SLOT[view] ?? 0 }}>
        <div className="nav__brand">
          <BrandMark size={38} />
          <span className="nav__name">LEONIDA<b>OS</b></span>
        </div>
        <span className="nav__pill" aria-hidden />
        {NAV.map((n, i) => (
          <Fragment key={n.id}>
            {i === 2 && (
              <button key="ai" className={`nav__ai press${aiOpen ? " is-on" : ""}`} onClick={() => { tick(); setAiOpen(!aiOpen); }} aria-label="Ouvrir le copilote LEONIDA" aria-pressed={aiOpen} data-testid="ai-open">
                <span className="nav__aibtn"><CopilotGlyph size={24} /></span>
                <span className="nav__label">LEONIDA</span>
              </button>
            )}
            <button key={n.id} className={`nav__item ${view === n.id ? "is-on" : ""}`} onClick={() => { if (view !== n.id) tick(); setView(n.id); }} aria-current={view === n.id ? "page" : undefined} data-testid={`nav-${n.id}`}>
              <span className="nav__icon">
                <Icon name={n.icon} size={22} />
                {n.id === "accueil" && homeBadge > 0 && <i className="nav__badge nav__badge--dot" />}
              </span>
              <span className="nav__label">{n.label}</span>
            </button>
          </Fragment>
        ))}
        <div className="nav__foot" data-testid="app-version">{APP_VERSION}</div>
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

      <AiCopilot />

      {celebration && (
        <div className="celebrate" key={celebration.key} role="status" aria-live="polite" data-testid="celebrate">
          <span className="celebrate__ring" />
          <span className="celebrate__check"><Icon name="check" size={30} stroke={3} /></span>
          <span className="celebrate__label">{celebration.label}</span>
        </div>
      )}

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
          {toast.onUndo && <button className="toast__btn" onClick={() => { toast.onUndo!(); dismissToast(); }} data-testid="toast-undo">Annuler</button>}
        </div>
      )}
    </div>
  );
}
