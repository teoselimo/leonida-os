"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEMO_SEED_COMPLETED, DISCOVERIES, RADAR } from "@/data/demo";
import { progress, wouldUnlock } from "./engine";
import { asPlayerRecord, isValidRecordInput } from "./records";
import { liveToDiscoveries, useLiveRadar } from "./live";
import { demoRepository, localProgressStore } from "./repository";
import type { Discovery, PersistedState, Profile, RadarSignal, ViewId } from "./types";

const STORAGE_KEY = "leonida-os/progress/v1";
const persistence = localProgressStore<PersistedState>(STORAGE_KEY);
export const repo = demoRepository;

/** Fusionne les champs manquants et re-normalise les relevés (ex. V0.3 : relevés marqués « vérifié » à tort). */
export function migrate(saved: Partial<PersistedState>): PersistedState {
  const base = initialState();
  const custom = Array.isArray(saved.custom) ? (saved.custom as unknown[]).filter(isValidRecordInput).map((d) => asPlayerRecord(d)) : [];
  return { ...base, ...saved, profile: { ...base.profile, ...(saved.profile ?? {}) }, custom, schema: 1 };
}

export const initialState = (): PersistedState => ({
  schema: 1,
  profile: { pseudo: "Joueur", console: "ps5", edition: "standard", chapter: 1, spoilerMode: "strict" },
  completed: { ...DEMO_SEED_COMPLETED },
  trackedSignals: [],
  seenSignals: [],
  freshUnlocks: [],
  custom: [],
  showDemo: true,
});

type Action =
  | { type: "hydrate"; state: PersistedState }
  | { type: "complete"; id: string; at: string; unlocks: string[] }
  | { type: "undo"; id: string }
  | { type: "profile"; patch: Partial<Profile> }
  | { type: "track"; id: string }
  | { type: "seen"; ids: string[] }
  | { type: "reset" }
  | { type: "upsertCustom"; d: Discovery }
  | { type: "deleteCustom"; id: string }
  | { type: "importCustom"; items: Discovery[] }
  | { type: "showDemo"; value: boolean };

function reducer(s: PersistedState, a: Action): PersistedState {
  switch (a.type) {
    case "hydrate":
      return a.state;
    case "complete":
      return { ...s, completed: { ...s.completed, [a.id]: a.at }, freshUnlocks: a.unlocks };
    case "undo": {
      const { [a.id]: _removed, ...rest } = s.completed;
      return { ...s, completed: rest, freshUnlocks: [] };
    }
    case "profile":
      return { ...s, profile: { ...s.profile, ...a.patch } };
    case "track":
      return {
        ...s,
        trackedSignals: s.trackedSignals.includes(a.id) ? s.trackedSignals.filter((x) => x !== a.id) : [...s.trackedSignals, a.id],
      };
    case "seen":
      return { ...s, seenSignals: Array.from(new Set([...s.seenSignals, ...a.ids])) };
    case "reset":
      return { ...initialState(), custom: s.custom };
    case "upsertCustom": {
      const exists = s.custom.some((c) => c.id === a.d.id);
      return { ...s, custom: exists ? s.custom.map((c) => (c.id === a.d.id ? a.d : c)) : [...s.custom, a.d] };
    }
    case "deleteCustom": {
      const { [a.id]: _gone, ...completed } = s.completed;
      return {
        ...s,
        completed,
        freshUnlocks: s.freshUnlocks.filter((x) => x !== a.id),
        custom: s.custom
          .filter((c) => c.id !== a.id)
          .map((c) => ({ ...c, prerequisites: c.prerequisites.filter((p) => p.type !== "discovery" || p.id !== a.id) })),
      };
    }
    case "importCustom": {
      const byId = new Map(s.custom.map((c) => [c.id, c]));
      a.items.forEach((d) => byId.set(d.id, d));
      return { ...s, custom: Array.from(byId.values()) };
    }
    case "showDemo":
      return { ...s, showDemo: a.value, freshUnlocks: [] };
  }
}

export interface Toast {
  icon?: string;
  key: number;
  title: string;
  body?: string;
  undoId?: string;
  nextId?: string;
}

interface Ctx {
  state: PersistedState;
  /** Découvertes actives : démo (si affichée) + relevés du joueur. */
  discoveries: Discovery[];
  signals: RadarSignal[];
  saveCustom: (d: Discovery) => void;
  deleteCustom: (id: string) => void;
  importCustom: (items: unknown[]) => number;
  setShowDemo: (v: boolean) => void;
  notify: (title: string, body?: string, icon?: string) => void;
  hydrated: boolean;
  view: ViewId;
  setView: (v: ViewId) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Ouvre la carte, centre sur la découverte et ouvre sa fiche. */
  focusOnMap: (id: string) => void;
  focusNonce: number;
  complete: (id: string) => void;
  undo: (id: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  track: (id: string) => void;
  markSeen: (ids: string[]) => void;
  reset: () => void;
  toast: Toast | null;
  dismissToast: () => void;
}

const StoreContext = createContext<Ctx | null>(null);

const VIEWS: ViewId[] = ["accueil", "carte", "radar", "profil"];
const viewFromHash = (): ViewId => {
  const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  return (VIEWS as string[]).includes(h) ? (h as ViewId) : "accueil";
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [hydrated, setHydrated] = useState(false);
  const [view, setViewState] = useState<ViewId>("accueil");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydratation : progression locale + vue depuis l'ancre (#carte, #radar…)
  useEffect(() => {
    const saved = persistence.load();
    if (saved && saved.schema === 1) dispatch({ type: "hydrate", state: migrate(saved) });
    setViewState(viewFromHash());
    setHydrated(true);
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (hydrated) persistence.save(state);
  }, [state, hydrated]);

  const setView = useCallback((v: ViewId) => {
    setViewState(v);
    try {
      if (window.location.hash !== `#${v}`) window.history.replaceState(null, "", `#${v}`);
    } catch {
      /* certains cadres sandbox refusent replaceState */
    }
  }, []);

  const showToast = useCallback((t: Omit<Toast, "key">) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ...t, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 5200);
  }, []);

  const live = useLiveRadar();
  const liveDiscoveries = useMemo(() => liveToDiscoveries(live.feed), [live.feed]);
  const all = useMemo(() => [...(state.showDemo ? DISCOVERIES : []), ...liveDiscoveries, ...state.custom], [state.showDemo, state.custom, liveDiscoveries]);
  const signals = useMemo(() => (state.showDemo ? RADAR : []), [state.showDemo]);

  const complete = useCallback(
    (id: string) => {
      const d = all.find((x) => x.id === id);
      if (!d) return;
      const before = progress(all, state).pct;
      const unlocks = wouldUnlock(id, all, state).map((u) => u.id);
      const after = (progress(all, state).done + 1) / all.length;
      dispatch({ type: "complete", id, at: new Date().toISOString(), unlocks });
      const pctTxt = `${Math.round(before * 100)} % → ${Math.round(after * 100)} %`;
      showToast({
        title: `${d.title} terminée`,
        body: unlocks.length ? `${pctTxt} · ${unlocks.length} découverte${unlocks.length > 1 ? "s" : ""} débloquée${unlocks.length > 1 ? "s" : ""}` : `Progression ${pctTxt}`,
        undoId: id,
        nextId: unlocks[0],
      });
    },
    [all, state, showToast],
  );

  const value = useMemo<Ctx>(
    () => ({
      state,
      discoveries: all,
      signals,
      saveCustom: (d) => dispatch({ type: "upsertCustom", d }),
      deleteCustom: (id) => {
        dispatch({ type: "deleteCustom", id });
        setSelectedId(null);
        showToast({ title: "Relevé supprimé" });
      },
      importCustom: (items) => {
        const valid = (items as unknown[]).filter(isValidRecordInput);
        dispatch({ type: "importCustom", items: valid.map((d) => asPlayerRecord(d)) });
        return valid.length;
      },
      setShowDemo: (v) => dispatch({ type: "showDemo", value: v }),
      notify: (title, body, icon) => showToast({ title, body, icon }),
      hydrated,
      view,
      setView,
      selectedId,
      select: setSelectedId,
      focusOnMap: (id) => {
        setSelectedId(id);
        setFocusNonce((n) => n + 1);
        setView("carte");
      },
      focusNonce,
      complete,
      undo: (id) => {
        dispatch({ type: "undo", id });
        setToast(null);
      },
      setProfile: (patch) => dispatch({ type: "profile", patch }),
      track: (id) => dispatch({ type: "track", id }),
      markSeen: (ids) => dispatch({ type: "seen", ids }),
      reset: () => {
        persistence.clear();
        dispatch({ type: "reset" });
        setSelectedId(null);
        showToast({ title: "Progression de démo réinitialisée" });
      },
      toast,
      dismissToast: () => setToast(null),
    }),
    [state, all, signals, hydrated, view, setView, selectedId, focusNonce, complete, toast, showToast],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore doit être utilisé dans <StoreProvider>");
  return ctx;
}
