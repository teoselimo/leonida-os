"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEMO_SEED_COMPLETED, DISCOVERIES, RADAR } from "@/data/demo";
import { progress, wouldUnlock } from "./engine";
import { asPlayerRecord, isValidRecordInput } from "./records";
import { liveToDiscoveries, useLiveRadar } from "./live";
import { demoRepository, localProgressStore } from "./repository";
import { cloudLoad, cloudSave } from "./runtime/cloud";
import type { Discovery, PersistedState, Profile, RadarSignal, VehicleProgress, VehicleState, ViewId } from "./types";

const STORAGE_KEY = "leonida-os/progress/v1";
const SAVED_AT_KEY = "leonida-os/progress-saved-at/v1";
const persistence = localProgressStore<PersistedState>(STORAGE_KEY);
export const repo = demoRepository;

/** Fusionne les champs manquants et re-normalise les relevés (ex. V0.3 : relevés marqués « vérifié » à tort). */
export function migrate(saved: Partial<PersistedState>): PersistedState {
  const base = initialState();
  const custom = Array.isArray(saved.custom) ? (saved.custom as unknown[]).filter(isValidRecordInput).map((d) => asPlayerRecord(d)) : [];
  const profile = { ...base.profile, ...(saved.profile ?? {}) };
  // V0.6 : l'ancienne valeur « spéciale / collector » ne correspond à aucune édition réelle → à renseigner
  if (!["standard", "ultimate", "unknown"].includes(profile.edition as string)) profile.edition = "unknown";
  const vehicles = saved.vehicles && typeof saved.vehicles === "object" ? saved.vehicles : {};
  if (!["yes", "no", "unknown"].includes(profile.preorder as string)) profile.preorder = "unknown";
  if (!Array.isArray(profile.missionsDone)) profile.missionsDone = [];
  if (profile.lastMission !== null && typeof profile.lastMission !== "string") profile.lastMission = null;
  if (typeof profile.nextMission !== "string") profile.nextMission = null;
  // V0.7 : la démo n'est plus mélangée à la vraie partie (désactivée une fois, réactivable dans Profil)
  const rev = saved.rev ?? 0;
  const showDemo = rev < 7 ? false : saved.showDemo ?? false;
  // reprise des activités « C'est fait » de la V0.5.1 (stockées à part)
  let done: Record<string, string> = saved.done && typeof saved.done === "object" ? { ...saved.done } : {};
  if (rev < 7) {
    try {
      const old = JSON.parse(localStorage.getItem("leonida-os/advice-done/v1") || "[]");
      if (Array.isArray(old)) for (const id of old) if (typeof id === "string") done[id] = new Date().toISOString();
    } catch {
      done = { ...done };
    }
  }
  return { ...base, ...saved, profile, custom, vehicles, done, showDemo, rev: 7, schema: 1 };
}

export const initialState = (): PersistedState => ({
  schema: 1,
  profile: { pseudo: "Joueur", console: "ps5", edition: "unknown", preorder: "unknown", chapter: 1, lastMission: null, nextMission: null, missionsDone: [], spoilerMode: "strict" },
  completed: { ...DEMO_SEED_COMPLETED },
  trackedSignals: [],
  seenSignals: [],
  freshUnlocks: [],
  custom: [],
  showDemo: false,
  vehicles: {},
  done: {},
  rev: 7,
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
  | { type: "showDemo"; value: boolean }
  | { type: "vehicle"; id: string; progress: VehicleProgress | null }
  | { type: "done"; id: string; value: boolean }
  | { type: "mission"; name: string | null; done: boolean };

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
      return { ...initialState(), custom: s.custom, vehicles: s.vehicles, done: s.done, profile: s.profile };
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
    case "done": {
      const { [a.id]: _o, ...rest } = s.done;
      return { ...s, done: a.value ? { ...rest, [a.id]: new Date().toISOString() } : rest };
    }
    case "mission": {
      if (!a.name) return { ...s, profile: { ...s.profile, lastMission: null } };
      const name = a.name.trim().slice(0, 80);
      const has = s.profile.missionsDone.some((m) => m.toLowerCase() === name.toLowerCase());
      const missionsDone = a.done ? (has ? s.profile.missionsDone : [...s.profile.missionsDone, name]) : s.profile.missionsDone.filter((m) => m.toLowerCase() !== name.toLowerCase());
      // une mission terminée n'est plus « prochaine »
      const nextMission = a.done && s.profile.nextMission && s.profile.nextMission.toLowerCase() === name.toLowerCase() ? null : s.profile.nextMission;
      return { ...s, profile: { ...s.profile, lastMission: a.done ? name : s.profile.lastMission, missionsDone, nextMission } };
    }
    case "vehicle": {
      const { [a.id]: _old, ...rest } = s.vehicles;
      return { ...s, vehicles: a.progress ? { ...rest, [a.id]: a.progress } : rest };
    }
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
  /** Remplace toute la progression par un export « leonida-os/progression » (après confirmation dans l'interface). */
  importProgress: (state: unknown) => boolean;
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
  /** Activité de la veille faite / à refaire. */
  setDone: (id: string, value: boolean) => void;
  /** Mission principale terminée (devient la « dernière mission ») ou retirée. */
  setMission: (name: string | null, done?: boolean) => void;
  setNextMission: (name: string | null) => void;
  /** Garage des légendes : fait avancer (ou annule) l'état d'un véhicule. */
  setVehicle: (id: string, state: VehicleState | null, storage?: string) => void;
  /** Véhicule sélectionné sur la carte (mode Voitures cachées). */
  vehicleId: string | null;
  /** Mode « Voitures cachées » de la carte et son sous-filtre (conservés entre les onglets et depuis LEONIDA AI). */
  garage: { on: boolean; filter: string | null };
  setGarage: (g: { on: boolean; filter?: string | null }) => void;
  /** Radar : fiche à ouvrir et catégorie à filtrer (actions de LEONIDA AI). */
  radarFocus: { id: string | null; category: string | null; nonce: number };
  openRecord: (id: string) => void;
  filterRadar: (category: string | null) => void;
  /** LEONIDA AI ouvert. */
  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
  /** Célébration (validation d'une action) : clé changeante + libellé. */
  celebration: { key: number; label: string } | null;
  celebrate: (label: string) => void;
  selectVehicle: (id: string | null) => void;
  focusVehicle: (id: string) => void;
  /** Lieu de la carte communautaire à montrer (action de LEONIDA AI). */
  placeFocus: { landmarkId?: string; district?: string; poiCat?: string; nonce: number };
  showPlace: (p: { landmarkId?: string; district?: string; poiCat?: string }) => void;
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
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [garage, setGarageState] = useState<{ on: boolean; filter: string | null }>({ on: false, filter: null });
  const [radarFocus, setRadarFocus] = useState<{ id: string | null; category: string | null; nonce: number }>({ id: null, category: null, nonce: 0 });
  const [aiOpen, setAiOpen] = useState(false);
  const [placeFocus, setPlaceFocus] = useState<{ landmarkId?: string; district?: string; poiCat?: string; nonce: number }>({ nonce: 0 });
  const [celebration, setCelebration] = useState<{ key: number; label: string } | null>(null);
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
    if (!hydrated) return;
    persistence.save(state);
    // copie privée dans l'Artifact (iPhone ↔ iPad), une écriture par pause
    if (!cloudReady.current) return;
    const t = setTimeout(() => {
      const at = new Date().toISOString();
      try {
        localStorage.setItem(SAVED_AT_KEY, at);
      } catch {
        /* stockage indisponible */
      }
      cloudSave(state, at);
    }, 1500);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  // Au démarrage dans un Artifact : reprendre la copie privée si elle est plus récente que celle de ce navigateur
  const cloudReady = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void cloudLoad<PersistedState>().then((copy) => {
      if (cancelled) return;
      let local = "";
      try {
        local = localStorage.getItem(SAVED_AT_KEY) ?? "";
      } catch {
        /* rien */
      }
      if (copy && copy.state?.schema === 1 && copy.savedAt > local) dispatch({ type: "hydrate", state: migrate(copy.state) });
      cloudReady.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

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
      importProgress: (raw) => {
        const st = raw as Partial<PersistedState> | null;
        if (!st || typeof st !== "object" || st.schema !== 1 || typeof st.profile !== "object") return false;
        dispatch({ type: "hydrate", state: migrate(st) });
        return true;
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
      setDone: (id, value) => dispatch({ type: "done", id, value }),
      setMission: (name, done = true) => dispatch({ type: "mission", name, done }),
      setNextMission: (name) => dispatch({ type: "profile", patch: { nextMission: name ? name.trim().slice(0, 80) : null } }),
      setVehicle: (id, st, storage) => {
        const prev = state.vehicles[id];
        dispatch({ type: "vehicle", id, progress: st ? { state: st, at: new Date().toISOString(), storage: storage ?? prev?.storage } : null });
      },
      vehicleId,
      garage,
      setGarage: (g) => setGarageState((cur) => ({ on: g.on, filter: g.filter === undefined ? cur.filter : g.filter })),
      radarFocus,
      openRecord: (id) => {
        setRadarFocus((r) => ({ id, category: null, nonce: r.nonce + 1 }));
        setView("radar");
      },
      filterRadar: (category) => {
        setRadarFocus((r) => ({ id: null, category, nonce: r.nonce + 1 }));
        setView("radar");
      },
      aiOpen,
      setAiOpen,
      celebration,
      celebrate: (label) => setCelebration({ key: Date.now(), label }),
      selectVehicle: (id) => {
        if (id) setSelectedId(null);
        setVehicleId(id);
      },
      focusVehicle: (id) => {
        setSelectedId(null);
        setVehicleId(id);
        setGarageState((g) => ({ on: true, filter: g.filter }));
        setFocusNonce((n) => n + 1);
        setView("carte");
      },
      placeFocus,
      showPlace: (p) => {
        setSelectedId(null);
        setVehicleId(null);
        setPlaceFocus((f) => ({ ...p, nonce: f.nonce + 1 }));
        // un lieu demandé se montre en mode Explorer (les voitures cachées masqueraient les repères)
        setGarageState((g) => ({ on: false, filter: g.filter }));
        setView("carte");
      },
    }),
    [state, all, signals, hydrated, view, setView, selectedId, focusNonce, complete, toast, showToast, vehicleId, garage, radarFocus, aiOpen, celebration, placeFocus],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore doit être utilisé dans <StoreProvider>");
  return ctx;
}
