import { STORY_NODES } from "@/data/story";
import { computeProgress, nextPointOfNoReturn, nodeByName, shownName } from "./progress";
import type { NodeState, ProgressView } from "./progress";
import { progressDelta } from "./ai/progressAnswers";
import { coverageOf, findStoryNode } from "./story/engine";
import type { Coverage } from "./story/model";
import { nk } from "./missions";
import type { PersistedState } from "./types";

/**
 * LEONIDA MISSION AUTOPILOT (V0.18) — « où j'en suis, et ce que je peux faire ensuite ».
 *
 * Couche de lecture au-dessus du moteur de progression (computeProgress) et du delta après « Terminée »
 * (progressDelta) : aucune nouvelle déduction. Règles :
 *   - la suite vient du GRAPHE sourcé (prérequis), jamais de l'ordre d'un guide ;
 *   - rien n'est enregistré sans confirmation : l'Autopilot PROPOSE, le joueur choisit, prépare, lance ;
 *   - un indice faible (Story Recap) donne « probablement faite », jamais « terminée » : le joueur confirme ;
 *   - quand le graphe ne couvre pas la suite (chapitres 2 à 5, mission inconnue), l'incertitude est dite et
 *     le choix manuel reste possible.
 */

/** États distincts d'une mission pour le joueur. */
export type MissionState = "terminée" | "envisagée" | "commencée" | "accessible" | "potentiellement accessible" | "inconnue" | "expirée";

export interface NextOption {
  id: string;
  /** Nom affichable (anti-spoiler appliqué). */
  name: string;
  kind: "main" | "side" | "activity";
  state: MissionState;
  /** Pourquoi on la propose, en clair. */
  why: string;
  /** Vient de s'ouvrir avec la dernière mission terminée. */
  fresh: boolean;
  /** Disparaît plus tard (fenêtre documentée). */
  missable: boolean;
  /** Son lancement est un point de non-retour. */
  pnr: boolean;
}

export type AutopilotMode = "en mission" | "envisagée" | "à choisir" | "exploration";

export interface Autopilot {
  mode: AutopilotMode;
  /** Dernière mission terminée déclarée (nom tel que saisi, et reconnu ou non par le graphe). */
  last: { name: string; known: boolean } | null;
  planned: { name: string; known: boolean } | null;
  started: { name: string; known: boolean } | null;
  /** Missions principales qu'on peut lancer (graphe). */
  mains: NextOption[];
  /** Missions SECONDAIRES encore ouvertes (se choisissent comme une mission). */
  sides: NextOption[];
  /** Activités LIBRES ouvertes (épargne, collecte…) : jamais une mission, se cochent « Fait » (V0.18.1). */
  activities: NextOption[];
  /** Missions principales antérieures non déclarées mais probablement faites : à confirmer (realName sert à enregistrer). */
  likely: Array<NextOption & { realName: string }>;
  /** Mission unique à proposer quand une seule suite principale est documentée. */
  suggestion: NextOption | null;
  /** Le graphe ne permet pas de déterminer la suite : raison en clair. */
  uncertain: string | null;
  /** Point de non-retour proche (lancement d'une des suites proposées). */
  pnr: { where: string; lose: string[] } | null;
  coverage: { chapter: number; level: Coverage };
  /** Noms proposés pour le choix manuel (sans spoiler). */
  manual: string[];
}

const STATE_OF: Record<NodeState["status"], MissionState> = {
  terminé: "terminée",
  "en cours": "commencée",
  accessible: "accessible",
  "potentiellement accessible": "potentiellement accessible",
  verrouillé: "inconnue",
  inconnu: "inconnue",
  "plus disponible": "expirée",
};

function whyOf(x: NodeState): string {
  const p = x.node.prereq;
  if (!p) return "prérequis non documentés";
  const n = p.sources.length;
  const base = x.status === "accessible" ? `prérequis faits · ${n} sources` : p.basis === "déduit" ? "prérequis déduits par les guides · à confirmer en jeu" : `prérequis faits · ${n === 1 ? "une seule source" : `${n} sources`} · à confirmer en jeu`;
  return [base, x.node.chapter === 2 ? p.condition : null, p.note].filter(Boolean).join(" · ");
}

function option(x: NodeState, v: ProgressView, s: Pick<PersistedState, "profile">, fresh: Set<string>): NextOption {
  return {
    id: x.node.id,
    name: shownName(x, s.profile.spoilerMode),
    kind: x.node.kind,
    state: v.planned?.node.id === x.node.id ? "envisagée" : STATE_OF[x.status],
    why: whyOf(x),
    fresh: fresh.has(x.node.id),
    missable: !!x.node.lostAt || !!x.node.hub?.missable,
    pnr: !!x.node.pointOfNoReturn,
  };
}

/** État complet de l'Autopilot pour l'Accueil, la Partie et LEONIDA AI (une seule source de vérité). */
export function autopilot(s: Pick<PersistedState, "profile"> & { done?: Record<string, string> }): Autopilot {
  const p = s.profile;
  const v = computeProgress(s);
  const known = (n: string | null | undefined) => !!n && (!!nodeByName(n) || !!findStoryNode(n));
  const last = p.lastMission ? { name: p.lastMission, known: known(p.lastMission) } : null;
  const planned = p.nextMission && !p.missionInProgress ? { name: p.nextMission, known: known(p.nextMission) } : null;
  const started = p.nextMission && p.missionInProgress ? { name: p.nextMission, known: known(p.nextMission) } : null;
  // ce qui vient de s'ouvrir avec la dernière mission terminée (même calcul que le message après « Terminée »)
  const fresh = new Set<string>();
  if (p.lastMission && nodeByName(p.lastMission)) {
    const before = { ...p, missionsDone: p.missionsDone.filter((m) => nk(m) !== nk(p.lastMission!)), lastMission: null };
    const d = progressDelta(before, p.lastMission, s.done ?? {});
    for (const x of [...d.mains, ...d.potentials, ...d.sides]) fresh.add(x.node.id);
  }
  const open = (x: NodeState) => x.status === "accessible" || x.status === "potentiellement accessible";
  const byRank = (a: NextOption, b: NextOption) => Number(b.fresh) - Number(a.fresh) || (a.state === "accessible" ? 0 : 1) - (b.state === "accessible" ? 0 : 1);
  const mains = v.states.filter((x) => x.node.kind === "main" && open(x) && shownName(x, p.spoilerMode) === x.node.name && !x.likelyDone && x.node.chapter === p.chapter).map((x) => option(x, v, s, fresh)).sort(byRank);
  const optional = v.states.filter((x) => x.node.kind !== "main" && open(x) && x.node.chapter === p.chapter).map((x) => option(x, v, s, fresh)).sort((a, b) => Number(b.missable) - Number(a.missable) || byRank(a, b));
  const sides = optional.filter((x) => x.kind === "side");
  const activities = optional.filter((x) => x.kind === "activity");
  // nom réel gardé pour la confirmation ; nom affiché masqué si l'anti-spoiler le cache
  const likely = v.states.filter((x) => x.likelyDone && x.node.chapter === p.chapter).map((x) => ({ ...option(x, v, s, fresh), realName: x.node.name, why: "placée avant une mission que tu as terminée dans le récapitulatif du jeu (indice faible)" }));
  // V0.20 : chapitre 1 audité ; chapitres suivants = graphe partiel lu sur GTABase (une source, prérequis cités)
  const hubLinks = v.states.filter((x) => x.node.chapter === p.chapter && x.node.kind === "main" && x.node.origin === "hub" && x.node.prereq).length;
  const graphCovers = p.chapter === 1 || hubLinks >= 3;
  let uncertain: string | null = null;
  if (!graphCovers) uncertain = `Le chapitre ${p.chapter} n'a pas encore de graphe de missions suffisant : je ne peux pas calculer la suite. Indique la mission affichée dans ton jeu.`;
  else if (p.chapter > 1 && !mains.length)
    uncertain = `Graphe partiel pour le chapitre ${p.chapter} (prérequis incomplètement documentés) : vérifie les repères sur ta carte en jeu. Indique l’objectif affiché pour préparer la suite.`;
  else if (last && !last.known) uncertain = `« ${last.name} » n'est pas dans mon graphe : je ne sais pas ce qu'elle débloque. Choisis la suite toi-même.`;
  else if (!mains.length)
    uncertain = last
      ? `Les sources ne documentent pas ce que « ${last.name} » débloque (prérequis des missions suivantes inconnus). Regarde ta carte en jeu et indique la mission.`
      : "Indique ta dernière mission terminée ou la mission affichée dans ton jeu : je calcule la suite à partir de là.";
  if (p.chapter === 2 && p.spoilerMode === "strict" && nodeByName(p.lastMission)?.id === "ambulance-chaser")
    uncertain = "Après l’ambulance, plusieurs tâches du motel peuvent rester ouvertes. Vérifie le journal des courses pour Jason et l’objectif à la réception. Tu peux décrire ce que tu as fait au copilote.";
  const pnrNode = nextPointOfNoReturn(v);
  const pnrSoon = pnrNode && mains.some((m) => m.id === pnrNode.node.id || (!!pnrNode.missing?.length && pnrNode.missing.every((x) => x.id === m.id || x.id === v.planned?.node.id || x.id === v.current?.node.id)));
  const pnr = pnrSoon && pnrNode?.node.pointOfNoReturn
    ? { where: shownName(pnrNode, p.spoilerMode) === pnrNode.node.name ? `au début de ${pnrNode.node.name}` : "au début d'une mission principale à venir", lose: pnrNode.node.pointOfNoReturn.lose }
    : null;
  // choix manuel : missions du chapitre atteint (graphe + inventaire), jamais celles d'un chapitre non atteint
  const doneNames = new Set([...p.missionsDone, p.lastMission ?? ""].map((m) => nk(m)));
  const manual = [
    ...v.states.filter((x) => x.node.kind !== "activity" && x.node.chapter <= p.chapter && x.status !== "terminé" && x.status !== "plus disponible" && shownName(x, p.spoilerMode) === x.node.name).map((x) => x.node.name),
    ...STORY_NODES.filter((n) => p.spoilerMode !== "strict" && n.chapter <= p.chapter && (n.kind === "main" || n.kind === "side")).map((n) => n.name),
  ].filter((n, i, a) => a.indexOf(n) === i && !doneNames.has(nk(n)));
  const mode: AutopilotMode = started ? "en mission" : planned ? "envisagée" : p.exploring ? "exploration" : "à choisir";
  return {
    mode,
    last,
    planned,
    started,
    mains,
    sides: sides.slice(0, 6),
    activities: activities.slice(0, 4),
    likely,
    suggestion: graphCovers && mains.length === 1 ? mains[0] : null,
    uncertain,
    pnr,
    coverage: { chapter: p.chapter, level: coverageOf(p.chapter).level },
    manual: manual.sort(),
  };
}

/** Bloc du contexte de LEONIDA AI : le joueur n'a jamais à répéter où il en est. */
export function autopilotContext(s: Pick<PersistedState, "profile"> & { done?: Record<string, string> }): string {
  const a = autopilot(s);
  const names = (xs: NextOption[]) => xs.map((x) => `${x.name}${x.state === "potentiellement accessible" ? " (à confirmer)" : ""}${x.missable ? " — manquable" : ""}`).join(" ; ");
  const lines = ["SUIVI DES MISSIONS (Mission Autopilot, état déclaré par le joueur, rien n'est détecté automatiquement) :"];
  lines.push(`- Dernière mission terminée : ${a.last ? a.last.name : "aucune déclarée"}`);
  lines.push(
    a.mode === "en mission"
      ? `- Mission COMMENCÉE : ${a.started!.name}`
      : a.mode === "envisagée"
        ? `- Mission ENVISAGÉE (pas encore lancée) : ${a.planned!.name}`
        : a.mode === "exploration"
          ? "- Le joueur explore librement (aucune mission choisie, ne lui en impose pas)"
          : "- Aucune mission choisie : propose les suites ci-dessous, il confirme lui-même",
  );
  if (a.mains.length) lines.push(`- Missions principales accessibles : ${names(a.mains)}`);
  if (a.sides.length) lines.push(`- Missions secondaires encore ouvertes : ${names(a.sides)}`);
  if (a.activities.length) lines.push(`- Activités libres ouvertes (PAS des missions : ne les propose jamais comme prochaine mission, elles se cochent « Fait ») : ${names(a.activities)}`);
  if (a.likely.length) lines.push(`- ${a.likely.length} mission(s) antérieure(s) probablement faite(s) mais non déclarée(s) (ne les compte pas comme terminées, propose de confirmer dans l'Accueil) : ${a.likely.filter((x) => x.name === x.realName).map((x) => x.name).join(", ") || "noms masqués par l'anti-spoiler"}`);
  if (a.uncertain) lines.push(`- Incertitude : ${a.uncertain}`);
  if (a.pnr) lines.push(`- Point de non-retour proche ${a.pnr.where}`);
  lines.push(`- Couverture du référentiel, chapitre ${a.coverage.chapter} : ${a.coverage.level}`);
  return lines.join("\n");
}
