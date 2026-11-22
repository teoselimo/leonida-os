import type { Landmark } from "./gtadb";
import { EST_CATS, ESTABLISHMENTS, establishmentCategoryFromQuery } from "@/data/establishments";
import type { Establishment } from "@/data/establishments";

/**
 * Position d'un établissement confirmé, en trois niveaux de précision (V0.13) :
 * - « point » : observation vérifiée — placée par le joueur en jeu, ou repère gtadb portant exactement le même nom ;
 * - « zone » : zone restreinte déduite d'une source localisable (voisin cité, type de commerce gtadb unique dans le
 *   quartier) — rayon de quelques centaines d'unités, jamais un quartier entier ;
 * - « inconnue » : description et source seulement, aucun point affiché.
 */
export type Precision = "point" | "zone" | "inconnue";

export interface PlacePin {
  x: number;
  y: number;
  at: string;
  /** Provenance : toujours le joueur (observation en jeu). */
  by: "joueur";
}

export interface Placement {
  precision: Precision;
  x?: number;
  y?: number;
  radius?: number;
  landmarkId?: string;
  /** D'où vient la position, en clair. */
  provenance: string;
}

/** Rayon d'une zone « à côté de… » (unités de jeu ; Key Lento mesure ~2 000 × 1 600). */
export const NEAR_RADIUS = 220;
/** Au-delà de cet écart entre candidats, la zone ne serait plus « restreinte » : position inconnue. */
const MAX_CANDIDATE_SPREAD = 500;

const firstPart = (d: string) => (d.split(",").pop() ?? d).trim();

export function placementOf(e: Establishment, landmarks: Landmark[], pins: Record<string, PlacePin> = {}): Placement {
  const pin = pins[e.id];
  if (pin) return { precision: "point", x: pin.x, y: pin.y, provenance: `placé par toi en jeu le ${new Date(pin.at).toLocaleDateString("fr-FR")}` };
  const pos = e.position;
  if (pos?.landmarkId) {
    const l = landmarks.find((x) => x.id === pos.landmarkId);
    if (l) return { precision: "point", x: l.x, y: l.y, landmarkId: l.id, provenance: "repère de la carte communautaire gtadb portant le même nom (position communautaire)" };
  }
  if (pos?.near) {
    const l = landmarks.find((x) => x.id === pos.near);
    if (l) return { precision: "zone", x: l.x, y: l.y, radius: NEAR_RADIUS, provenance: `zone autour de « ${l.name} », d'après la source : ${pos.text ?? "à proximité"}` };
  }
  if (pos?.candidateTag) {
    const cands = landmarks.filter((l) => l.tags.includes(pos.candidateTag!) && (firstPart(l.district) === e.district || l.district.includes(e.district)));
    if (cands.length) {
      const x = cands.reduce((a, l) => a + l.x, 0) / cands.length;
      const y = cands.reduce((a, l) => a + l.y, 0) / cands.length;
      const spread = Math.max(...cands.map((l) => Math.hypot(l.x - x, l.y - y)));
      if (spread <= MAX_CANDIDATE_SPREAD)
        return {
          precision: "zone",
          x,
          y,
          radius: Math.max(160, spread * 1.3 + 80),
          provenance: `zone probable : ${cands.length > 1 ? `${cands.length} repères` : "seul repère"} gtadb de ce type à ${e.district} (non nommé${cands.length > 1 ? "s" : ""})${pos.text ? `, cohérent avec la source : ${pos.text}` : ""}`,
        };
    }
  }
  return { precision: "inconnue", provenance: pos?.text ? `position non établie — indication de la source : ${pos.text}` : "position non établie : aucune source localisable pour l'instant" };
}

export const PRECISION_FR: Record<Precision, string> = { point: "Point", zone: "Zone probable", inconnue: "Position inconnue" };

const nk = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Mots de catégorie générique (« magasins », « boutiques ») : tout le référentiel du quartier. */
const ANY_SHOP = /\b(magasins?|boutiques?|commerces?|shops?|stores?|etablissements?)\b/;

/**
 * Recherche dans le référentiel des établissements confirmés — y compris ceux SANS position,
 * pour qu'un lieu connu ne disparaisse jamais de la recherche faute de coordonnées.
 */
export function searchEstablishments(q: string, limit = 12): Establishment[] {
  const n = nk(q);
  if (n.length < 2) return [];
  const cat = establishmentCategoryFromQuery(n);
  const words = n.split(" ").filter((w) => w.length >= 3);
  const scored: Array<{ e: Establishment; s: number }> = [];
  for (const e of ESTABLISHMENTS) {
    const name = nk(e.name);
    const dist = nk(e.district);
    let s = 0;
    if (name.includes(n) || n.includes(name)) s += 10;
    else if (words.length && words.every((w) => name.includes(w) || dist.includes(w) || nk(e.what ?? "").includes(w) || nk(e.kind ?? "").includes(w))) s += 5;
    if (cat && e.cats.includes(cat)) s += 6;
    if (!cat && ANY_SHOP.test(n) && words.every((w) => ANY_SHOP.test(w) || dist.includes(w) || ["les", "des", "sur", "carte", "tous", "toutes"].includes(w))) s += 4;
    if (dist && n.includes(dist)) s += 2;
    else if (/\b(key lento|mariana|vice city|hamlet|ambrosia|port gellhorn)\b/.test(n) && !n.includes(dist) && !name.includes(n)) s = 0;
    // une catégorie demandée filtre strictement (sauf nom cité)
    if (cat && !e.cats.includes(cat) && !name.includes(n) && !n.includes(name)) s = 0;
    if (s > 0) scored.push({ e, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e);
}

export const estCatLabel = (e: Establishment) => EST_CATS[e.cats[0]].label;
