"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PlayerProof } from "./evidence";
import { MAX_METRICS } from "./copilot/route";
import type { TurnMetrics } from "./copilot/route";
import type { ReactNode } from "react";
import { DEMO_SEED_COMPLETED, DISCOVERIES, RADAR } from "@/data/demo";
import { progress, wouldUnlock } from "./engine";
import { asPlayerRecord, isValidRecordInput } from "./records";
import { liveToDiscoveries, useLiveRadar } from "./live";
import { demoRepository, localProgressStore } from "./repository";
import { cloudLoad, cloudSave } from "./runtime/cloud";
import type { Discovery, Gauge, MissionAlertBrief, Objective, PersistedState, Profile, RadarSignal, StoryState, VehicleProgress, VehicleState, ViewId } from "./types";
import type { ResourceId } from "./story/model";
import { nodeByName } from "./progress";

/** V0.18.1 : une ACTIVITÉ libre (épargne, collecte…) n'est jamais une mission : elle ne va pas dans nextMission. */
export const isActivityName = (name: string | null | undefined) => !!name && nodeByName(name)?.kind === "activity";

const STORAGE_KEY = "leonida-os/progress/v1";
const MAX_PROOFS = 4;
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
  if (!["strict", "relaxed", "off"].includes(profile.spoilerMode as string)) profile.spoilerMode = "strict";
  // V0.18.1 : une activité enregistrée par erreur comme mission (possible en V0.18) est retirée de nextMission
  if (isActivityName(profile.nextMission)) profile.nextMission = null;
  profile.missionInProgress = !!profile.nextMission && profile.missionInProgress === true;
  // V0.18 : exploration libre (facultatif) — valeur invalide retirée, jamais inventée
  profile.exploring = typeof profile.exploring === "string" && !profile.nextMission ? profile.exploring : null;
  profile.objectives = Array.isArray(profile.objectives) ? profile.objectives.filter((o) => o && typeof o.text === "string" && typeof o.mission === "string").slice(-80) : [];
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
  const briefs = saved.briefs && typeof saved.briefs === "object" ? Object.fromEntries(Object.entries(saved.briefs).filter(([, b]) => b && typeof b.mission === "string" && Array.isArray(b.items))) : {};
  const metrics = Array.isArray(saved.metrics) ? saved.metrics.filter((m) => m && typeof m.totalMs === "number").slice(-MAX_METRICS) : [];
  const pins = saved.pins && typeof saved.pins === "object" ? Object.fromEntries(Object.entries(saved.pins).filter(([, v]) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && typeof v.at === "string").map(([k, v]) => [k, { x: v.x, y: v.y, at: v.at, by: "joueur" as const }])) : {};
  const proofs = saved.proofs && typeof saved.proofs === "object" ? Object.fromEntries(Object.entries(saved.proofs).map(([k, arr]) => [k, (Array.isArray(arr) ? arr : []).filter((p) => p && typeof p.id === "string" && (p.kind === "lien" || p.kind === "capture") && typeof p.value === "string" && typeof p.at === "string").slice(-MAX_PROOFS)]).filter(([, a]) => (a as unknown[]).length)) : {};
  const story = sanitizeStory(saved.story);
  return { ...base, ...saved, profile, custom, vehicles, done, briefs, pins, proofs, metrics, showDemo, story, rev: 9, schema: 1 };
}

/** V0.17 : jauges d'argent et choix déclarés — toute valeur invalide est retirée (jamais un solde inventé). */
export function sanitizeStory(raw: unknown): StoryState {
  const r = raw && typeof raw === "object" ? (raw as StoryState) : {};
  const ok = (g: unknown): g is Gauge => {
    const x = g as Gauge;
    if (!x || typeof x !== "object") return false;
    if (x.mode === "exact") return Number.isFinite(x.value) && x.value >= 0;
    return x.mode === "range" && Number.isFinite(x.min) && x.min >= 0 && (x.max === null || (Number.isFinite(x.max) && x.max >= x.min));
  };
  const money = Object.fromEntries(Object.entries(r.money ?? {}).filter(([k, g]) => ["cash", "checking", "stash", "savings"].includes(k) && ok(g)));
  const choices = Object.fromEntries(Object.entries(r.choices ?? {}).filter(([k, v]) => typeof k === "string" && typeof v === "string"));
  return { money, choices, ...(typeof r.moneyAt === "string" ? { moneyAt: r.moneyAt } : {}) };
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
  story: { money: {}, choices: {} },
  rev: 9,
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
  | { type: "pin"; id: string; pin: { x: number; y: number } | null }
  | { type: "proof"; id: string; proof: PlayerProof | null; removeId?: string }
  | { type: "metric"; m: TurnMetrics }
  | { type: "mission"; name: string | null; done: boolean }
  | { type: "pastDone"; names: string[] }
  | { type: "objectives"; fn: (list: Objective[]) => Objective[] }
  | { type: "brief"; key: string; brief: MissionAlertBrief }
  | { type: "money"; resource: ResourceId; gauge: Gauge | null };

export function reducer(s: PersistedState, a: Action): PersistedState {
  switch (a.type) {
    case "hydrate":
      return a.state;
    case "complete":
      return { ...s, completed: { ...s.completed, [a.id]: a.at }, freshUnlocks: a.unlocks };
    case "undo": {
      const { [a.id]: _removed, ...rest } = s.completed;
      return { ...s, completed: rest, freshUnlocks: [] };
    }
    case "profile": {
      // garde-fou : une activité libre ne devient jamais la mission envisagée ou commencée
      if (typeof a.patch.nextMission === "string" && isActivityName(a.patch.nextMission)) {
        const { nextMission: _n, missionInProgress: _m, exploring: _e, ...rest } = a.patch;
        return { ...s, profile: { ...s.profile, ...rest } };
      }
      return { ...s, profile: { ...s.profile, ...a.patch } };
    }
    case "track":
      return {
        ...s,
        trackedSignals: s.trackedSignals.includes(a.id) ? s.trackedSignals.filter((x) => x !== a.id) : [...s.trackedSignals, a.id],
      };
    case "seen":
      return { ...s, seenSignals: Array.from(new Set([...s.seenSignals, ...a.ids])) };
    case "reset":
      // ne remet à zéro que le contenu de démonstration : la vraie partie (profil, coches, garage, positions, analyses, mesures) est conservée
      return { ...initialState(), custom: s.custom, vehicles: s.vehicles, done: s.done, profile: s.profile, pins: s.pins, proofs: s.proofs, briefs: s.briefs, metrics: s.metrics, story: s.story };
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
    case "metric":
      return { ...s, metrics: [...(s.metrics ?? []), a.m].slice(-MAX_METRICS) };
    case "proof": {
      const cur = (s.proofs ?? {})[a.id] ?? [];
      const next = a.proof ? [...cur, a.proof].slice(-MAX_PROOFS) : cur.filter((p) => p.id !== a.removeId);
      const { [a.id]: _o, ...rest } = s.proofs ?? {};
      return { ...s, proofs: next.length ? { ...rest, [a.id]: next } : rest };
    }
    case "pin": {
      const { [a.id]: _old, ...rest } = s.pins ?? {};
      return { ...s, pins: a.pin ? { ...rest, [a.id]: { x: Math.round(a.pin.x), y: Math.round(a.pin.y), at: new Date().toISOString(), by: "joueur" } } : rest };
    }
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
      const wasNext = a.done && !!s.profile.nextMission && s.profile.nextMission.toLowerCase() === name.toLowerCase();
      const nextMission = wasNext ? null : s.profile.nextMission;
      // V0.18 : annuler la dernière mission terminée fait revenir la précédente (jamais une « dernière » fantôme)
      const undoLast = !a.done && !!s.profile.lastMission && s.profile.lastMission.toLowerCase() === name.toLowerCase();
      const lastMission = a.done ? name : undoLast ? missionsDone.at(-1) ?? null : s.profile.lastMission;
      return { ...s, profile: { ...s.profile, lastMission, missionsDone, nextMission, missionInProgress: wasNext ? false : s.profile.missionInProgress, exploring: a.done ? null : s.profile.exploring ?? null } };
    }
    case "pastDone": {
      // V0.18 : missions ANTÉRIEURES confirmées par le joueur (« probablement faites ») — la dernière terminée ne change pas
      const have = new Set(s.profile.missionsDone.map((m) => m.toLowerCase()));
      const add = a.names.map((n) => n.trim().slice(0, 80)).filter((n) => n && !have.has(n.toLowerCase()));
      return add.length ? { ...s, profile: { ...s.profile, missionsDone: [...s.profile.missionsDone, ...add] } } : s;
    }
    case "money": {
      const money = { ...(s.story?.money ?? {}) };
      if (a.gauge) money[a.resource] = a.gauge;
      else delete money[a.resource];
      return { ...s, story: { ...(s.story ?? {}), money, moneyAt: new Date().toISOString() } };
    }
    case "brief": {
      // une analyse par mission ; on garde les 8 plus récentes
      const all = { ...(s.briefs ?? {}), [a.key]: a.brief };
      const keep = Object.entries(all).sort((x, y) => y[1].at.localeCompare(x[1].at)).slice(0, 8);
      return { ...s, briefs: Object.fromEntries(keep) };
    }
    case "objectives":
      return { ...s, profile: { ...s.profile, objectives: a.fn(s.profile.objectives ?? []).slice(-80) } };
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
  /** Annulation immédiate (≈ 5 s) d'une action « Fait » (V0.14). */
  onUndo?: () => void;
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
  /** « Fait » en un toucher (V0.14) : enregistre `done[key]` et propose « Annuler » pendant ~5 s. */
  markDone: (key: string, title: string, name: string) => void;
  /** Toast avec annulation personnalisée (véhicule, objectif…). */
  notifyUndo: (title: string, body: string, onUndo: () => void) => void;
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
  /** V0.18 : confirme des missions antérieures déjà faites, sans changer la dernière mission terminée. */
  confirmPastMissions: (names: string[]) => void;
  setNextMission: (name: string | null, inProgress?: boolean) => void;
  setMissionInProgress: (on: boolean) => void;
  /** V0.18 : exploration libre (aucune mission choisie, l'Accueil ne redemande pas). */
  setExploring: (on: boolean) => void;
  addObjective: (o: Omit<Objective, "id" | "done" | "at"> & { done?: boolean }) => void;
  toggleObjective: (id: string) => void;
  removeObjective: (id: string) => void;
  /** Annule un « Fait » posé comme objectif (V0.14) : retire l'objectif coché de ce texte pour cette mission. */
  undoObjective: (mission: string, text: string) => void;
  setBrief: (key: string, brief: MissionAlertBrief) => void;
  /** Story Intelligence : argent déclaré (exact, tranche, ou null = inconnu). */
  setMoney: (resource: ResourceId, gauge: Gauge | null) => void;
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
  placeFocus: PlaceFocus & { nonce: number };
  showPlace: (p: PlaceFocus) => void;
  /** Position d'un établissement observée en jeu (null = retirer). */
  setPin: (estId: string, pin: { x: number; y: number } | null) => void;
  /** Ajoute (ou retire, avec removeId) une preuve du joueur. */
  addProof: (id: string, proof: PlayerProof | null, removeId?: string) => void;
  addMetric: (m: TurnMetrics) => void;
}

/** Ce que LEONIDA AI demande de montrer : repère, établissement, ou recherche (jamais une zone de quartier entier). */
export interface PlaceFocus {
  landmarkId?: string;
  district?: string;
  poiCat?: string;
  estId?: string;
  /** Ouvre la recherche de la carte avec ce texte (liste, y compris les lieux sans position). */
  query?: string;
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
  const [placeFocus, setPlaceFocus] = useState<PlaceFocus & { nonce: number }>({ nonce: 0 });
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
      markDone: (key, title, name) => {
        dispatch({ type: "done", id: key, value: true });
        showToast({ title, body: name, icon: "check", onUndo: () => dispatch({ type: "done", id: key, value: false }) });
      },
      notifyUndo: (title, body, onUndo) => showToast({ title, body, icon: "check", onUndo }),
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
      setPin: (id, pin) => dispatch({ type: "pin", id, pin }),
      addProof: (id, proof, removeId) => dispatch({ type: "proof", id, proof, removeId }),
      addMetric: (m) => dispatch({ type: "metric", m }),
      setMission: (name, done = true) => dispatch({ type: "mission", name, done }),
      confirmPastMissions: (names) => dispatch({ type: "pastDone", names }),
      setNextMission: (name, inProgress = false) =>
        isActivityName(name)
          ? showToast({ title: "C'est une activité, pas une mission", body: `« ${name} » se fait quand tu veux : coche-la « Fait » une fois terminée.`, icon: "info" })
          : dispatch({ type: "profile", patch: { nextMission: name ? name.trim().slice(0, 80) : null, missionInProgress: !!name && inProgress, ...(name ? { exploring: null } : {}) } }),
      setExploring: (on) => dispatch({ type: "profile", patch: on ? { exploring: new Date().toISOString(), nextMission: null, missionInProgress: false } : { exploring: null } }),
      setMissionInProgress: (on) => dispatch({ type: "profile", patch: { missionInProgress: on } }),
      addObjective: (o) =>
        dispatch({
          type: "objectives",
          fn: (list) =>
            list.some((x) => x.mission.toLowerCase() === o.mission.toLowerCase() && x.text.toLowerCase() === o.text.trim().toLowerCase())
              ? list.map((x) => (o.done && x.mission.toLowerCase() === o.mission.toLowerCase() && x.text.toLowerCase() === o.text.trim().toLowerCase() ? { ...x, done: true } : x))
              : [...list, { ...o, text: o.text.trim().slice(0, 160), id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, done: !!o.done, at: new Date().toISOString() }],
        }),
      toggleObjective: (id) => dispatch({ type: "objectives", fn: (list) => list.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) }),
      removeObjective: (id) => dispatch({ type: "objectives", fn: (list) => list.filter((x) => x.id !== id) }),
      undoObjective: (mission, text) =>
        dispatch({ type: "objectives", fn: (list) => list.filter((x) => !(x.done && x.mission.toLowerCase() === mission.toLowerCase() && x.text.trim().toLowerCase() === text.trim().toLowerCase())) }),
      setBrief: (key, brief) => dispatch({ type: "brief", key, brief }),
      setMoney: (resource, gauge) => dispatch({ type: "money", resource, gauge }),
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
