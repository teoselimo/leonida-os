"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { answer, isValidAction, starters } from "@/lib/ai/engine";
import type { AiAction, AiAnswer, PlaceRef, Topic } from "@/lib/ai/engine";
import type { ProxyStatus } from "@/lib/ai/proxy";
import { askProxy, proxyEnabled } from "@/lib/ai/proxy";
import { lngLatToGame, loadLandmarks } from "@/lib/gtadb";
import { useIsTablet } from "@/lib/useMedia";
import { SPRINGS, spring, tick } from "@/lib/motion";
import type { SpringHandle } from "@/lib/motion";
import { Sheet } from "./Sheet";
import { BrandMark } from "./Brand";
import { Icon } from "./ui/Icon";

type AiMsg = { id: number; role: "ai"; a: AiAnswer; llm?: ProxyStatus | "pending" };
type Msg = { id: number; role: "user"; text: string } | AiMsg;
const HISTORY_KEY = "leonida-os/ai-history/v2";

function loadHistory(): Msg[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    // on ne garde que des messages au format actuel (l'ancien format « fiche » est abandonné)
    return Array.isArray(v) ? v.filter((m) => m && (m.role === "user" ? typeof m.text === "string" : typeof m.a?.text === "string")).slice(-40) : [];
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

const REL_CLS: Record<string, string> = { officiel: "official", recoupé: "confirmed", signalé: "reported", "non établi": "rumor", "déclaré par toi": "personal" };
const REL_FR: Record<string, string> = { officiel: "Information officielle", recoupé: "Recoupé par plusieurs sources", signalé: "Signalé par une source", "non établi": "Non établi", "déclaré par toi": "D’après ce que tu m’as dit" };

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
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMsgs(loadHistory()), []);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
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

  // Sujet de la conversation (dernière réponse) : permet « et comment je la garde ? »
  const topicOf = (list: Msg[]): Topic | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.role === "ai") return m.a.topic ?? null;
    }
    return null;
  };

  const ask = useCallback(
    async (q: string, forcedTopic?: Topic | null) => {
      const question = q.trim().slice(0, 300);
      if (!question) return;
      setText("");
      // repères gtadb (cache partagé avec la carte) : nécessaires pour proposer « voir sur la carte »
      const pl = places.length ? places : (await loadLandmarks()).map(({ id, name, district }) => ({ id, name, district }));
      const ctx = { feed, state, position: mapPosition(), places: pl };
      const topic: Topic | null = forcedTopic === undefined ? topicOf(msgsRef.current) : forcedTopic;
      const local = answer(question, ctx, topic);
      const a = { ...local, actions: local.actions.filter((x) => isValidAction(x, feed)).slice(0, 2) };
      const id = Date.now();
      // la réponse locale s'affiche tout de suite ; la synthèse serveur (si déployée) l'affine ensuite
      const remote = proxyEnabled() && !!(a.evidence ?? []).length;
      setMsgs((m) => [...m, { id, role: "user", text: question }, { id: id + 1, role: "ai", a, llm: remote ? "pending" : undefined }]);
      if (!remote) return;
      const r = await askProxy(question, state.profile, topic);
      setMsgs((m) =>
        m.map((x) => {
          if (x.id !== id + 1 || x.role !== "ai") return x;
          if (!("text" in r)) return { ...x, llm: r.status };
          const actions = r.actions.filter((y) => isValidAction(y, feed) && a.actions.some((z) => JSON.stringify(z) === JSON.stringify(y)));
          return { ...x, a: { ...x.a, text: r.text, actions: actions.length ? actions : x.a.actions }, llm: r.status };
        }),
      );
    },
    [feed, state, places],
  );

  // Questions lancées depuis l'accueil (amorces)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as string | { question: string; topic?: Topic | null };
      if (typeof d === "string") void ask(d);
      else if (d?.question) void ask(d.question, d.topic ?? null);
    };
    window.addEventListener("leonida:ask", h);
    return () => window.removeEventListener("leonida:ask", h);
  }, [ask]);

  const run = (a: AiAction, confirmed = false, key = "") => {
    tick();
    const needs = a.type === "mark_done" || a.type === "vehicle_state" || a.type === "set_mission" || a.type === "set_next_mission";
    if (needs && !confirmed) {
      setPending({ key, action: a });
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
      case "set_next_mission":
        store.setNextMission(a.name);
        store.celebrate("Prochaine mission enregistrée");
        break;
      case "ask":
        void ask(a.question);
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

  const lastAi = [...msgs].reverse().find((m): m is AiMsg => m.role === "ai");

  const body = (
    <div className="ai" data-testid="ai-panel">
      <header className="ai__head">
        <BrandMark size={30} />
        <div>
          <strong>LEONIDA AI</strong>
          <span data-testid="ai-mode">{proxyEnabled() ? "Données vérifiées + synthèse IA" : "Mode direct · données vérifiées, sans IA générative"}</span>
        </div>
        {msgs.length > 0 && <button className="link small" onClick={clear} data-testid="ai-clear">Effacer</button>}
        {isTablet && <button className="iconbtn" onClick={() => setAiOpen(false)} aria-label="Fermer LEONIDA AI"><Icon name="close" /></button>}
      </header>
      <div className="ai__list" ref={listRef} data-testid="ai-list">
        {msgs.length === 0 && (
          <div className="ai__intro">
            <p>Salut ! Dis-moi quelle mission tu vas lancer ou ce que tu cherches. Je réponds avec les fiches vérifiées de la veille, selon ton chapitre, ton édition et ce que tu as déjà fait.</p>
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
            <article key={m.id} className={`bubble bubble--ai${m.llm === "pending" ? " is-refining" : ""}`} data-testid="ai-answer" data-intent={m.a.intent} data-llm={m.llm ?? "off"}>
              <p className="bubble__text">{m.a.text}</p>
              {m.llm === "pending" && <span className="bubble__refine" aria-live="polite">Leonida affine sa réponse…</span>}
              {m.a.reliability && (
                <p className={`bubble__rel relchip--${REL_CLS[m.a.reliability]}`}><i />{REL_FR[m.a.reliability]}</p>
              )}
              {m.a.actions.length > 0 && (
                <div className="bubble__actions">
                  {m.a.actions.map((a, i) => {
                    const key = `${m.id}:${JSON.stringify(a)}`;
                    const asking = pending?.key === key && "confirm" in a;
                    return asking ? (
                      <span key={i} className="confirm" data-testid="ai-confirm">
                        <span>{(a as { confirm: string }).confirm}</span>
                        <button className="btn btn--primary btn--xs" onClick={() => run(a, true)}>Confirmer</button>
                        <button className="btn btn--ghost btn--xs" onClick={() => setPending(null)}>Annuler</button>
                      </span>
                    ) : (
                      <button key={i} className={`btn btn--xs press ${i === 0 ? "btn--on" : "btn--ghost"}`} onClick={() => run(a, false, key)} data-testid={`ai-action-${a.type}`}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {(m.a.more?.length ?? 0) > 0 && (
                <details className="bubble__more" data-testid="ai-more">
                  <summary>En savoir plus</summary>
                  <ul>{m.a.more!.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </details>
              )}
              {m.a.sources.length > 0 && (
                <details className="bubble__more" data-testid="ai-sources">
                  <summary>Sources et preuves ({m.a.sources.length})</summary>
                  <ul>
                    {m.a.sources.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>{s.when ? ` · ${s.when}` : ""}
                        {s.title && <em className="bubble__orig" lang="en">Titre d’origine : {s.title}</em>}
                        {s.quote && <q lang="en">{s.quote.slice(0, 220)}</q>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {m === lastAi && (m.a.replies?.length ?? 0) > 0 && (
                <div className="bubble__replies">
                  {m.a.replies!.map((r) => (
                    <button key={r} className="chip chip--reply press" onClick={() => ask(r)} data-testid="ai-reply">{r}</button>
                  ))}
                </div>
              )}
              {m.llm && m.llm !== "pending" && m.llm !== "generated" && m.llm !== "cached" && m.llm !== "skipped" && (
                <p className="bubble__note" data-testid="ai-llm-note">Réponse directe : la synthèse IA n’est pas disponible pour le moment.</p>
              )}
            </article>
          ),
        )}
      </div>
      <form
        className="ai__input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 300)} placeholder="Demande à Leonida…" enterKeyHint="send" aria-label="Question pour LEONIDA AI" data-testid="ai-input" maxLength={300} autoComplete="off" />
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
