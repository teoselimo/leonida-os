import { HUB_MISSIONS } from "./missions";
import { loadHubCatalog, loadHubPlaces, loadHubVehicles } from "./data";
import { loadLandmarks } from "@/lib/gtadb";
import type { HubCatalogItem, HubMission, HubVehicle } from "./model";
import { nk } from "@/lib/missions";
import type { PersistedState } from "@/lib/types";

/**
 * V0.20 · Connaissances du Data Hub pour LEONIDA AI : les entités CITÉES par la question (missions, véhicules,
 * personnages, propriétés, armes) sont jointes au contexte avec leurs faits et leur source. Rien n'est ajouté
 * si la question n'en cite aucune (pas de bruit). Anti-spoiler : une mission ou un personnage d'un chapitre non
 * atteint est signalé sans détail en mode strict.
 */
const words = (s: string) => ` ${nk(s).replace(/['’]/g, "")} `;
const hit = (q: string, name: string) => {
  const k = nk(name).replace(/['’]/g, "").trim();
  return k.length >= 4 && q.includes(` ${k} `);
};

export interface HubMention {
  kind: "mission" | "vehicle" | "catalog" | "place";
  name: string;
  line: string;
  url: string;
}

function missionLine(m: HubMission, s: Pick<PersistedState, "profile">, names: Map<string, string>): string {
  const p = s.profile;
  if (m.chapter != null && m.chapter > p.chapter && p.spoilerMode === "strict") return `Mission « ${m.name} » : chapitre non atteint par le joueur (détails masqués par l'anti-spoiler strict).`;
  const bits = [
    m.chapter != null ? `chapitre ${m.chapter}` : null,
    m.number ? `n° ${m.number} dans l'ordre GTABase (pas un prérequis)` : null,
    m.kind === "main" ? "principale" : m.kind === "stranger" ? "étrangers et fous" : m.kind === "activity" ? "activité libre" : "facultative",
    m.jason && m.lucia ? "Jason et Lucia" : m.jason ? "Jason" : m.lucia ? "Lucia" : null,
    m.giver?.length ? `donneur : ${m.giver.join(", ")}` : null,
    m.money ? `récompense ${m.money} $` : null,
    m.after?.length ? `après : ${m.after.map((a) => names.get(a) ?? a).join(", ")}${m.weak ? " (lien habituel)" : ""}` : m.unlockKnown ? null : "déblocage non documenté",
    m.cond?.length ? `conditions : ${m.cond.join(", ")}` : null,
    m.missable ? "manquable" : null,
    m.pnr ? "POINT DE NON-RETOUR" : null,
  ].filter(Boolean);
  return `Mission « ${m.name} » (GTABase) : ${bits.join(" ; ")}.`;
}

function vehicleLine(v: HubVehicle, all: Map<string, HubVehicle>): string {
  const st = v.s ? Object.entries(v.s).map(([k, x]) => `${k} ${x}/10`).join(", ") : null;
  const bits = [
    v.m ? `constructeur ${v.m}` : null,
    v.c ? `catégorie ${v.c}` : null,
    v.t === "variant" ? `variante${v.base && all.get(v.base) ? ` de ${all.get(v.base)!.n}` : ""}` : v.t === "unique" ? `exemplaire unique${v.own?.length ? ` (${v.own.join(", ")})` : ""}` : "modèle de base",
    v.b ? `inspiré de ${v.b}` : null,
    st ? `stats GTABase : ${st}` : null,
    v.p ? `prix ${v.p} $` : null,
    v.reg ? `immatriculation ${v.reg} $` : null,
    v.how ? `obtention : ${v.how}` : null,
  ].filter(Boolean);
  return `Véhicule « ${v.n} » (GTABase) : ${bits.join(" ; ")}. Position : seulement si le Rare Vehicle Locator ou la veille en ont une (sinon inconnue).`;
}

function catalogLine(c: HubCatalogItem): string {
  const f = Object.entries(c.f ?? {}).filter(([k]) => k !== "sections").slice(0, 5).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`);
  return `${c.t === "character" ? "Personnage" : c.t === "property" ? "Propriété" : c.t === "weapon" ? "Arme" : "Fiche"} « ${c.n} » (GTABase) : ${f.join(" ; ") || "fiche sans champ structuré"}.`;
}

export async function hubMentions(question: string, s: Pick<PersistedState, "profile">, max = 4): Promise<HubMention[]> {
  const q = words(question);
  const out: HubMention[] = [];
  const names = new Map(HUB_MISSIONS.map((m) => [m.id, m.name]));
  for (const m of HUB_MISSIONS) {
    if ([m.name, ...(m.aliases ?? [])].some((n) => hit(q, n))) out.push({ kind: "mission", name: m.name, line: missionLine(m, s, names), url: m.url });
  }
  const [{ data: vs }, { data: cat }] = await Promise.all([loadHubVehicles(), loadHubCatalog()]);
  const byId = new Map(vs.map((v) => [v.id, v]));
  // le nom le plus long d'abord (« Moses' Sultan » avant « Sultan »)
  for (const v of [...vs].sort((a, b) => b.n.length - a.n.length)) {
    if (out.length >= max * 2) break;
    if ((hit(q, v.n) || (v.m && hit(q, `${v.m} ${v.n}`))) && !out.some((o) => o.kind === "vehicle" && nk(o.name).includes(nk(v.n)))) out.push({ kind: "vehicle", name: v.n, line: vehicleLine(v, byId), url: v.u });
  }
  for (const c of cat) {
    if (!["character", "property", "weapon"].includes(c.t)) continue;
    if (hit(q, c.n)) {
      // personnage : masqué en strict si toutes ses apparitions sont dans un chapitre non atteint
      const chs = (c.rel ?? []).filter((r) => r.k === "appears_in").map((r) => HUB_MISSIONS.find((m) => m.id === r.to)?.chapter).filter((x): x is number => x != null);
      if (c.t === "character" && s.profile.spoilerMode === "strict" && chs.length && Math.min(...chs) > s.profile.chapter) {
        out.push({ kind: "catalog", name: c.n, line: `Personnage « ${c.n} » : apparaît dans un chapitre non atteint (détails masqués).`, url: c.u });
      } else out.push({ kind: "catalog", name: c.n, line: catalogLine(c), url: c.u });
    }
  }
  return out.slice(0, max);
}

/** Bloc de contexte (vide si rien n'est cité). */
export function hubBlock(ms: HubMention[]): string {
  if (!ms.length) return "";
  return ["DATA HUB (fiches GTABase / GTADB, une seule source chacune — à citer comme « GTABase », jamais comme vérifié) :", ...ms.map((m) => `- ${m.line} Source : ${m.url}`)].join("\n");
}

/**
 * Lieux GTADB dont le NOM apparaît dans un texte (question ou panneau lu sur une capture) : 3 663 repères placés
 * + lieux connus sans position. Sert quand Knowledge ne connaît pas l'endroit : le joueur n'a pas à donner le nom.
 */
export async function landmarkMentions(text: string, max = 3): Promise<HubMention[]> {
  if (typeof document === "undefined") return [];
  const q = words(text);
  const [lms, places] = await Promise.all([loadLandmarks().catch(() => []), loadHubPlaces()]);
  const out: HubMention[] = [];
  for (const l of [...lms].sort((a, b) => b.name.length - a.name.length)) {
    if (out.length >= max) break;
    if (l.name !== "Lieu non identifié" && nk(l.name).length >= 6 && hit(q, l.name) && !out.some((o) => nk(o.name).includes(nk(l.name))))
      out.push({ kind: "place", name: l.name, line: `Repère GTADB « ${l.name} » (${l.district || "quartier inconnu"}) : position connue sur la carte LEONIDA (id ${l.id}).${l.tags.length ? ` Type : ${l.tags.join(", ")}.` : ""}`, url: `https://map.gtadb.org/?id=${l.id}` });
  }
  for (const u of places.data.unplaced) {
    if (out.length >= max) break;
    if (nk(u.n).length >= 6 && hit(q, u.n)) out.push({ kind: "place", name: u.n, line: `Lieu « ${u.n} » connu de GTADB SANS position (${u.d ?? "quartier inconnu"}) : ne propose aucun point.`, url: "https://map.gtadb.org" });
  }
  return out;
}
