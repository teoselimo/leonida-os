import type { RadarFeed } from "./feed";
import type { Src } from "@/data/progression";
import type { DiscoverItem } from "./discover";
import { DISCOVER_CATS } from "./discover";
import type { SessionItem } from "./session";
import { computeProgress, nextPointOfNoReturn, nodeByName, pendingMissables, shownName } from "./progress";
import type { NodeState } from "./progress";
import { nk } from "./missions";
import type { BriefItem, MissionAlertBrief, PersistedState } from "./types";
import { redactorFor } from "./spoiler";
import { srcsVerified, storyAlerts } from "./story/engine";
import type { StoryAlert } from "./story/engine";

/**
 * « À faire avant de continuer » (V0.14) : UNE liste priorisée qui remplace « Rien à manquer », les pertes de
 * « À découvrir » et « Avant de la lancer ». Les données restent là où elles sont enregistrées (analyse de mission,
 * graphe de progression, fiches de la veille, objectifs) : seule la PRÉSENTATION est unifiée.
 *
 * Types distingués : objet à récupérer PENDANT la mission, préparation AVANT de la lancer, activité qui peut
 * DISPARAÎTRE plus tard. Statut de preuve unique : Vérifié / Probable / Non confirmé (jamais une perte probable
 * présentée comme certaine). Le point de non-retour n'est mentionné qu'une fois, et seuls les éléments documentés
 * comme perdus à ce moment-là y sont rattachés.
 */
export type Trust3 = "Vérifié" | "Probable" | "Non confirmé" | "Contesté";
export type BeforeKind = "pendant" | "avant" | "disparait" | "opportunite";

export const BEFORE_KIND_FR: Record<BeforeKind, string> = {
  pendant: "À récupérer pendant la mission",
  avant: "Avant de la lancer",
  disparait: "Peut disparaître plus tard",
  opportunite: "Opportunité",
};

export interface BeforeItem {
  key: string;
  text: string;
  kind: BeforeKind;
  status: Trust3;
  /** Perte documentée et vérifiée (ou objet unique de la mission) : mis en avant. */
  high: boolean;
  /** Perdu au point de non-retour commun (mentionné une seule fois sous la liste). */
  atPnr: boolean;
  /** Moment propre à l'élément quand il diffère du point de non-retour commun. */
  when: string | null;
  sources: Src[];
  detail: string[];
  /** Icône / couleur (catégorie de découverte) pour la liste « Si tu as le temps ». */
  cat: DiscoverItem["cat"];
  /** Comment le marquer fait — chaque type garde son stockage. */
  done: { type: "done"; key: string; kind: "arme" | "objet" | "argent" | "secret" | "activite" | "vehicule" } | { type: "objective"; mission: string; text: string; source?: Src };
  map: DiscoverItem["map"];
  recordId?: string;
}

export interface BeforeView {
  mission: string | null;
  critical: BeforeItem[];
  optional: BeforeItem[];
  /** Point de non-retour commun, sans spoiler (« au début d'une mission principale à venir »). */
  pnr: string | null;
  /** Le joueur n'a encore aucune analyse de cette mission. */
  analysed: boolean;
}

const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
const sites = (s: Src[]) => new Set(s.map((x) => host(x.url))).size;
const fromDiscover = (s: DiscoverItem["status"]): Trust3 => (s === "vérifié" ? "Vérifié" : s === "probable" ? "Probable" : "Non confirmé");
const fromBrief = (s: BriefItem["status"]): Trust3 => (s === "confirmé" ? "Vérifié" : s === "une source" ? "Probable" : "Probable");
const sim = (a: string, b: string) => {
  const x = nk(a).slice(0, 28);
  const y = nk(b).slice(0, 28);
  return !!x && !!y && (x.includes(y.slice(0, 18)) || y.includes(x.slice(0, 18)));
};

const KIND_DONE = (cat: DiscoverItem["cat"], recordCat?: string): "arme" | "objet" | "argent" | "secret" | "activite" | "vehicule" =>
  recordCat === "weapon" ? "arme" : recordCat === "unique_item" ? "objet" : cat === "argent" ? "argent" : cat === "vehicule" ? "vehicule" : cat === "unique" ? "objet" : cat === "annexe" || cat === "perte" ? "activite" : "secret";

export function buildBefore(
  s: Pick<PersistedState, "profile" | "done" | "vehicles" | "briefs" | "story">,
  feed: RadarFeed | null,
  discover: DiscoverItem[],
  planBefore: SessionItem[],
  brief: MissionAlertBrief | undefined,
): BeforeView {
  const p = s.profile;
  const v = computeProgress(s);
  const red = redactorFor(s, feed);
  const mission = p.nextMission ?? null;
  const node = mission ? nodeByName(mission) : null;
  const objectives = (p.objectives ?? []).filter((o) => mission && o.mission.toLowerCase() === mission.toLowerCase());
  const inObjectives = (t: string) => objectives.some((o) => sim(o.text, t));
  const critical: BeforeItem[] = [];
  const optional: BeforeItem[] = [];
  const seen: string[] = [];
  // V0.17 : une règle Story Intelligence retenue couvre les fiches équivalentes (mêmes mots-clés) → pas de doublon
  const storyMatch: string[] = [];
  const isDup = (t: string) => seen.some((x) => sim(x, t)) || storyMatch.some((m) => nk(t).includes(m));
  const push = (list: BeforeItem[], it: BeforeItem) => {
    if (isDup(it.text)) return;
    seen.push(it.text);
    list.push({ ...it, text: red(it.text), when: it.when ? red(it.when) : it.when, detail: it.detail.map(red) });
  };

  // point de non-retour commun (graphe) — nommé sans spoiler
  const pnrSt: NodeState | null = nextPointOfNoReturn(v);
  const pnr = pnrSt ? (shownName(pnrSt, p.spoilerMode) === pnrSt.node.name ? `au début de ${pnrSt.node.name}` : "au début d'une mission principale à venir") : null;
  const atPnr = (lost: DiscoverItem["lost"]) => !!pnrSt && !!lost && lost.node === pnrSt.node.id && lost.at === "start";
  const lostWhen = (lost: DiscoverItem["lost"], fallback: string | null) => {
    if (!lost) return fallback;
    const st = v.byId.get(lost.node);
    if (!st) return fallback;
    const n = shownName(st, p.spoilerMode);
    const ref = n === st.node.name ? n : "d'une mission à venir";
    return `${lost.at === "start" ? "disparaît au début" : "disparaît à la fin"} ${ref.startsWith("d'") ? ref : `de ${ref}`}`;
  };

  // 0. Story Intelligence (V0.17) : règles sourcées encore à venir dans ce chapitre — même liste que LEONIDA AI
  for (const a of storyAlerts(s)) {
    if (a.horizon !== "imminent" && a.horizon !== "chapitre") continue;
    if (a.tier === "À explorer") continue;
    const it = storyItem(a, !!p.missionInProgress);
    if (isDup(it.text)) continue;
    // le conseil est déjà rédigé sans spoiler par le moteur : on l'insère tel quel
    seen.push(it.text);
    (a.tier === "Intéressant" ? optional : critical).push(it);
    storyMatch.push(...(a.rule.match ?? []).map((m) => nk(m)));
  }

  // 1. manquables documentés de LA mission (graphe sourcé), hors objectifs déjà notés / récupérés
  if (node && mission) {
    const collected = (p.objectives ?? []).filter((o) => o.done).map((o) => o.text);
    for (const m of pendingMissables(v.current?.node.id === node.id || v.planned?.node.id === node.id ? v : { ...v, current: v.byId.get(node.id) ?? null, planned: null }, collected)) {
      if (inObjectives(m.text)) continue;
      push(critical, {
        key: `mis:${nk(m.text).slice(0, 40)}`,
        text: m.text,
        kind: m.when === "avant" ? "avant" : "pendant",
        status: srcsVerified(m.sources) ? "Vérifié" : "Probable",
        high: true,
        atPnr: false,
        when: m.when === "pendant" ? "pendant la mission" : m.when === "apres" ? "juste après la mission" : "avant de la lancer",
        sources: m.sources,
        detail: [m.locationCertain ? "" : "Emplacement exact incertain selon les sources."].filter(Boolean),
        cat: "unique",
        done: { type: "objective", mission, text: m.text, source: m.sources[0] },
        map: null,
      });
    }
  }
  // 2. analyse « Rien à manquer » enregistrée pour CETTE mission (Claude + web), hors objectifs
  for (const b of brief?.items ?? []) {
    if (!mission || inObjectives(b.text)) continue;
    const high = b.priority === "haute" && b.status === "confirmé";
    push(b.priority === "haute" || b.kind === "manquable" || b.kind === "objet_unique" ? critical : optional, {
      key: `brief:${nk(b.text).slice(0, 40)}`,
      text: b.text,
      kind: b.when === "pendant" ? "pendant" : b.when === "avant" ? "avant" : "disparait",
      status: fromBrief(b.status),
      high,
      atPnr: false,
      when: b.when === "pendant" ? "pendant la mission" : b.when === "apres" ? "juste après la mission" : "avant de la lancer",
      sources: b.sources,
      detail: b.note ? [`Sources divergentes : ${b.note}`] : [],
      cat: b.kind === "objet_unique" ? "unique" : "perte",
      done: { type: "objective", mission, text: b.text, source: b.sources[0] },
      map: null,
    });
  }
  // 3. découvertes : pertes → liste principale ; le reste → « Si tu as le temps »
  for (const d of discover) {
    const lostAtPnr = atPnr(d.lost);
    const it: BeforeItem = {
      key: d.key,
      text: d.name,
      kind: d.cat === "perte" ? "disparait" : "opportunite",
      status: fromDiscover(d.status),
      high: d.importance === "haute",
      atPnr: d.cat === "perte" && lostAtPnr,
      when: d.cat === "perte" && !lostAtPnr ? lostWhen(d.lost, d.noReturn) : null,
      sources: d.sources,
      detail: d.detail,
      cat: d.cat,
      done: { type: "done", key: d.key, kind: KIND_DONE(d.cat, d.recordId ? feed?.items.find((r) => r.id === d.recordId)?.category : undefined) },
      map: d.map,
      recordId: d.recordId,
    };
    push(d.cat === "perte" ? critical : optional, it);
  }
  // 4. fiches « Avant de la lancer » de la veille non couvertes ci-dessus
  for (const b of planBefore) {
    if (discover.some((d) => d.key === b.recordId || d.key === `veh:${b.vehicleId}`)) continue;
    push(b.urgent ? critical : optional, {
      key: b.recordId ?? `veh:${b.vehicleId}`,
      text: b.title,
      kind: b.urgent ? "disparait" : "opportunite",
      status: b.reliability === "official" || b.reliability === "confirmed" ? "Vérifié" : b.reliability === "reported" ? "Probable" : "Non confirmé",
      high: b.urgent && (b.reliability === "official" || b.reliability === "confirmed"),
      atPnr: false,
      when: b.urgent ? b.sub : null,
      sources: [],
      detail: [b.sub],
      cat: b.vehicleId ? "vehicule" : "argent",
      done: { type: "done", key: b.recordId ?? `veh:${b.vehicleId}`, kind: b.vehicleId ? "vehicule" : "secret" },
      map: b.vehicleId ? { vehicleId: b.vehicleId } : null,
      recordId: b.recordId,
    });
  }

  // priorité : en mission, ce qui se récupère pendant ; sinon pertes vérifiées, préparation, manquables, puis probables
  const live = !!p.missionInProgress;
  const rank = (x: BeforeItem) =>
    (live && x.kind === "pendant" ? 0 : 10) + (x.high && x.status === "Vérifié" ? 0 : x.status === "Vérifié" ? 2 : 4) + (x.kind === "avant" ? 0 : x.kind === "pendant" ? 1 : 2) * 0.5;
  critical.sort((a, b) => rank(a) - rank(b));
  const anyPnr = critical.some((x) => x.atPnr);
  return { mission, critical, optional, pnr: anyPnr ? pnr : null, analysed: !!brief };
}

const TRUST_OF: Record<StoryAlert["confidence"], Trust3> = { Vérifié: "Vérifié", Probable: "Probable", "Non confirmé": "Non confirmé", Contesté: "Contesté" };

/** Règle Story Intelligence → élément de la liste unique (conseil sans spoiler, explication en détail). */
function storyItem(a: StoryAlert, live: boolean): BeforeItem {
  const r = a.rule;
  const money = r.effects.some((e) => "resource" in e && !!e.resource);
  const endTrigger = !!r.trigger && "node" in r.trigger && r.trigger.at === "end";
  return {
    key: a.key,
    text: a.advice,
    kind: a.horizon === "imminent" ? (endTrigger && live ? "pendant" : "avant") : r.kind === "opportunité" ? "opportunite" : "disparait",
    status: TRUST_OF[a.confidence],
    high: a.tier === "Critique" && a.confidence === "Vérifié",
    atPnr: false,
    when: a.when,
    sources: a.sources,
    detail: [a.uncertain ?? "", a.money ?? "", a.explain ?? (a.masked ? "Raison masquée par l'anti-spoiler." : ""), ...a.contradictions.map((c) => `Sources divergentes : ${c}`), `Niveau : ${a.tier}${r.reversible ? "" : " · irréversible"}`, `Confiance « ${a.confidence} » : ${a.confidenceWhy}`].filter(Boolean),
    cat: money ? "argent" : r.kind === "manquable" ? "unique" : r.kind === "opportunité" ? "argent" : "perte",
    done: { type: "done", key: a.key, kind: money ? "argent" : "activite" },
    map: null,
  };
}

export const catIcon = (c: DiscoverItem["cat"]) => DISCOVER_CATS[c];
