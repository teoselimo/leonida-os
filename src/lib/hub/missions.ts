import raw from "@/data/hub/missions.json";
import meta from "@/data/hub/meta.json";
import type { ProgNode, Src } from "@/data/progression";
import type { HubFacts, HubMeta, HubMission } from "./model";

/**
 * Missions du Data Hub (GTABase) branchées sur Story Intelligence et Mission Autopilot (V0.20).
 *
 * - Une mission DÉJÀ dans le graphe validé garde ses prérequis : on lui rattache seulement les faits GTABase
 *   (n°, donneur, récompenses, objectifs) et, si GTABase dit autre chose, la différence est affichée, pas appliquée.
 * - Une mission NOUVELLE devient un nœud « origin: hub » : prérequis = missions citées par la phrase « How To Unlock »
 *   (une seule source → jamais « Vérifié » ; « usually » → lien déduit) ; sans phrase → disponibilité inconnue.
 * - Les activités libres de GTABase (salle de sport, pêche…) restent au catalogue : ce ne sont pas des missions.
 */
export const HUB_MISSIONS = raw as HubMission[];
export const HUB_META = meta as unknown as HubMeta;
export const HUB_MISSION_BY_ID = new Map(HUB_MISSIONS.map((m) => [m.id, m]));

const gb = (m: HubMission): Src => ({ name: "GTABase", url: m.url });
const slug = (id: string) => id.split("/").pop()!;

export function protagonistOf(m: HubMission): HubFacts["protagonist"] | undefined {
  return m.jason && m.lucia ? "les deux" : m.jason ? "Jason" : m.lucia ? "Lucia" : undefined;
}

function factsOf(m: HubMission): HubFacts {
  return { url: m.url, mod: m.mod, number: m.number, giver: m.giver, money: m.money, rewards: m.rewards, objectives: m.objectives, req100: m.req100, missable: m.missable, pnr: m.pnr, cond: m.cond, protagonist: protagonistOf(m) };
}

const COND_SHOWN = new Set(["de nuit", "en jouant Lucia", "en jouant Jason", "édition Ultimate", "durée limitée"]);

export interface HubGraph {
  nodes: ProgNode[];
  /** Faits rattachés aux nœuds existants (graphe validé ou inventaire Story). */
  facts: Map<string, HubFacts>;
  /** Noms GTABase différents à ajouter comme alias aux nœuds existants. */
  aliases: Map<string, string[]>;
  /** Id Hub → id de nœud LEONIDA. */
  nodeIdOf: Map<string, string>;
}

export function buildHubGraph(manual: ProgNode[], storyIds: Map<string, { kind: string }> = new Map()): HubGraph {
  const manualIds = new Set(manual.map((n) => n.id));
  const nodeIdOf = new Map<string, string>();
  const used = new Set(manualIds);
  for (const m of HUB_MISSIONS) {
    const id = m.leonida?.progression ?? m.leonida?.story ?? (used.has(slug(m.id)) ? `hub-${slug(m.id)}` : slug(m.id));
    nodeIdOf.set(m.id, id);
    used.add(id);
  }
  const facts = new Map<string, HubFacts>();
  const aliases = new Map<string, string[]>();
  const nodes: ProgNode[] = [];
  for (const m of HUB_MISSIONS) {
    const id = nodeIdOf.get(m.id)!;
    const f = factsOf(m);
    const after = (m.after ?? []).map((a) => nodeIdOf.get(a)).filter((x): x is string => !!x && x !== id);
    if (manualIds.has(id)) {
      const node = manual.find((n) => n.id === id)!;
      const al = [m.name, ...(m.aliases ?? [])].filter((a) => a !== node.name && !(node.aliases ?? []).includes(a));
      if (al.length) aliases.set(id, al);
      // contradiction conservée : GTABase cite d'autres préalables que le graphe validé
      const mine = new Set(node.prereq?.all ?? []);
      const diff = after.filter((a) => !mine.has(a));
      if (after.length && diff.length) f.differs = diff;
      facts.set(id, f);
      continue;
    }
    if (m.kind === "activity" || m.chapter == null) continue;
    const storyKind = storyIds.get(id)?.kind;
    if (storyKind === "place") continue;
    const kind: ProgNode["kind"] = storyKind === "activity" ? "activity" : m.kind === "main" ? "main" : "side";
    const cond = (m.cond ?? []).filter((c) => COND_SHOWN.has(c));
    const notes = [m.weak ? "lien donné comme habituel (« usually ») par GTABase" : null, m.afterAllMains ? `et les autres missions principales du chapitre ${m.afterAllMains}` : null].filter(Boolean);
    const node: ProgNode = {
      id,
      name: m.name,
      aliases: m.aliases,
      kind,
      chapter: m.chapter,
      character: m.jason && !m.lucia ? "Jason" : m.lucia && !m.jason ? "Lucia" : undefined,
      where: m.location,
      prereq: after.length ? { all: after, basis: m.weak ? "déduit" : "explicite", sources: [gb(m)], condition: cond.length ? cond.join(", ") : undefined, note: notes.length ? notes.join(" ; ") : undefined } : null,
      auto: (m.cond ?? []).includes("démarre automatiquement") || undefined,
      origin: "hub",
      hub: f,
    };
    if (m.lostAt && nodeIdOf.get(m.lostAt)) node.lostAt = { node: nodeIdOf.get(m.lostAt)!, at: "start", sources: [gb(m)] };
    if (m.pnr)
      node.pointOfNoReturn = {
        text: `Point de non-retour du chapitre ${m.chapter} (signalé par GTABase)`,
        lose: [`les activités manquables encore ouvertes du chapitre ${m.chapter}`],
        keep: [],
        sources: [gb(m)],
        note: "Le détail des pertes n'est pas documenté par cette source : vérifie les manquables avant de lancer.",
      };
    nodes.push(node);
  }
  // un nœud dont un prérequis n'existe pas (mission absente) : on retire ce prérequis, jamais de mission fantôme
  const all = new Set([...manualIds, ...nodes.map((n) => n.id)]);
  for (const n of nodes) if (n.prereq) n.prereq.all = n.prereq.all.filter((d) => all.has(d));
  return { nodes, facts, aliases, nodeIdOf };
}

/** Missions connues par chapitre (graphe validé + Hub), pour l'affichage de couverture. */
export function hubChapterStats(chapter: number) {
  const ms = HUB_MISSIONS.filter((m) => m.chapter === chapter && m.kind !== "activity");
  return { total: ms.length, mains: ms.filter((m) => m.kind === "main").length, withPrereq: ms.filter((m) => (m.after ?? []).length > 0).length, pnr: ms.filter((m) => m.pnr).length, missable: ms.filter((m) => m.missable).length };
}

/** Id Hub → id de nœud du graphe (rempli par progression.ts au chargement). */
export const HUB_GRAPH_IDS = new Map<string, string>();
