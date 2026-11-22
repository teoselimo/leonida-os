import { PROGRESSION, PROG_BY_ID } from "@/data/progression";
import type { Missable, ProgNode, Src } from "@/data/progression";
import { nk } from "./missions";
import type { PersistedState, SpoilerMode } from "./types";

/**
 * LEONIDA PROGRESSION ENGINE — statut de chaque mission / activité à partir de la progression DÉCLARÉE par le joueur
 * et du graphe sourcé (src/data/progression.ts). Aucune lecture de sauvegarde, aucune supposition :
 * - « terminé » : déclaré par le joueur, ou déduit d'un prérequis EXPLICITE d'une mission terminée / en cours ;
 * - « accessible » : prérequis explicites tous faits, documentés par au moins deux sites ;
 * - « potentiellement accessible » : prérequis faits mais lien déduit ou une seule source ;
 * - « verrouillé » : un prérequis documenté manque ; « inconnu » : aucun prérequis documenté ;
 * - « plus disponible » : la fenêtre documentée est passée (point de non-retour, fin de mission).
 * Plusieurs missions peuvent être accessibles en même temps : il n'y a jamais « une seule prochaine mission » supposée.
 */
export type ProgStatus = "terminé" | "en cours" | "accessible" | "potentiellement accessible" | "verrouillé" | "inconnu" | "plus disponible";

export interface NodeState {
  node: ProgNode;
  status: ProgStatus;
  /** Mission principale placée avant une mission terminée dans le Story Recap du jeu, non déclarée : probablement faite (jamais compté comme terminé). */
  likelyDone?: boolean;
  /** Pour « terminé » : déclaré par le joueur ou déduit des prérequis. */
  how?: "déclaré" | "déduit";
  /** Pour « verrouillé » : prérequis manquants. */
  missing?: ProgNode[];
}

export interface ProgressView {
  states: NodeState[];
  byId: Map<string, NodeState>;
  current: NodeState | null;
  /** Prochaine mission choisie mais pas lancée. */
  planned: NodeState | null;
}

const distinctSites = (srcs: Src[]) => new Set(srcs.map((s) => s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])).size;

/** Nœud du graphe pour un nom saisi (« Don Gone », « don gone », « Shirley's Rum »…). */
export function nodeByName(name: string | null | undefined): ProgNode | null {
  if (!name) return null;
  const k = nk(name).replace(/'/g, "");
  if (!k) return null;
  const key = (x: string) => nk(x).replace(/'/g, "");
  return (
    PROGRESSION.find((n) => key(n.name) === k || (n.aliases ?? []).some((a) => key(a) === k)) ??
    PROGRESSION.find((n) => n.kind !== "activity" && k.length >= 6 && nk(n.name).replace(/'/g, "").includes(k)) ??
    null
  );
}

/** Clé du registre « fait » (state.done) d'une activité facultative cochée par le joueur depuis l'accueil. */
export const progDoneKey = (id: string) => `prog:${id}`;

export function computeProgress(s: Pick<PersistedState, "profile"> & { done?: Record<string, string> }): ProgressView {
  const p = s.profile;
  const declared = new Set<string>();
  for (const m of [...p.missionsDone, p.lastMission]) {
    const n = nodeByName(m);
    if (n) declared.add(n.id);
  }
  const cur = p.nextMission && p.missionInProgress ? nodeByName(p.nextMission) : null;
  const planned = p.nextMission && !p.missionInProgress ? nodeByName(p.nextMission) : null;
  // fermeture : les prérequis EXPLICITES d'une mission terminée ou en cours sont faits
  const done = new Set(declared);
  const queue = [...declared, ...(cur && !declared.has(cur.id) ? [cur.id] : [])];
  while (queue.length) {
    const n = PROG_BY_ID.get(queue.pop()!);
    if (!n?.prereq || n.prereq.basis !== "explicite") continue;
    for (const d of n.prereq.all) if (!done.has(d)) (done.add(d), queue.push(d));
  }
  // activités FACULTATIVES cochées « Fait » (avec confirmation) : faites elles-mêmes, ouvrent leurs suites, mais
  // n'entraînent AUCUNE déduction sur les missions principales (pas de fermeture sur leurs prérequis)
  const ticked = new Set<string>();
  for (const k of Object.keys(s.done ?? {})) {
    if (!k.startsWith("prog:")) continue;
    const n = PROG_BY_ID.get(k.slice(5));
    if (n && n.kind !== "main" && !done.has(n.id)) (done.add(n.id), ticked.add(n.id));
  }
  const started = (id: string) => done.has(id) || cur?.id === id;
  // Story Recap : une mission principale listée AVANT une mission faite est « probablement faite » (signal faible, affiché comme tel)
  const maxRecap = Math.max(0, ...[...done, ...(cur ? [cur.id] : [])].map((id) => PROG_BY_ID.get(id)?.recap ?? 0));
  const likely = (id: string) => {
    const n = PROG_BY_ID.get(id);
    return !!n && n.kind === "main" && !done.has(id) && (n.recap ?? 99) < maxRecap;
  };
  const states = PROGRESSION.map((node): NodeState => {
    if (done.has(node.id)) return { node, status: "terminé", how: declared.has(node.id) || ticked.has(node.id) ? "déclaré" : "déduit" };
    if (cur?.id === node.id) return { node, status: "en cours" };
    if (node.lostAt && (node.lostAt.at === "start" ? started(node.lostAt.node) : done.has(node.lostAt.node))) return { node, status: "plus disponible" };
    if (likely(node.id)) return { node, status: "inconnu", likelyDone: true };
    if (!node.prereq) return { node, status: "inconnu" };
    const missing = node.prereq.all.filter((d) => !done.has(d) && !likely(d)).map((d) => PROG_BY_ID.get(d)!).filter(Boolean);
    if (missing.length) return { node, status: "verrouillé", missing };
    const viaLikely = node.prereq.all.some((d) => likely(d));
    return { node, status: !viaLikely && node.prereq.basis === "explicite" && distinctSites(node.prereq.sources) >= 2 ? "accessible" : "potentiellement accessible" };
  });
  const byId = new Map(states.map((x) => [x.node.id, x]));
  return { states, byId, current: cur ? byId.get(cur.id) ?? null : null, planned: planned ? byId.get(planned.id) ?? null : null };
}

/**
 * Nom affichable sans spoiler : en mode complet, une mission PRINCIPALE pas encore accessible n'est pas nommée.
 */
export function shownName(st: NodeState, mode: SpoilerMode): string {
  if (mode !== "strict" || st.node.kind !== "main") return st.node.name;
  if (st.status === "verrouillé" || st.status === "inconnu") return "une mission principale à venir";
  return st.node.name;
}

/** Manquables encore récupérables de la mission en cours (ou prévue). */
export function pendingMissables(v: ProgressView, collected: string[] = []): Array<Missable & { mission: string }> {
  const n = v.current ?? v.planned;
  if (!n?.node.missables) return [];
  const got = collected.map((c) => nk(c));
  return n.node.missables.filter((m) => !got.some((g) => g && (nk(m.text).includes(g) || g.includes(nk(m.text).slice(0, 30))))).map((m) => ({ ...m, mission: n.node.name }));
}

/** Point de non-retour le plus proche (mission pas encore lancée qui en porte un). */
export function nextPointOfNoReturn(v: ProgressView): NodeState | null {
  return v.states.find((x) => x.node.pointOfNoReturn && x.status !== "terminé" && x.status !== "en cours") ?? null;
}

/**
 * Bloc PROGRESSION du contexte envoyé à Claude à chaque message (le joueur n'a pas à répéter où il en est).
 * Compact (≈ 1 500 caractères), sans spoiler selon le niveau choisi.
 */
export function progressionContext(s: Pick<PersistedState, "profile"> & { done?: Record<string, string> }): string {
  const v = computeProgress(s);
  const mode = s.profile.spoilerMode;
  const by = (st: ProgStatus) => v.states.filter((x) => x.status === st);
  const label = (x: NodeState) => `${shownName(x, mode)}${x.node.kind !== "main" ? " (facultative)" : ""}`;
  const doneDeclared = by("terminé").filter((x) => x.how === "déclaré").map((x) => x.node.name);
  const doneInferred = by("terminé").filter((x) => x.how === "déduit").length;
  const lines: string[] = ["PROGRESSION (modèle LEONIDA, chapitre 1, prérequis sourcés ; l'ordre d'un guide n'est pas un prérequis) :"];
  lines.push(`- Terminées : ${doneDeclared.length ? doneDeclared.join(", ") : "aucune déclarée"}${doneInferred ? ` + ${doneInferred} déduite(s) de leurs suites` : ""}`);
  if (v.current) {
    const miss = pendingMissables(v, (s.profile.objectives ?? []).filter((o) => o.done).map((o) => o.text));
    lines.push(`- EN COURS : ${v.current.node.name}${miss.length ? ` — à ne pas rater : ${miss.map((m) => m.text + (m.locationCertain ? "" : " (emplacement incertain)")).join(" ; ")}` : ""}`);
  } else if (v.planned) {
    const label = s.profile.nextMission && nodeByName(s.profile.nextMission)?.name !== s.profile.nextMission ? ` (« ${s.profile.nextMission} » sur la carte)` : "";
    const miss = pendingMissables(v, (s.profile.objectives ?? []).filter((o) => o.done).map((o) => o.text));
    lines.push(`- Prochaine mission choisie (pas lancée) : ${v.planned.node.name}${label}${miss.length ? ` — à ne pas rater : ${miss.map((m) => m.text).join(" ; ")}` : ""}`);
  }
  const acc = by("accessible").filter((x) => x.node.id !== v.planned?.node.id);
  const pot = by("potentiellement accessible");
  if (acc.length) lines.push(`- Accessibles maintenant : ${acc.map((x) => label(x) + (x.node.prereq?.condition ? ` [${x.node.prereq.condition}]` : "") + (x.node.lostAt ? " — manquable" : "")).join(" ; ")}`);
  if (pot.length) lines.push(`- Potentiellement accessibles (lien moins sûr) : ${pot.map(label).join(" ; ")}`);
  // verrouillées utiles : facultatives, ou mission principale immédiatement suivante (prérequis en cours / faits)
  const near = (m: ProgNode) => ["terminé", "en cours"].includes(v.byId.get(m.id)?.status ?? "");
  const locked = by("verrouillé").filter((x) => x.node.kind !== "main" || x.missing!.every(near));
  if (locked.length)
    lines.push(
      `- Verrouillées : ${locked
        .slice(0, 6)
        .map((x) => `${label(x)} (après ${x.missing!.map((m) => shownName(v.byId.get(m.id)!, mode)).join(" + ")})`)
        .join(" ; ")}`,
    );
  const lost = by("plus disponible");
  if (lost.length) lines.push(`- Plus disponibles : ${lost.map((x) => x.node.name).join(", ")}`);
  const pnr = nextPointOfNoReturn(v);
  if (pnr?.node.pointOfNoReturn) {
    const at = shownName(pnr, mode);
    // la note cite des noms de missions : seulement si ces noms sont affichables
    const note = at === pnr.node.name ? pnr.node.pointOfNoReturn.note ?? "" : "Les guides divergent sur la mission exacte qui ferme la porte.";
    const soon = (pnr.missing ?? []).every((m) => m.id === v.current?.node.id || m.id === v.planned?.node.id);
    const where = at === pnr.node.name ? `début de ${at}` : soon ? `juste après ${(v.current ?? v.planned)!.node.name}` : "plus loin dans le chapitre";
    lines.push(`- Point de non-retour à venir (${where}) : on perd ${pnr.node.pointOfNoReturn.lose.join(", ")} ; on garde ${pnr.node.pointOfNoReturn.keep.join(", ")}. ${note}`.trim());
  }
  const got = (s.profile.objectives ?? []).filter((o) => o.done).map((o) => o.text);
  if (got.length) lines.push(`- Déjà récupéré / fait : ${got.slice(-8).join(" ; ")}`);
  const likelyDone = v.states.filter((x) => x.likelyDone).length;
  if (likelyDone) lines.push(`- ${likelyDone} mission(s) principale(s) antérieure(s) non déclarée(s) : probablement faites (non confirmé) ; les facultatives qui en dépendent sont « potentiellement accessibles ».`);
  lines.push("- Missions non listées : prérequis non documentés (disponibilité inconnue).");
  return lines.join("\n");
}
