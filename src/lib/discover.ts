import type { RadarFeed, RadarRecord } from "./feed";
import { spoilerVisibility } from "./feed";
import { viewOf } from "./garage";
import { frHeadline } from "./fr";
import { missionCatalog, nk } from "./missions";
import { computeProgress, nodeByName, progDoneKey, shownName } from "./progress";
import type { NodeState } from "./progress";
import { srcsVerified } from "./story/engine";
import type { Src } from "@/data/progression";
import type { PersistedState } from "./types";

/**
 * « À découvrir maintenant » (V0.13) : ce que le joueur peut faire tout de suite à côté de sa mission, calculé
 * depuis le moteur de progression (activités facultatives sourcées), les fiches du Radar et le garage.
 * - Priorité : risque de perte définitive VÉRIFIÉ, puis découvertes rares, puis activités annexes pertinentes.
 *   Une arme rare n'est pas « urgente » pour autant : seule la perte documentée rend urgent.
 * - Aucun doublon : les manquables de la mission en cours (« Rien à manquer »), ses objectifs et les éléments déjà
 *   affichés ailleurs sur l'accueil (`exclude`) sont retirés.
 * - « Fait » écrit dans `state.done` (date conservée) : l'élément sort des suggestions, l'historique reste.
 */

export type DiscoverCat = "perte" | "unique" | "annexe" | "vehicule" | "argent" | "secret";
export type DiscoverStatus = "vérifié" | "probable" | "inconnu";

export const DISCOVER_CATS: Record<DiscoverCat, { label: string; icon: "alert" | "gem" | "flag" | "car" | "bolt" | "sparkle"; color: string }> = {
  perte: { label: "Perte définitive possible", icon: "alert", color: "#FF6B8B" },
  unique: { label: "Objet ou arme unique", icon: "gem", color: "#B98CFF" },
  annexe: { label: "Mission annexe / rencontre", icon: "flag", color: "#2EE6D6" },
  vehicule: { label: "Véhicule rare ou caché", icon: "car", color: "#5AB8FF" },
  argent: { label: "Argent & butin", icon: "bolt", color: "#FFD166" },
  secret: { label: "Secret / activité", icon: "sparkle", color: "#FFB35C" },
};

export interface DiscoverItem {
  /** Clé de `state.done` (« Fait »). */
  key: string;
  cat: DiscoverCat;
  name: string;
  status: DiscoverStatus;
  importance: "haute" | "normale";
  /** Point de non-retour, nommé sans spoiler. */
  noReturn: string | null;
  sources: Src[];
  /** Détail affiché à la demande. */
  detail: string[];
  /** Action carte : uniquement si la position est fiable (repère nommé, zone ou point documentés). */
  map: { landmarkId?: string; vehicleId?: string; recordId?: string } | null;
  recordId?: string;
  vehicleId?: string;
  /** Moment documenté de la perte (nœud du graphe + début/fin), pour ne parler d'un point de non-retour commun que s'il l'est vraiment. */
  lost?: { node: string; at: "start" | "end" } | null;
  score: number;
}

const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
const sites = (s: Src[]) => new Set(s.map((x) => host(x.url))).size;
const recStatus = (r: RadarRecord): DiscoverStatus => (r.reliability === "official" || r.reliability === "confirmed" ? "vérifié" : r.reliability === "reported" ? "probable" : "inconnu");
const recSources = (r: RadarRecord): Src[] => r.evidence.slice(0, 4).map((e) => ({ name: e.sourceName.replace(/^www\./, ""), url: e.url }));

/** Catégorie d'une activité du graphe de progression. */
function nodeCat(st: NodeState): DiscoverCat {
  if (st.node.lostAt) return "perte";
  if (/savings/i.test(st.node.id)) return "argent";
  return st.node.kind === "side" ? "annexe" : "secret";
}

export function discoverNow(
  feed: RadarFeed | null,
  s: Pick<PersistedState, "profile" | "vehicles" | "done">,
  opts: { exclude?: Set<string>; landmarkByName?: (name: string) => string | null } = {},
): DiscoverItem[] {
  const p = s.profile;
  const mode = p.spoilerMode;
  const v = computeProgress(s);
  const items: DiscoverItem[] = [];
  const exclude = opts.exclude ?? new Set<string>();
  const curNode = v.current ?? v.planned;
  const objectiveTexts = (p.objectives ?? []).map((o) => nk(o.text));
  // « de Tourist Trap » ou, en anti-spoiler strict, « d'une mission principale à venir »
  const missionRef = (st: NodeState) => {
    if (st.status === "en cours") return "de ta mission en cours";
    const n = shownName(st, mode);
    return n === st.node.name ? `de ${n}` : `d'${n}`;
  };
  const untilRef = (name: string) => {
    const st = v.states.find((x) => nk(x.node.name) === nk(name) || (x.node.aliases ?? []).some((a) => nk(a) === nk(name)));
    return st ? missionRef(st) : mode === "strict" ? "d'une mission à venir" : `de « ${name} »`;
  };

  // 1. Activités facultatives du graphe (accessibles maintenant)
  for (const st of v.states) {
    if (st.node.kind === "main") continue;
    if (st.status !== "accessible" && st.status !== "potentiellement accessible") continue;
    const key = progDoneKey(st.node.id);
    if (s.done[key] || exclude.has(key)) continue;
    const cat = nodeCat(st);
    const lostSrc = st.node.lostAt?.sources ?? [];
    const allSrc = [...(st.node.prereq?.sources ?? []), ...lostSrc];
    const verifiedLoss = !!st.node.lostAt && srcsVerified(lostSrc);
    const status: DiscoverStatus = st.status === "accessible" && (cat !== "perte" || verifiedLoss) ? "vérifié" : "probable";
    const lostNode = st.node.lostAt ? v.byId.get(st.node.lostAt.node) : null;
    const noReturn = lostNode ? `${st.node.lostAt!.at === "start" ? "disparaît au lancement" : "disparaît à la fin"} ${missionRef(lostNode)}` : null;
    const lm = st.node.where && opts.landmarkByName ? opts.landmarkByName(st.node.where) : null;
    items.push({
      key,
      cat,
      name: st.node.name,
      status,
      importance: cat === "perte" && verifiedLoss ? "haute" : "normale",
      noReturn,
      sources: [...new Map(allSrc.map((x) => [x.url, x])).values()].slice(0, 4),
      detail: [st.node.where ? `Où : ${st.node.where}${st.node.district ? ` (${st.node.district})` : ""}` : st.node.district ? `Où : ${st.node.district}` : "", st.node.prereq?.condition ? `Condition : ${st.node.prereq.condition}` : "", st.node.prereq?.note ?? "", st.status === "potentiellement accessible" ? "Accès probable d'après les sources : à confirmer en jeu." : ""].filter(Boolean),
      map: lm ? { landmarkId: lm } : null,
      lost: st.node.lostAt ? { node: st.node.lostAt.node, at: st.node.lostAt.at } : null,
      // perte vérifiée ET accès établi d'abord ; perte vérifiée mais accès probable ensuite
      score: (cat === "perte" ? (verifiedLoss ? (status === "vérifié" ? 100 : 85) : 70) : 40) + (status === "vérifié" ? 5 : 0),
    });
  }

  // 2. Fiches du Radar (argent, objets uniques, armes, secrets) visibles pour ce joueur
  const gl = { missions: [...missionCatalog(feed).values()].map((m) => m.name), proper: (feed?.vehicles ?? []).map((x) => x.name.replace(/^'\d+\s*/, "")) };
  const curMissables = new Set((curNode?.node.missables ?? []).map((m) => nk(m.text).slice(0, 24)));
  for (const r of feed?.items ?? []) {
    const cat: DiscoverCat | null = r.category === "money" ? "argent" : r.category === "weapon" || r.category === "unique_item" ? "unique" : r.category === "easter_egg" ? "secret" : null;
    if (!cat || r.status !== "active" || s.done[r.id] || exclude.has(r.id) || exclude.has(`r:${r.id}`)) continue;
    if (r.reliability === "rumor" || !r.actionable) continue;
    // une fiche d'une seule source n'est retenue que si elle situe le lieu (sinon le titre seul n'aide pas en jeu)
    if (recStatus(r) !== "vérifié" && !r.details?.place) continue;
    if ((r.details?.chapter?.value ?? 1) > p.chapter || spoilerVisibility(r, mode, p.chapter) !== "visible") continue;
    // un objet lié à la mission en cours relève de « Rien à manquer »
    const mission = r.details?.mission?.value ?? r.details?.contextMissable?.value.subject ?? null;
    if (mission && curNode && nk(mission) === nk(curNode.node.name)) continue;
    const title = frHeadline(r, gl);
    if (curMissables.has(nk(title).slice(0, 24)) || objectiveTexts.some((o) => o && nk(title).includes(o))) continue;
    const until = r.details?.contextMissable?.value.until ?? null;
    // V0.20.2 : élément perdu au lancement d'une mission principale d'un chapitre déjà quitté → plus récupérable
    const untilNode = until ? nodeByName(until) : null;
    if (untilNode && (untilNode.kind === "main" && untilNode.chapter < p.chapter || ["terminé", "en cours"].includes(v.byId.get(untilNode.id)?.status ?? ""))) continue;
    const missable = r.details?.missable?.value === true || !!until;
    const status = recStatus(r);
    const place = r.details?.place?.value ?? null;
    const lm = place && opts.landmarkByName ? opts.landmarkByName(place.name) : null;
    items.push({
      key: r.id,
      recordId: r.id,
      cat: missable ? "perte" : cat,
      name: title,
      status,
      importance: missable && status === "vérifié" ? "haute" : "normale",
      noReturn: until ? `disparaît au lancement ${untilRef(until)}` : missable ? "manquable selon la source" : null,
      sources: recSources(r),
      detail: [r.conditions.reward ? `Gain : ${r.conditions.reward}` : "", place ? `Où : ${place.name}${place.district ? ` (${place.district})` : ""}` : "Lieu : voir la fiche"].filter(Boolean),
      map: lm ? { landmarkId: lm } : null,
      lost: until && nodeByName(until) ? { node: nodeByName(until)!.id, at: "start" } : null,
      score: (missable ? (status === "vérifié" ? 95 : 65) : cat === "unique" ? 60 : cat === "argent" ? 35 + Math.min(10, (r.conditions.money ?? 0) / 2000) : 30) + (status === "vérifié" ? 5 : 0),
    });
  }

  // 3. Véhicules rares / cachés récupérables maintenant
  for (const x of (feed?.vehicles ?? []).map((veh) => viewOf(veh, s))) {
    const key = `veh:${x.v.id}`;
    if (x.hidden || !x.now || (x.owned && x.owned !== "spotted") || s.done[key] || exclude.has(key) || exclude.has(`v:${x.v.id}`) || x.v.type !== "vehicle") continue;
    const status: DiscoverStatus = x.v.reliability === "official" || x.v.reliability === "confirmed" ? "vérifié" : x.v.reliability === "reported" ? "probable" : "inconnu";
    if (status === "inconnu") continue;
    const reliable = x.v.location.precision === "zone" || x.v.location.precision === "exact";
    items.push({
      key,
      cat: x.urgent ? "perte" : "vehicule",
      name: x.v.name,
      status,
      importance: x.urgent && status === "vérifié" ? "haute" : "normale",
      noReturn: x.urgent && x.v.access.until ? `seulement jusqu'au chapitre ${x.v.access.until.value}` : null,
      sources: x.v.evidence.slice(0, 3).map((e) => ({ name: e.sourceName.replace(/^www\./, ""), url: e.url })),
      detail: [x.v.location.district ? `Où : ${x.v.location.precision === "zone" ? "zone de " : ""}${x.v.location.district}` : "Lieu : voir la fiche", x.v.edition.exclusive === "ultimate" ? "Exclusivité Ultimate" : ""].filter(Boolean),
      map: reliable ? { vehicleId: x.v.id } : null,
      vehicleId: x.v.id,
      score: (x.urgent ? (status === "vérifié" ? 90 : 60) : 55) + (status === "vérifié" ? 5 : 0) + (x.v.media ? 1 : 0),
    });
  }

  return items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
