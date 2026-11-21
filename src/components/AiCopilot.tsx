"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { answer, isValidAction, starters } from "@/lib/ai/engine";
import type { AiAction, AiAnswer, PlaceRef } from "@/lib/ai/engine";
import { askProxy, proxyEnabled } from "@/lib/ai/proxy";
import { lngLatToGame, loadLandmarks } from "@/lib/gtadb";
import { useIsTablet } from "@/lib/useMedia";
import { SPRINGS, spring, tick } from "@/lib/motion";
import type { SpringHandle } from "@/lib/motion";
import { Sheet } from "./Sheet";
import { BrandMark } from "./Brand";
import { Icon } from "./ui/Icon";

type Msg = { id: number; role: "user"; text: string } | { id: number; role: "ai"; a: AiAnswer };
const HISTORY_KEY = "leonida-os/ai-history/v1";

function loadHistory(): Msg[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(v) ? v.slice(-40) : [];
  } catch {
    return [];
  }
}

/** Position de la carte (centre de la dernière vue) en coordonnées de jeu, pour « près de moi ». */
function mapPosition(): { x: number; y: number } | null {
  try {
    const c = JSON.parse(localStorage.getItem("leonida-os/map-camera/v1") || "null");
    if (!c?.center) return null;
    const [x, y] = lngLatToGame(c.center[0], c.center[1]);
    return { x, y };
  } catch {
    return null;
  }
}

const REL_CLS: Record<string, string> = { officiel: "official", recoupé: "confirmed", signalé: "reported", "non établi": "rumor" };

/**
 * LEONIDA AI : accès permanent et discret (pas d'onglet).
 * iPhone : fiche conversationnelle glissante. iPad : panneau latéral qui laisse la carte utilisable.
 * L'ouverture ne touche jamais à la carte (MapLibre reste monté, caméra et filtres conservés).
 */
export function AiCopilot() {
  const store = useStore();
  const { state, aiOpen, setAiOpen, view } = store;
  const { feed } = useLiveRadar();
  const isTablet = useIsTablet();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ key: string; action: AiAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMsgs(loadHistory()), []);
  const [places, setPlaces] = useState<PlaceRef[]>([]);
  useEffect(() => {
    if (aiOpen && !places.length) void loadLandmarks().then((l) => setPlaces(l.map(({ id, name, district }) => ({ id, name, district }))));
  }, [aiOpen, places.length]);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-40)));
    } catch {
      /* stockage plein : l'historique reste en mémoire */
    }
  }, [msgs]);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: msgs.length > 1 ? "smooth" : "auto" });
  }, [msgs, aiOpen]);

  const ask = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question) return;
      // repères gtadb (cache partagé avec la carte) : nécessaires pour proposer « voir sur la carte »
      const pl = places.length ? places : (await loadLandmarks()).map(({ id, name, district }) => ({ id, name, district }));
      const ctx = { feed, state, position: mapPosition(), places: pl };
      let a = answer(question, ctx);
      setMsgs((m) => [...m, { id: Date.now(), role: "user", text: question }]);
      setText("");
      // Synthèse IA facultative (proxy serveur) seulement si la recherche locale ne trouve rien
      if (proxyEnabled() && (a.intent === "unknown" || a.intent === "search")) {
        setBusy(true);
        const p = await askProxy(question, ctx, a).catch(() => null);
        setBusy(false);
        if (p) a = p;
      }
      a = { ...a, actions: a.actions.filter((x) => isValidAction(x, feed)) };
      setMsgs((m) => [...m, { id: Date.now() + 1, role: "ai", a }]);
    },
    [feed, state, places],
  );

  // Questions lancées depuis l'accueil (amorces)
  useEffect(() => {
    const h = (e: Event) => void ask(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("leonida:ask", h);
    return () => window.removeEventListener("leonida:ask", h);
  }, [ask]);

  const run = (a: AiAction, confirmed = false) => {
    tick();
    const needs = a.type === "mark_done" || a.type === "vehicle_state" || a.type === "set_mission";
    if (needs && !confirmed) {
      setPending({ key: JSON.stringify(a), action: a });
      return;
    }
    setPending(null);
    // Sur iPhone, une action vers la carte ou le radar referme la fiche : la conversation est conservée
    const leave = () => !isTablet && setAiOpen(false);
    switch (a.type) {
      case "focus_vehicle":
        store.focusVehicle(a.id);
        leave();
        break;
      case "open_map":
        store.setGarage({ on: !!a.garage, filter: a.filter ?? null });
        store.selectVehicle(null);
        store.setView("carte");
        leave();
        break;
      case "show_place":
        store.showPlace({ landmarkId: a.landmarkId, district: a.district });
        leave();
        break;
      case "open_record":
        store.openRecord(a.id);
        leave();
        break;
      case "filter_radar":
        store.filterRadar(a.category);
        leave();
        break;
      case "open_source":
        window.open(a.url, "_blank", "noopener,noreferrer");
        break;
      case "mark_done":
        store.setDone(a.id, true);
        store.celebrate("Activité terminée");
        break;
      case "vehicle_state":
        store.setVehicle(a.id, a.state);
        store.celebrate(a.state === "spotted" ? "Véhicule repéré" : "Véhicule mis à jour");
        break;
      case "set_mission":
        store.setMission(a.name, true);
        store.celebrate("Mission notée");
        break;
    }
  };

  const clear = () => {
    setMsgs([]);
    setPending(null);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* rien à effacer */
    }
  };

  const body = (
    <div className="ai" data-testid="ai-panel">
      <header className="ai__head">
        <BrandMark size={30} />
        <div>
          <strong>LEONIDA AI</strong>
          <span>{proxyEnabled() ? "Guides collectés + synthèse IA" : "Réponses tirées des guides collectés"}</span>
        </div>
        {msgs.length > 0 && <button className="link small" onClick={clear} data-testid="ai-clear">Effacer</button>}
        {isTablet && <button className="iconbtn" onClick={() => setAiOpen(false)} aria-label="Fermer LEONIDA AI"><Icon name="close" /></button>}
      </header>
      <div className="ai__list" ref={listRef} data-testid="ai-list">
        {msgs.length === 0 && (
          <div className="ai__intro">
            <p>Pose une question sur ta partie : je réponds avec les fiches de la veille, en tenant compte de ton chapitre, de ton édition et de ce que tu as déjà fait.</p>
            <div className="ai__starters">
              {starters({ feed, state }).map((q) => (
                <button key={q} className="chip press" onClick={() => ask(q)} data-testid="ai-starter">{q}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="bubble bubble--me">{m.text}</div>
          ) : (
            <article key={m.id} className="bubble bubble--ai" data-testid="ai-answer" data-intent={m.a.intent}>
              <strong className="bubble__title">{m.a.title}</strong>
              {m.a.lines.length > 0 && <ul>{m.a.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              {(m.a.reliability || m.a.sources.length > 0) && (
                <div className="bubble__meta">
                  {m.a.reliability && <span className={`relchip relchip--${REL_CLS[m.a.reliability]}`}>{m.a.reliability}</span>}
                  {m.a.sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name}{s.when ? ` · ${s.when}` : ""}</a>
                  ))}
                </div>
              )}
              {m.a.note && <p className="bubble__note"><Icon name="info" size={12} /> {m.a.note}</p>}
              {m.a.actions.length > 0 && (
                <div className="bubble__actions">
                  {m.a.actions.map((a, i) => {
                    const key = JSON.stringify(a);
                    const ask = pending?.key === key && "confirm" in a;
                    return ask ? (
                      <span key={i} className="confirm" data-testid="ai-confirm">
                        <span>{(a as { confirm: string }).confirm}</span>
                        <button className="btn btn--primary btn--xs" onClick={() => run(a, true)}>Confirmer</button>
                        <button className="btn btn--ghost btn--xs" onClick={() => setPending(null)}>Annuler</button>
                      </span>
                    ) : (
                      <button key={i} className={`btn btn--xs press ${i === 0 ? "btn--on" : "btn--ghost"}`} onClick={() => run(a)} data-testid={`ai-action-${a.type}`}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          ),
        )}
        {busy && <div className="bubble bubble--ai bubble--typing"><i /><i /><i /></div>}
      </div>
      <form
        className="ai__input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Demande à Leonida…" enterKeyHint="send" aria-label="Question pour LEONIDA AI" data-testid="ai-input" maxLength={300} />
        <button type="submit" className="ai__send press" disabled={!text.trim()} aria-label="Envoyer"><Icon name="arrow" size={18} /></button>
      </form>
    </div>
  );

  return (
    <>
      {!aiOpen && (
        <button className={`aifab glass press view-${view}`} onClick={() => { tick(); setAiOpen(true); }} data-testid="ai-open" aria-label="Demander à Leonida">
          <BrandMark size={24} />
          <span>Demander à Leonida</span>
        </button>
      )}
      {aiOpen && !isTablet && (
        <div className="ailayer">
          <Sheet tall initial="full" onClose={() => setAiOpen(false)} testId="ai-sheet" label="LEONIDA AI">
            {body}
          </Sheet>
        </div>
      )}
      {isTablet && <AiSidePanel open={aiOpen}>{body}</AiSidePanel>}
    </>
  );
}

/** Panneau iPad : glisse depuis la droite avec un ressort ; la carte reste visible et manipulable à gauche. */
function AiSidePanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useRef(1);
  const anim = useRef<SpringHandle | null>(null);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    anim.current?.cancel();
    const w = el.offsetWidth + 24;
    anim.current = spring(x.current, open ? 0 : 1, 0, SPRINGS.smooth, (v) => {
      x.current = v;
      el.style.transform = `translate3d(${v * w}px, 0, 0)`;
    }, () => !open && setMounted(false));
  }, [open, mounted]);
  if (!mounted) return null;
  return (
    <aside ref={ref} className="aiside glass" style={{ transform: "translate3d(110%, 0, 0)" }} aria-label="LEONIDA AI" data-testid="ai-side">
      {children}
    </aside>
  );
}
