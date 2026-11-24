import { RVL_BY_ID } from "@/data/rareVehicles";
import type { VehicleRecord } from "@/lib/garage";
import { viewOf, ACCESS_FR } from "@/lib/garage";
import { rvlView } from "@/lib/rvl";
import { nk } from "@/lib/missions";
import type { PersistedState } from "@/lib/types";
import type { HubVehicle } from "./model";

/**
 * Garage A+ (V0.20) : UNE fiche par véhicule, quelle que soit sa source.
 *  - catalogue GTABase (Data Hub) : modèles, variantes, exemplaires uniques, statistiques ;
 *  - Rare Vehicle Locator (positions calibrées) et RADAR (veille) : disponibilité selon la progression, carte.
 * Les positions viennent UNIQUEMENT du Rare Vehicle Locator / RADAR : le catalogue n'en invente aucune.
 */
export interface GarageItem {
  /** Id utilisé pour l'état du joueur : celui du Locator / RADAR s'il existe (synchronisé avec la carte). */
  key: string;
  name: string;
  manufacturer?: string;
  cls?: string;
  hub?: HubVehicle;
  radar?: VehicleRecord;
  rvl: boolean;
  /** Un point ou une zone existe sur la carte LEONIDA. */
  onMap: boolean;
  access: { label: string; tone: "ok" | "warn" | "low" | "none"; hidden: boolean };
  tier: "model" | "variant" | "unique" | "rare";
  source: string[];
}

/** Famille de silhouette pour la vignette (aucune photo GTABase reprise : droits réservés). */
export function family(cls?: string): "car" | "moto" | "boat" | "plane" | "heli" | "bike" | "truck" {
  const c = (cls ?? "").toLowerCase();
  if (c.includes("helicopter")) return "heli";
  if (c.includes("plane")) return "plane";
  if (c.includes("boat")) return "boat";
  if (c.includes("motorcycle")) return "moto";
  if (c.includes("cycle")) return "bike";
  if (/commercial|industrial|utility|service|van/.test(c)) return "truck";
  return "car";
}

const strip = (s: string) => nk(s.replace(/^'\d+\s+/, "").replace(/\s+'\d+$/, ""));

export function buildGarage(hub: HubVehicle[], radar: VehicleRecord[], s: Pick<PersistedState, "profile" | "vehicles" | "done">): GarageItem[] {
  const radarByName = new Map<string, VehicleRecord>();
  for (const r of radar) if (r.type === "vehicle") radarByName.set(strip(r.name), r);
  const used = new Set<string>();
  const items: GarageItem[] = [];
  const accessOf = (r: VehicleRecord | undefined, rvlId: string | undefined): GarageItem["access"] => {
    if (rvlId && RVL_BY_ID.get(rvlId) && r) {
      const x = viewOf(r, s);
      return { label: ACCESS_FR[x.access], tone: x.access === "now" ? "ok" : x.access === "excluded" || x.access === "expired" ? "low" : "warn", hidden: x.hidden };
    }
    if (rvlId && RVL_BY_ID.get(rvlId)) {
      const v = rvlView(RVL_BY_ID.get(rvlId)!, s as never);
      return { label: v.access === "now" ? "Accessible maintenant" : "Selon la progression (voir la fiche)", tone: v.access === "now" ? "ok" : "warn", hidden: false };
    }
    if (r) {
      const x = viewOf(r, s);
      return { label: ACCESS_FR[x.access], tone: x.access === "now" ? "ok" : x.access === "excluded" || x.access === "expired" ? "low" : "warn", hidden: x.hidden };
    }
    return { label: "Disponibilité non documentée", tone: "none", hidden: false };
  };
  for (const h of hub) {
    const rvlId = h.lk?.rareVehicle;
    const r = (rvlId && radar.find((x) => x.id === rvlId)) || radarByName.get(strip(h.n)) || (h.m ? radarByName.get(strip(`${h.m} ${h.n}`)) : undefined);
    if (r) used.add(r.id);
    if (rvlId) used.add(rvlId);
    const key = rvlId ?? r?.id ?? h.id;
    const located = !!rvlId || (!!r && r.location.precision !== "none" && r.location.precision !== "text");
    items.push({
      key,
      name: h.n,
      manufacturer: h.m,
      cls: h.c?.replace(/\s*,\s*/g, ", "),
      hub: h,
      radar: r,
      rvl: !!rvlId,
      onMap: located,
      access: accessOf(r, rvlId),
      tier: h.t ?? "model",
      source: ["GTABase", ...(rvlId ? ["Rare Vehicle Locator"] : []), ...(r && !rvlId ? ["RADAR"] : [])],
    });
  }
  // véhicules suivis par LEONIDA absents du catalogue GTABase : gardés, jamais perdus
  for (const r of radar) {
    if (r.type !== "vehicle" || used.has(r.id)) continue;
    const rvl = !!RVL_BY_ID.get(r.id);
    items.push({ key: r.id, name: r.name, radar: r, rvl, onMap: rvl || (r.location.precision !== "none" && r.location.precision !== "text"), access: accessOf(r, rvl ? r.id : undefined), tier: "rare", source: [rvl ? "Rare Vehicle Locator" : "RADAR"] });
  }
  const rank = (x: GarageItem) => (x.onMap ? 0 : 2) + (x.access.tone === "ok" ? 0 : 1) + (x.tier === "variant" ? 1 : 0);
  return items.sort((a, b) => rank(a) - rank(b) || (a.manufacturer ?? "~").localeCompare(b.manufacturer ?? "~") || a.name.localeCompare(b.name));
}

export interface GarageQuery {
  q: string;
  maker: string | null;
  cls: string | null;
  tier: "all" | "model" | "variant" | "unique" | "rare";
  only: "all" | "map" | "wanted" | "owned" | "now";
}

export function filterGarage(items: GarageItem[], f: GarageQuery, wanted: string[], vehicles: PersistedState["vehicles"]): GarageItem[] {
  const n = nk(f.q);
  return items.filter((it) => {
    if (it.access.hidden) return false;
    if (n && !nk(`${it.manufacturer ?? ""} ${it.name} ${it.cls ?? ""} ${it.hub?.b ?? ""}`).includes(n)) return false;
    if (f.maker && it.manufacturer !== f.maker) return false;
    if (f.cls && !(it.cls ?? "").split(/\s*,\s*/).includes(f.cls)) return false;
    if (f.tier !== "all" && it.tier !== f.tier) return false;
    if (f.only === "map" && !it.onMap) return false;
    if (f.only === "wanted" && !wanted.includes(it.key)) return false;
    if (f.only === "owned" && !(vehicles[it.key] && vehicles[it.key].state !== "spotted")) return false;
    if (f.only === "now" && it.access.tone !== "ok") return false;
    return true;
  });
}

export const TIER_FR: Record<GarageItem["tier"], string> = { model: "Modèle", variant: "Variante", unique: "Exemplaire unique", rare: "Véhicule rare suivi" };
export const STAT_FR: Record<string, string> = { speed: "Vitesse", acceleration: "Accélération", handling: "Tenue de route", offroad: "Tout-terrain", strength: "Robustesse" };
