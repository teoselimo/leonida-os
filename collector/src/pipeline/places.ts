import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Régions officielles (noms Rockstar) et positions d'étiquette (repère de proximité, jamais une coordonnée de fiche). */
const REGIONS = [
  { id: "vicecity", names: ["Vice City", "Vice Beach"], label: [-500, 800] },
  { id: "keys", names: ["Leonida Keys", "Key Lento"], label: [-2900, -6200] },
  { id: "grassrivers", names: ["Grassrivers"], label: [-3800, -3600] },
  { id: "gellhorn", names: ["Port Gellhorn"], label: [-6500, 3400] },
  { id: "ambrosia", names: ["Ambrosia"], label: [-2800, 3900] },
  { id: "kalaga", names: ["Mount Kalaga", "Kalaga"], label: [-3700, 6700] },
] as const;

interface Place { name: string; regionId: string }

const GENERIC = /^(lake|warehouse|cell tower|water tower|radio mast|gas station|bridge|church|hospital|school|airfield|marina|beach|park|hotel|motel|diner|bar|club|mall|pier|tunnel|island|airport|stadium|factory|farm|lighthouse|police station|fire station|lieu non identifié)$/i;

function nearestRegion(x: number, y: number): string {
  let best: string = REGIONS[0].id;
  let d = Infinity;
  for (const r of REGIONS) {
    const dd = Math.hypot(r.label[0] - x, r.label[1] - y);
    if (dd < d) [d, best] = [dd, r.id];
  }
  return best;
}

let cache: Place[] | null = null;
function landmarkPlaces(): Place[] {
  if (cache) return cache;
  cache = [];
  const p = fileURLToPath(new URL("../../../public/data/landmarks.json", import.meta.url));
  if (!existsSync(p)) return cache;
  const rows = JSON.parse(readFileSync(p, "utf8")) as [string, string, number, number, string, string[]][];
  const counts = new Map<string, number>();
  const entries = rows.map(([, full, x, y]) => ({ name: full.split(",")[0].replace(/"/g, "").trim(), x, y }));
  for (const e of entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  for (const e of entries) {
    // Noms distinctifs uniquement : au moins deux mots, uniques, non génériques, avec majuscule initiale
    // (un mot isolé comme « Delights » crée des faux positifs)
    if (e.name.length < 8 || e.name.split(/\s+/).length < 2 || e.name === "?" || GENERIC.test(e.name) || counts.get(e.name)! > 1 || !/^[A-Z]/.test(e.name)) continue;
    cache.push({ name: e.name, regionId: nearestRegion(e.x, e.y) });
  }
  return cache;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lieu cité explicitement dans le texte. Ne fournit JAMAIS de coordonnées : seulement un nom et une région. */
export function findPlace(text: string): { regionId: string; place: string | null; precision: "region" | "named-place"; quote: string } | null {
  for (const p of landmarkPlaces()) {
    const m = text.match(new RegExp(`\\b${esc(p.name)}\\b`));
    if (m) return { regionId: p.regionId, place: p.name, precision: "named-place", quote: m[0] };
  }
  for (const r of REGIONS) {
    for (const n of r.names) {
      const m = text.match(new RegExp(`\\b${esc(n)}\\b`, "i"));
      if (m) return { regionId: r.id, place: null, precision: "region", quote: m[0] };
    }
  }
  return null;
}

/**
 * Repère exact de la carte communautaire correspondant au nom cité (et au quartier s'il est donné).
 * Sert uniquement de PROPOSITION à valider : la fiche n'est jamais épinglée sans validation humaine.
 */
export function exactLandmark(name: string, district: string | null): { x: number; y: number; landmark: string } | null {
  const p = fileURLToPath(new URL("../../../public/data/landmarks.json", import.meta.url));
  if (!existsSync(p)) return null;
  const rows = JSON.parse(readFileSync(p, "utf8")) as [string, string, number, number][];
  const n = name.toLowerCase().trim();
  const hits = rows.filter(([, full]) => {
    const parts = full.split(",").map((s) => s.replace(/"/g, "").trim().toLowerCase());
    return parts[0] === n && (!district || parts.includes(district.toLowerCase()));
  });
  if (hits.length !== 1) return null; // absent ou ambigu : aucune proposition
  return { x: hits[0][2], y: hits[0][3], landmark: hits[0][1] };
}
