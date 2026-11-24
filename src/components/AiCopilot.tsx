"use client";

import { launchConfirm } from "@/lib/ai/progressAnswers";
import { useRedact } from "@/lib/useRedact";
import { ROUTER_KEY } from "@/lib/copilot/route";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { answer, isValidAction, starters } from "@/lib/ai/engine";
import type { AiAction, AiAnswer, PlaceRef, Topic } from "@/lib/ai/engine";
import type { ProxyStatus } from "@/lib/ai/proxy";
import { askProxy, proxyEnabled } from "@/lib/ai/proxy";
import { askCopilot } from "@/lib/copilot";
import { afterDone } from "@/lib/ai/progressAnswers";
import type { CopilotAnswer, LlmMessage, WebStatus } from "@/lib/copilot";
import { exaSearch } from "@/lib/runtime/web";
import { reportWeb, useCopilotRuntime } from "@/lib/useCopilot";
import { lngLatToGame, loadLandmarks } from "@/lib/gtadb";
import { useIsTablet } from "@/lib/useMedia";
import { SPRINGS, spring, tick } from "@/lib/motion";
import type { SpringHandle } from "@/lib/motion";
import { Sheet } from "./Sheet";
import { BrandMark, CopilotGlyph } from "./Brand";
import { Icon } from "./ui/Icon";
import { VisionAttach, VisionAnswer, GroundingCard, attachmentNote } from "./VisionAttach";
import { RichText } from "./RichText";
import { mapRefRenderer } from "@/lib/mapRef";
import type { VisualMemory } from "@/lib/copilot/grounding";
import type { AttachmentChip } from "./VisionAttach";
import type { Attachment, AttachPurpose, VisionLimits } from "@/lib/copilot/vision";
import { AttachError, MAX_DOCS, prepareImage, prepareText, TEXT_DOC } from "@/lib/copilot/vision";

type AiMsg = { id: number; role: "ai"; a: AiAnswer; llm?: ProxyStatus | "pending"; engine?: "claude" | "direct"; model?: string; note?: string; streaming?: boolean; stage?: "search" | "write"; checklist?: CopilotAnswer["checklist"]; web?: CopilotAnswer["web"]; mission?: string; vision?: CopilotAnswer["vision"]; mapGuess?: CopilotAnswer["mapGuess"]; grounding?: CopilotAnswer["grounding"]; attNames?: string[] };
type AskOpts = { mode?: "chat" | "checklist"; mission?: string; attachments?: Attachment[]; purpose?: AttachPurpose };
const WEB_FAIL: Partial<Record<WebStatus, string>> = {
  not_connected: "Recherche web indisponible : le connecteur Exa n'est pas branché sur ton compte Claude.",
  needs_reauth: "Recherche web indisponible : reconnecte le connecteur Exa dans les réglages de Claude.",
  denied: "Recherche web non autorisée pour cette app (tu peux l'accepter à la prochaine demande).",
  error: "La recherche web a échoué cette fois-ci ; réponse sans le web.",
  empty: "Aucun résultat web pertinent trouvé.",
};
type Msg = { id: number; role: "user"; text: string; atts?: AttachmentChip[] } | AiMsg;
const HISTORY_KEY = "leonida-os/ai-history/v2";
const DRAFT_KEY = "leonida-os/ai-draft/v1";
const routerMode = (): "local" | "planner" => {
  try {
    return localStorage.getItem(ROUTER_KEY) === "planner" ? "planner" : "local";
  } catch {
    return "local";
  }
};
/** Longueur maximale d'un message (le contexte envoyé à Claude reste borné). */
const MAX_CHARS = 2_000;
/** Au plus 4 images par message (lisibilité de l'aperçu ; la plateforme peut en accepter davantage). */
const MAX_IMAGES = 4;
const defaultQuestion = (atts: Attachment[], purpose?: AttachPurpose) =>
  purpose === "carte" ? "Où est-ce sur la carte ?" : atts.some((a) => a.kind === "image") ? "Regarde cette capture : qu'est-ce que je dois savoir ?" : "Lis ce document et compare-le à ce que tu sais.";
const finePointer = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;

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
const REL_FR: Record<string, string> = { officiel: "Vérifié · officiel", recoupé: "Vérifié", signalé: "Probable", "non établi": "Non confirmé", "déclaré par toi": "D’après toi" };

/**
 * LEONIDA AI : accès permanent et discret (pas d'onglet).
 * iPhone : fiche conversationnelle glissante. iPad : panneau latéral qui laisse la carte utilisable.
 * L'ouverture ne touche jamais à la carte (MapLibre reste monté, caméra et filtres conservés).
 */
export function AiCopilot() {
  const store = useStore();
  // anti-spoiler appliqué au texte avant rendu (même un ancien message, même si Claude a dérapé)
  const redact = useRedact();
  const { state, aiOpen, setAiOpen, view } = store;
  const { feed } = useLiveRadar();
  const isTablet = useIsTablet();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ key: string; action: AiAction } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMsgs(loadHistory()), []);
  // Brouillon : conservé si le chat est fermé par erreur, et après rechargement (cet appareil uniquement)
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) setText(d.slice(0, MAX_CHARS));
    } catch {
      /* stockage indisponible */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (text) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* stockage plein */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  // Hauteur adaptative : 1 ligne → 6 lignes visibles, défilement interne au-delà ; aucune incidence sur le fil
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = parseFloat(getComputedStyle(el).maxHeight) || 150;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text, aiOpen]);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  // Moteur conversationnel : Claude (Artifact ou API) si disponible, sinon mode direct
  const { transport, web } = useCopilotRuntime();
  // ── LEONIDA Vision : pièces jointes (images seulement si cette vue peut réellement les envoyer à Claude) ──
  const [vlim, setVlim] = useState<VisionLimits | null>(null);
  useEffect(() => {
    let live = true;
    void transport?.visionLimits?.().then((l) => live && setVlim(l)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [transport]);
  const [atts, setAtts] = useState<Attachment[]>([]);
  /** V0.19 · dernière image analysée (mémoire vive : jamais localStorage ; effacée avec la conversation). */
  const visualRef = useRef<VisualMemory | null>(null);
  const [purpose, setPurpose] = useState<AttachPurpose>("capture");
  const [attErr, setAttErr] = useState<string | null>(null);
  const addFiles = async (files: File[], kind: "photo" | "capture" | "carte" | "doc") => {
    setAttErr(null);
    const out: Attachment[] = [];
    const errs: string[] = [];
    const maxImg = Math.min(vlim?.maxCount ?? 0, MAX_IMAGES);
    let imgs = atts.filter((a) => a.kind === "image").length;
    let docs = atts.filter((a) => a.kind === "text").length;
    for (const f of files) {
      try {
        if (kind === "doc" || TEXT_DOC.test(f.name)) {
          if (docs >= MAX_DOCS) {
            errs.push(`${MAX_DOCS} documents au maximum par message.`);
            continue;
          }
          out.push(await prepareText(f));
          docs++;
        } else {
          if (!vlim) {
            errs.push("L'envoi d'images n'est pas disponible ici.");
            break;
          }
          if (imgs >= maxImg) {
            errs.push(`${maxImg} images au maximum par message.`);
            break;
          }
          out.push(await prepareImage(f, vlim));
          imgs++;
        }
      } catch (e) {
        errs.push(e instanceof AttachError ? e.message : `Impossible de lire « ${f.name} ».`);
      }
    }
    if (kind === "carte" && out.some((a) => a.kind === "image")) setPurpose("carte");
    setAtts((a) => [...a, ...out]);
    if (errs.length) setAttErr([...new Set(errs)].join(" "));
  };
  const removeAtt = (id: string) => {
    setAtts((list) => {
      const gone = list.find((a) => a.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      const rest = list.filter((a) => a.id !== id);
      if (!rest.some((a) => a.kind === "image")) setPurpose("capture");
      return rest;
    });
    setAttErr(null);
  };
  const [deep, setDeep] = useState(false);
  useEffect(() => {
    try {
      setDeep(localStorage.getItem("leonida-os/ai-tier/v1") === "default");
    } catch {
      /* préférence absente */
    }
  }, []);
  const toggleDeep = () =>
    setDeep((d) => {
      try {
        localStorage.setItem("leonida-os/ai-tier/v1", d ? "quick" : "default");
      } catch {
        /* stockage indisponible */
      }
      return !d;
    });
  const ctlRef = useRef<AbortController | null>(null);
  const [streaming, setStreaming] = useState(false);
  const historyOf = (list: Msg[]): LlmMessage[] =>
    list
      .filter((m) => (m.role === "user" ? m.text : m.a.text))
      .slice(-16)
      .map((m) => (m.role === "user" ? { role: "user" as const, content: m.text + attachmentNote(m.atts) } : { role: "assistant" as const, content: m.a.text }));
  const toAi = (c: CopilotAnswer): AiAnswer => ({ intent: c.intent, text: c.message, reliability: c.trust, sources: c.sources, actions: c.actions, more: c.more, replies: c.replies, topic: c.topic, evidence: c.evidence });
  const [places, setPlaces] = useState<PlaceRef[]>([]);
  useEffect(() => {
    if (aiOpen && !places.length) void loadLandmarks().then(setPlaces);
  }, [aiOpen, places.length]);
  useEffect(() => {
    try {
      // les aperçus d'images ne sont jamais conservés (seuls nom, type et taille restent)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-40).map((m) => (m.role === "user" && m.atts ? { ...m, atts: m.atts.map(({ preview: _p, ...rest }) => rest) } : m))));
    } catch {
      /* stockage plein : l'historique reste en mémoire */
    }
  }, [msgs]);
  // Défilement du fil (V0.13) :
  // - à l'ouverture (et après rechargement) : directement au dernier message, sans animation ;
  // - ensuite, on ne suit les nouveaux contenus (réponse en streaming, hauteur qui change, clavier iOS) QUE si le
  //   joueur est déjà en bas ; s'il remonte lire, on ne le ramène jamais de force : un bouton « Dernier message »
  //   apparaît quand quelque chose arrive. Défilement instantané : un défilement animé interrompu par l'animation
  //   de la fiche (ou par le clavier sur iPhone) laissait le fil à mi-hauteur.
  const stickRef = useRef(true);
  const [away, setAway] = useState(false);
  // élément du fil (la fiche iPhone le monte après son ouverture) et dernier geste du joueur : seul un défilement
  // FAIT PAR LE JOUEUR (doigt, molette, clavier) décroche le suivi ; un recalage de mise en page ne le décroche jamais
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const userInput = useRef(0);
  const setList = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el;
    setListEl(el);
  }, []);
  const markUser = () => {
    userInput.current = Date.now();
  };
  const toBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    if (atBottom) {
      stickRef.current = true;
      setAway(false);
    } else if (Date.now() - userInput.current < 1_500) stickRef.current = false;
  };
  useLayoutEffect(() => {
    if (!aiOpen) return;
    stickRef.current = true;
    setAway(false);
    toBottom();
    const el = listEl;
    if (!el) return;
    const follow = () => {
      if (stickRef.current) toBottom();
    };
    // taille du fil (animation d'ouverture, clavier) et de chaque bulle (streaming, détails dépliés, images)
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    const watchChildren = () => Array.from(el.children).forEach((c) => ro.observe(c));
    watchChildren();
    const mo = new MutationObserver(() => {
      watchChildren();
      follow();
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    vv?.addEventListener("resize", follow);
    // la fiche s'ouvre avec un ressort : on se recale une fois la hauteur stabilisée
    const t = window.setTimeout(follow, 420);
    return () => {
      ro.disconnect();
      mo.disconnect();
      vv?.removeEventListener("resize", follow);
      window.clearTimeout(t);
    };
  }, [aiOpen, isTablet, listEl, toBottom]);
  useLayoutEffect(() => {
    if (stickRef.current) toBottom();
    else if (msgs.length) setAway(true);
  }, [msgs, toBottom]);

  // Sujet de la conversation (dernière réponse) : permet « et comment je la garde ? »
  const topicOf = (list: Msg[]): Topic | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.role === "ai") return m.a.topic ?? null;
    }
    return null;
  };

  const ask = useCallback(
    async (q: string, forcedTopic?: Topic | null, opts: AskOpts = {}) => {
      const atts = opts.attachments ?? [];
      const question = (q.trim() || (atts.length ? defaultQuestion(atts, opts.purpose) : "")).slice(0, MAX_CHARS);
      if (!question) return;
      setText("");
      const chips: AttachmentChip[] | undefined = atts.length ? atts.map((a) => ({ name: a.name, kind: a.kind, size: a.size, preview: a.preview, purpose: opts.purpose })) : undefined;
      // le joueur vient d'écrire : on le suit jusqu'à la réponse
      stickRef.current = true;
      setAway(false);
      // repères gtadb (cache partagé avec la carte) : nécessaires pour proposer « voir sur la carte »
      const pl = places.length ? places : await loadLandmarks();
      const ctx = { feed, state, position: mapPosition(), places: pl };
      const topic: Topic | null = forcedTopic === undefined ? topicOf(msgsRef.current) : forcedTopic;
      if (transport) {
        // Claude rédige, à partir des preuves du Radar ; la réponse s'affiche au fil de l'écriture
        const history = historyOf(msgsRef.current);
        const id = Date.now();
        const ctl = new AbortController();
        ctlRef.current?.abort();
        ctlRef.current = ctl;
        setStreaming(true);
        setMsgs((m) => [...m, { id, role: "user", text: question, atts: chips }, { id: id + 1, role: "ai", a: { intent: "pending", text: "", reliability: null, sources: [], actions: [] }, engine: "claude", streaming: true, mission: opts.mission, attNames: chips?.map((c) => c.name) }]);
        const c = await askCopilot({
          attachments: atts,
          purpose: opts.purpose,
          // V0.19 · mémoire visuelle (mémoire vive seulement) et extraits de carte pour comparer une capture de carte
          memory: visualRef.current,
          renderRef: mapRefRenderer(pl),
          onVision: (vm) => (visualRef.current = vm),
          mode: opts.mode,
          mission: opts.mission,
          search: web === "unavailable" ? null : exaSearch,
          onStage: (stage) => setMsgs((m) => m.map((x) => (x.id === id + 1 && x.role === "ai" ? { ...x, stage } : x))),
          question,
          ctx,
          topic,
          history,
          transport,
          signal: ctl.signal,
          tier: deep ? "default" : "quick",
          planner: routerMode() === "planner",
          onMetrics: (mt) => store.addMetric(mt),
          onText: (v) => setMsgs((m) => m.map((x) => (x.id === id + 1 && x.role === "ai" ? { ...x, a: { ...x.a, text: v } } : x))),
        });
        if (ctlRef.current === ctl) {
          ctlRef.current = null;
          setStreaming(false);
        }
        const webNote = c.web && c.web.status !== "ok" ? WEB_FAIL[c.web.status] : undefined;
        if (c.web) reportWeb(c.web.status === "ok" || c.web.status === "empty" ? "ok" : c.web.status);
        setMsgs((m) => m.map((x) => (x.id === id + 1 ? { id: id + 1, role: "ai", a: toAi(c), engine: c.engine, model: c.model, note: [c.note, webNote].filter(Boolean).join(" ") || undefined, checklist: c.checklist, web: c.web, mission: opts.mission, vision: c.vision, mapGuess: c.mapGuess, grounding: c.grounding, attNames: chips?.map((x) => x.name) } : x)));
        return;
      }
      const local = answer(question, ctx, topic);
      const a = { ...local, actions: local.actions.filter((x) => isValidAction(x, feed)).slice(0, local.intent === "motel_report" ? 3 : 2) };
      const id = Date.now();
      // la réponse locale s'affiche tout de suite ; la synthèse serveur (si déployée) l'affine ensuite
      const remote = proxyEnabled() && !!(a.evidence ?? []).length;
      setMsgs((m) => [...m, { id, role: "user", text: question, atts: chips }, { id: id + 1, role: "ai", a, engine: remote ? undefined : "direct", llm: remote ? "pending" : undefined }]);
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
    [feed, state, places, transport, deep, web],
  );

  const sendNow = () => {
    if (!text.trim() && !atts.length) return;
    const a = atts;
    const pp = purpose;
    setAtts([]);
    setPurpose("capture");
    setAttErr(null);
    void ask(text, undefined, a.length ? { attachments: a, purpose: pp } : {});
  };

  // Questions lancées depuis l'accueil (amorces)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as string | { question: string; topic?: Topic | null; mode?: "chat" | "checklist"; mission?: string };
      if (typeof d === "string") void ask(d);
      else if (d?.question) void ask(d.question, d.topic ?? null, { mode: d.mode, mission: d.mission });
    };
    window.addEventListener("leonida:ask", h);
    return () => window.removeEventListener("leonida:ask", h);
  }, [ask]);

  const run = (a: AiAction, confirmed = false, key = "") => {
    tick();
    const needs = a.type === "mark_done" || a.type === "vehicle_state" || a.type === "set_mission" || a.type === "set_next_mission" || a.type === "start_mission" || a.type === "objective_done";
    if (needs && !confirmed) {
      setPending({ key, action: a });
      return;
    }
    setPending(null);
    // Sur iPhone, une action vers la carte ou le radar referme la fiche : la conversation est conservée
    // iPhone et iPad portrait (copilote en volet par-dessus) : on referme pour laisser voir la carte ; en paysage il reste à côté
    const leave = () => (!isTablet || window.innerWidth < 1100) && setAiOpen(false);
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
        store.showPlace({ landmarkId: a.landmarkId, district: a.district, poiCat: a.poiCat, estId: a.estId, query: a.query });
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
        {
          // lien classique : window.open est bloqué dans un Artifact
          const link = document.createElement("a");
          link.href = a.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.click();
        }
        break;
      case "mark_done":
        store.setDone(a.id, true);
        store.celebrate("Activité terminée");
        break;
      case "vehicle_state":
        store.setVehicle(a.id, a.state);
        store.celebrate(a.state === "spotted" ? "Véhicule repéré" : "Véhicule mis à jour");
        break;
      case "set_mission": {
        // recalcul immédiat : ce que la mission terminée débloque (statuts du graphe sourcé), sans ordre inventé
        const next = afterDone(state.profile, a.name);
        store.setMission(a.name, true);
        store.celebrate("Mission terminée");
        const id = Date.now();
        setMsgs((m) => [...m, { id, role: "ai", a: { intent: "after_done", text: `C'est noté : « ${a.name} » terminée. ${next.text}`, reliability: "recoupé", sources: [], actions: next.actions } }]);
        break;
      }
      case "start_mission":
        store.setNextMission(a.name, true);
        store.celebrate("Mission en cours");
        break;
      case "objective_done":
        store.addObjective({ mission: a.mission, text: a.text, basis: "vérifié", done: true });
        store.celebrate("Récupéré !");
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
    visualRef.current = null;
    setMsgs([]);
    setPending(null);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* rien à effacer */
    }
  };

  const lastAi = [...msgs].reverse().find((m): m is AiMsg => m.role === "ai");
  const [menu, setMenu] = useState(false);
  const [askClear, setAskClear] = useState(false);
  // Les descriptions résolues localement ne contiennent que les noms des tâches décrites.
  // Toute réponse du modèle ou issue d’une pièce jointe passe par le rédacteur général.
  const displayText = (m: AiMsg, text: string) =>
    m.a.intent === "motel_report" && m.engine === "direct" && !m.attNames?.length && state.profile.chapter === 2 ? text : redact(text);
  const ctxLine = state.profile.nextMission ? `${state.profile.missionInProgress ? "En mission" : "Prochaine mission"} · ${redact(state.profile.nextMission)}` : view === "carte" ? "Depuis la carte" : "Ton copilote de partie";

  const body = (
    <div className="ai" data-testid="ai-panel">
      <header className="ai__head">
        <BrandMark size={30} />
        <div>
          <strong>LEONIDA AI</strong>
          <span data-testid="ai-context">{ctxLine}</span>
        </div>
        <button className="iconbtn ai__menubtn" onClick={() => { setMenu((v) => !v); setAskClear(false); }} aria-label="Options de LEONIDA" aria-expanded={menu} data-testid="ai-menu"><Icon name="more" size={18} /></button>
        <button className="iconbtn ai__close" onClick={() => { tick(); setAiOpen(false); }} aria-label="Fermer LEONIDA AI" data-testid="ai-close"><Icon name="close" /></button>
        <div className="ai__menu" hidden={!menu} data-testid="ai-menu-panel">
          <p className="small muted" data-testid="ai-mode">{transport ? `${transport.label} · LEONIDA RADAR${web === "ok" ? " + web" : ""}` : proxyEnabled() ? "Données vérifiées + synthèse IA" : "Mode direct · données vérifiées, sans IA générative"}</p>
          {transport && (
            <button className={`chip chip--reply press${deep ? " is-on" : ""}`} onClick={toggleDeep} aria-pressed={deep}>
              {deep ? "Réponses approfondies (plus lentes)" : "Réponses rapides"}
            </button>
          )}
          {msgs.length > 0 && (askClear ? (
            <span className="ai__menuconfirm">
              <span className="small">Effacer toute la conversation ?</span>
              <button className="btn btn--danger btn--xs" onClick={() => { clear(); setAskClear(false); setMenu(false); }} data-testid="ai-clear-ok">Effacer</button>
              <button className="btn btn--ghost btn--xs" onClick={() => setAskClear(false)}>Garder</button>
            </span>
          ) : (
            <button className="btn btn--ghost btn--xs" onClick={() => setAskClear(true)} data-testid="ai-clear">Effacer la conversation</button>
          ))}
        </div>
      </header>
      <div className="ai__list" ref={setList} data-testid="ai-list" onScroll={onListScroll} onWheel={markUser} onTouchStart={markUser} onTouchMove={markUser} onPointerDown={markUser} onKeyDown={markUser}>
        {msgs.length === 0 && (
          <div className="ai__intro">
            <p>{transport ? "Salut ! Je joue avec toi : parle-moi comme à un pote (« je lance Swamped », « j'ai la caisse ! », « ça vaut le coup ? »). Je m'appuie sur la veille LEONIDA RADAR" + (web === "ok" ? " et le web" : "") + ", ton chapitre et ce que tu as déjà fait — sans rien inventer." : "Salut ! Dis-moi quelle mission tu vas lancer ou ce que tu cherches. Je réponds avec les fiches vérifiées de la veille, selon ton chapitre, ton édition et ce que tu as déjà fait."}</p>
            {transport && (
              <button className={`chip chip--reply press${deep ? " is-on" : ""}`} onClick={toggleDeep} aria-pressed={deep} data-testid="ai-deep">
                {deep ? "Réponses approfondies (plus lentes)" : "Réponses rapides · toucher pour approfondir"}
              </button>
            )}
            <div className="ai__starters">
              {starters({ feed, state }).map((q) => (
                <button key={q} className="chip press" onClick={() => ask(q)} data-testid="ai-starter">{q}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="bubble bubble--me">
              {m.atts && <VisionAttach.Sent atts={m.atts} />}
              {m.text}
            </div>
          ) : (
            <article key={m.id} className={`bubble bubble--ai${m.llm === "pending" ? " is-refining" : ""}`} data-testid="ai-answer" data-intent={m.a.intent} data-llm={m.llm ?? "off"}>
              {m.attNames?.length ? <p className="bubble__about" data-testid="ai-about">Réponse à {m.attNames.length > 1 ? `tes ${m.attNames.length} pièces jointes` : `« ${m.attNames[0]} »`}</p> : null}
              {m.streaming && !m.a.text ? <span className="bubble__refine" data-testid="ai-thinking">{m.stage === "search" ? "Recherche sur le web…" : m.attNames?.length ? "Leonida regarde ta pièce jointe…" : m.mission ? `Leonida passe ${m.mission} au crible…` : "Leonida réfléchit…"}</span> : <RichText className="bubble__text" text={displayText(m, m.a.text)} />}
              {!m.streaming && m.grounding && <GroundingCard g={m.grounding} />}
              {!m.streaming && !m.grounding && (m.vision || m.mapGuess) && <VisionAnswer vision={m.vision} guess={m.mapGuess ?? null} />}
              {m.checklist && <ChecklistView c={m.checklist} mission={m.mission ?? ""} />}
              {m.llm === "pending" && <span className="bubble__refine" aria-live="polite">Leonida affine sa réponse…</span>}
              {m.a.actions.length > 0 && (
                <div className="bubble__actions">
                  {m.a.actions.slice(0, m.a.intent === "motel_report" ? 3 : 2).map((a, i) => {
                    const key = `${m.id}:${JSON.stringify(a)}`;
                    const asking = pending?.key === key && "confirm" in a;
                    return asking ? (
                      <span key={i} className="confirm" data-testid="ai-confirm">
                        <span>{a.type === "start_mission" ? launchConfirm(state, a.name) : (a as { confirm: string }).confirm}</span>
                        <button className="btn btn--primary btn--xs" onClick={() => run(a, true)}>Confirmer</button>
                        <button className="btn btn--ghost btn--xs" onClick={() => setPending(null)}>Annuler</button>
                      </span>
                    ) : (
                      <button key={i} className={`btn btn--xs press ${i === 0 ? "btn--on" : "btn--ghost"}`} onClick={() => run(a, false, key)} data-testid={`ai-action-${a.type}`}>
                        {displayText(m, a.label)}
                      </button>
                    );
                  })}
                </div>
              )}
              {!m.streaming && (m.a.reliability || m.a.sources.length > 0 || (m.a.more?.length ?? 0) > 0 || m.engine === "claude") && (
                <details className="bubble__trust" data-testid="ai-sources">
                  <summary>
                    {m.a.reliability && <span className={`bubble__rel relchip--${REL_CLS[m.a.reliability]}`}><i />{REL_FR[m.a.reliability]}</span>}
                    <span className="bubble__trustn">{m.a.sources.length ? `${m.a.sources.length} source${m.a.sources.length > 1 ? "s" : ""}` : "Détails"}</span>
                  </summary>
                  {m.a.actions.length > 2 && (
                    <div className="bubble__actions">
                      {m.a.actions.slice(2).map((a, i) => (
                        <button key={i} className="btn btn--xs btn--ghost press" onClick={() => run(a, false, `${m.id}:${JSON.stringify(a)}`)} data-testid={`ai-action-${a.type}`}>{displayText(m, a.label)}</button>
                      ))}
                    </div>
                  )}
                  {(m.a.more?.length ?? 0) > 0 && <ul data-testid="ai-more">{m.a.more!.map((l, i) => <li key={i}>{l}</li>)}</ul>}
                  {m.a.sources.length > 0 && (
                    <ul>
                      {m.a.sources.map((s, i) => (
                        <li key={i}>
                          <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>{s.when ? ` · ${s.when}` : ""}
                          {s.title && <em className="bubble__orig" lang="en">Titre d’origine : {redact(s.title)}</em>}
                          {s.quote && <q lang="en">{redact(s.quote.slice(0, 220))}</q>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.engine === "claude" && <p className="bubble__engine" data-testid="ai-engine">Rédigé par {m.model ?? "Claude"} à partir des données LEONIDA RADAR{m.web?.status === "ok" ? ` et de ${m.web.count} résultat${m.web.count > 1 ? "s" : ""} web (Exa)` : ""}</p>}
                </details>
              )}
              {m === lastAi && !m.streaming && ((m.a.replies?.length ?? 0) > 0 || m.engine === "claude") && (
                <div className="bubble__replies">
                  {m.engine === "claude" && m.a.intent !== "checklist" && !(m.a.replies ?? []).some((r) => /^d[ée]taille/i.test(r)) && (
                    <button className="chip chip--reply press" onClick={() => ask("Détaille ta dernière réponse.")} data-testid="ai-detail">Détaille</button>
                  )}
                  {(m.a.replies ?? []).map((r) => (
                    <button key={r} className="chip chip--reply press" onClick={() => ask(r)} data-testid="ai-reply">{redact(r)}</button>
                  ))}
                </div>
              )}
              {m.note && <p className="bubble__note" data-testid="ai-note">{m.note}</p>}
              {m.llm && m.llm !== "pending" && m.llm !== "generated" && m.llm !== "cached" && m.llm !== "skipped" && (
                <p className="bubble__note" data-testid="ai-llm-note">Réponse directe : la synthèse IA n’est pas disponible pour le moment.</p>
              )}
            </article>
          ),
        )}
      </div>
      {away && (
        <button className="ai__jump press" onClick={() => { stickRef.current = true; setAway(false); toBottom(); }} data-testid="ai-jump">
          <Icon name="arrow" size={13} /> Dernier message
        </button>
      )}
      <VisionAttach.Tray atts={atts} purpose={purpose} error={attErr} onRemove={removeAtt} />
      <form
        className="ai__input"
        onSubmit={(e) => {
          e.preventDefault();
          sendNow();
        }}
      >
        {transport && <VisionAttach.Button limits={vlim} count={atts.length} onFiles={addFiles} disabled={streaming} />}
        <div className="ai__field">
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={(e) => {
              // clavier physique (iPad, ordinateur) : Entrée envoie, Maj+Entrée va à la ligne ; écran tactile : Entrée = retour à la ligne
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && finePointer()) {
                e.preventDefault();
                sendNow();
              }
            }}
            onFocus={() => setTimeout(() => stickRef.current && toBottom(), 320)}
            placeholder="Demande à LEONIDA…"
            enterKeyHint="enter"
            aria-label="Question pour LEONIDA AI"
            data-testid="ai-input"
            maxLength={MAX_CHARS}
            autoComplete="off"
            autoCorrect="on"
            spellCheck
          />
          {text.length > MAX_CHARS * 0.75 && <span className="ai__count" aria-live="polite">{text.length.toLocaleString("fr-FR")} / {MAX_CHARS.toLocaleString("fr-FR")}</span>}
        </div>
        {streaming ? (
          <button type="button" className="ai__send ai__send--stop press" onClick={() => ctlRef.current?.abort()} aria-label="Arrêter la réponse" data-testid="ai-stop"><span className="ai__stopsq" /></button>
        ) : (
          <button type="submit" className="ai__send press" disabled={!text.trim() && !atts.length} aria-label="Envoyer" data-testid="ai-send"><Icon name="arrow" size={18} /></button>
        )}
      </form>
    </div>
  );

  return (
    <>
      {/* V0.14 : plus de bouton flottant — LEONIDA est au centre du dock (et dans la barre latérale iPad) */}
      {aiOpen && !isTablet && (
        <div className="ailayer">
          <Sheet tall handleOnly initial={view === "carte" ? "half" : "full"} onClose={() => setAiOpen(false)} testId="ai-sheet" label="LEONIDA AI">
            {body}
          </Sheet>
        </div>
      )}
      {isTablet && <AiSidePanel open={aiOpen}>{body}</AiSidePanel>}
      {isTablet && aiOpen && <DockSpace />}
      {isTablet && aiOpen && <div className="aiscrim" onClick={() => setAiOpen(false)} aria-hidden data-testid="ai-scrim" />}
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

/** « Rien à manquer » : ce qui est vérifié, ce qui est incertain ; chaque élément peut devenir un objectif facultatif. */
function ChecklistView({ c, mission }: { c: NonNullable<CopilotAnswer["checklist"]>; mission: string }) {
  const { state, addObjective } = useStore();
  const has = (t: string) => (state.profile.objectives ?? []).some((o) => o.mission.toLowerCase() === mission.toLowerCase() && o.text.toLowerCase() === t.toLowerCase());
  const block = (title: string, items: typeof c.verified, basis: "vérifié" | "incertain", tid: string) =>
    items.length > 0 && (
      <div className={`chk chk--${basis === "vérifié" ? "ok" : "warn"}`} data-testid={tid}>
        <p className="chk__title">{title}</p>
        <ul>
          {items.map((it, i) => (
            <li key={i}>
              <span className="chk__text">
                {it.text}
                {it.source && <a href={it.source.url} target="_blank" rel="noreferrer" className="chk__src">{it.source.name}</a>}
              </span>
              {mission && (has(it.text) ? (
                <span className="chk__added" aria-label="Déjà dans tes objectifs"><Icon name="check" size={14} /></span>
              ) : (
                <button className="btn btn--xs btn--ghost press" onClick={() => { tick(); addObjective({ mission, text: it.text, basis, source: it.source ? { name: it.source.name, url: it.source.url } : undefined }); }} data-testid="checklist-add">
                  <Icon name="plus" size={12} /> Objectif
                </button>
              ))}
            </li>
          ))}
        </ul>
      </div>
    );
  if (!c.verified.length && !c.uncertain.length) return null;
  return (
    <div className="chks" data-testid="checklist">
      {block("Vérifié", c.verified, "vérifié", "checklist-verified")}
      {block("Incertain — à confirmer en jeu", c.uncertain, "incertain", "checklist-uncertain")}
    </div>
  );
}

/** iPad : réserve la place du panneau LEONIDA à côté de la carte (elle se redimensionne au lieu d'être couverte). */
function DockSpace() {
  useEffect(() => {
    document.documentElement.classList.add("ai-docked");
    return () => document.documentElement.classList.remove("ai-docked");
  }, []);
  return null;
}
