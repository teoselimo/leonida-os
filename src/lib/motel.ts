import { MOTEL_REPORTS } from "@/data/chapter2";
import { PROG_BY_ID } from "@/data/progression";
import type { ProgNode } from "@/data/progression";
import { nk } from "./missions";
import { computeProgress, shownName } from "./progress";
import type { NodeState } from "./progress";
import { storyAlerts } from "./story/engine";
import type { StoryAlert } from "./story/engine";
import type { PersistedState } from "./types";

/**
 * Situation du chapitre 2 (issue #19) — couche de LECTURE, jamais d'écriture dans la sauvegarde.
 *
 * Cinq niveaux distincts, jamais confondus :
 *   - confirmé par le joueur (missions déclarées terminées / en cours) ;
 *   - raconté au copilote, probablement en cours, NON confirmé (relu dans l'historique du chat déjà conservé) ;
 *   - accessible selon les sources (graphe) ;
 *   - condition à remplir dans le monde (affiche, appel, SMS, commande…) ;
 *   - objectif de chapitre à plus long terme (seuil de fin de chapitre, pas imminent).
 */

/** Clé de l'historique du chat (inchangée depuis V0.7.1 ; ne fait pas partie de la sauvegarde de progression). */
export const HISTORY_KEY = "leonida-os/ai-history/v2";
/** Événement émis quand l'historique du chat change (l'Accueil relit les tâches racontées). */
export const HISTORY_EVENT = "leonida:history";

/** Formulations courtes pour l'Accueil (sans nom de mission) et la relance du copilote. */
export const REPORT_WORDS: Record<string, { label: string; told: string }> = {
  "ambulance-chaser": { label: "ambulance à faire disparaître", told: "fait disparaître l’ambulance" },
  "just-moved-in": { label: "provisions pour Jason", told: "récupéré les provisions pour Jason" },
  "overnight-charges": { label: "conversation à la réception", told: "parlé à la gérante" },
};

export interface ReportedTask {
  id: string;
  /** Nom réel (pour la confirmation). */
  name: string;
  label: string;
  told: string;
}

type ProgInput = Pick<PersistedState, "profile"> & { done?: Record<string, string> };

/** Messages du joueur conservés dans l'historique du chat (texte seulement), lus sans jamais écrire. */
export function readChatTexts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(v) ? v.filter((m) => m?.role === "user" && typeof m.text === "string").map((m) => m.text as string).slice(-40) : [];
  } catch {
    return [];
  }
}

/**
 * Tâches du motel que le joueur a RACONTÉES au copilote et qui ne sont pas confirmées dans sa progression.
 * Une tâche déclarée terminée, ou choisie comme mission (en cours / prévue), n'est plus « racontée » : elle est confirmée.
 */
export function reportedTasks(texts: string[], s: ProgInput, except: string[] = []): ReportedTask[] {
  const p = s.profile;
  if (p.chapter !== 2) return [];
  const v = computeProgress(s);
  const confirmed = new Set([...p.missionsDone, p.lastMission ?? "", p.nextMission ?? "", ...except].map((m) => nk(m)));
  const seen = new Set<string>();
  for (const t of texts) for (const r of MOTEL_REPORTS) if (r.pattern.test(nk(t))) seen.add(r.id);
  return MOTEL_REPORTS.filter((r) => seen.has(r.id))
    .map((r) => PROG_BY_ID.get(r.id))
    .filter((n): n is ProgNode => !!n && !confirmed.has(nk(n.name)) && v.byId.get(n.id)?.status !== "terminé")
    .map((n) => ({ id: n.id, name: n.name, ...REPORT_WORDS[n.id] }));
}

/** « avoir récupéré les provisions pour Jason et parlé à la gérante » */
export function toldLine(xs: ReportedTask[]): string {
  const t = xs.map((x) => x.told);
  return t.length <= 1 ? t.join("") : `${t.slice(0, -1).join(", ")} et ${t[t.length - 1]}`;
}

/** Relance du copilote après une confirmation : rappelle ce que le joueur a raconté, sans rien enregistrer. */
export function reportedReminder(xs: ReportedTask[]): string {
  if (!xs.length) return "";
  return `Tu m’avais aussi indiqué avoir ${toldLine(xs)}. Je ne ${xs.length > 1 ? "les" : "la"} marque pas comme ${xs.length > 1 ? "terminées" : "terminée"} sans confirmation. Vérifie ce que ton journal affiche et je mets la suite à jour.`;
}

const EXTERNAL = /affiche|appel|sms|commande|lire |message|attendre/i;
/**
 * Condition à remplir DANS LE MONDE (affiche, appel, SMS…) avant qu'une tâche soit réellement disponible ; null sinon.
 * Limitée aux conditions auditées du chapitre 2 (`MOTEL_UNLOCKS`, qui ne citent que des personnages) : au chapitre 1,
 * certaines conditions nomment une mission future et resteraient un spoiler en mode strict.
 */
export function externalCondition(node: ProgNode): string | null {
  if (node.chapter !== 2) return null;
  const c = node.prereq?.condition;
  return c && EXTERNAL.test(c) ? c : null;
}

/** Une alerte de seuil (objectif de fonds) qui n'est pas imminente : objectif du chapitre, pas « Avant de continuer ». */
export function isChapterGoal(a: StoryAlert): boolean {
  return a.horizon !== "imminent" && a.rule.effects.some((e) => e.k === "threshold");
}

export interface MotelSituation {
  title: string;
  /** Confirmé par le joueur : dernière étape déclarée. */
  confirmed: string | null;
  reported: ReportedTask[];
  /** Accessible selon les sources (facultatif, nom visible en mode strict). */
  accessible: string[];
  /** Condition à remplir dans le monde. */
  conditional: Array<{ name: string; condition: string }>;
  /** Objectifs du chapitre, plus tard. */
  goals: string[];
}

/** Carte de situation de l'Accueil, au chapitre 2 et sans mission choisie. */
export function motelSituation(s: ProgInput & Pick<PersistedState, "vehicles" | "done">, texts: string[]): MotelSituation | null {
  const p = s.profile;
  if (p.chapter !== 2 || p.nextMission || p.exploring) return null;
  const v = computeProgress(s);
  const checkout = v.byId.get("checking-out");
  if (checkout?.status === "terminé") return null;
  const mode = p.spoilerMode;
  const visible = (x: NodeState) => shownName(x, mode) === x.node.name;
  const open = (x: NodeState) => x.status === "accessible" || x.status === "potentiellement accessible";
  const reported = reportedTasks(texts, s);
  const reportedIds = new Set(reported.map((r) => r.id));
  const optional = v.states.filter((x) => x.node.chapter === 2 && x.node.kind !== "main" && !x.node.journalTask && open(x) && visible(x) && !reportedIds.has(x.node.id));
  const lastNode = p.lastMission ? [...v.byId.values()].find((x) => nk(x.node.name) === nk(p.lastMission!)) : null;
  return {
    title: "Chapitre 2 · Starlet Motel",
    confirmed: p.lastMission ? (lastNode && lastNode.node.chapter !== 2 ? `${p.lastMission} terminée (chapitre ${lastNode.node.chapter})` : `${p.lastMission} terminée`) : null,
    reported,
    accessible: optional.filter((x) => !externalCondition(x.node)).map((x) => x.node.name),
    conditional: optional.filter((x) => externalCondition(x.node)).map((x) => ({ name: x.node.name, condition: externalCondition(x.node)! })),
    goals: storyAlerts(s).filter(isChapterGoal).filter((a) => a.rule.chapter === 2).map((a) => a.advice),
  };
}
