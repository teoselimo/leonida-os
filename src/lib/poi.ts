import type { Landmark } from "./gtadb";

/**
 * Points d'intérêt sémantiques à partir des 3 663 repères communautaires gtadb (issue #9).
 * Un repère gtadb est une reconstitution communautaire (souvent l'équivalent d'un lieu réel de Floride) :
 * il ne prouve PAS qu'un commerce est ouvert, achetable ou interactif dans le jeu. Le statut le dit toujours.
 */

export type PoiCat = "commerce" | "restaurant" | "station" | "garage" | "loisirs" | "hotel" | "transport" | "repere" | "autre";

export interface PoiCatMeta {
  label: string;
  plural: string;
  color: string;
  /** Pictogramme dessiné sur canvas (pas de serveur de polices requis). */
  glyph: string;
  /** Zoom à partir duquel l'icône apparaît (la carte va de 0,6 à 8,6). */
  minZoom: number;
  /** Priorité d'affichage quand les icônes se chevauchent (plus petit = plus important). */
  rank: number;
}

/**
 * Zooms d'apparition : ENTIERS, car MapLibre évalue les filtres de zoom d'une couche de symboles au zoom de tuile
 * (entier) — un seuil 3,4 n'apparaîtrait qu'au zoom 4. Calés sur le rendu iPhone (#13) : repères dès la vue
 * d'ensemble, commerces / stations / garages dès la vue de quartier (~3), restos et loisirs un cran plus près.
 */
export const POI_CATS: Record<PoiCat, PoiCatMeta> = {
  repere: { label: "Repère", plural: "Repères", color: "#FFB35C", glyph: "★", minZoom: 0, rank: 1 },
  commerce: { label: "Commerce", plural: "Commerces", color: "#FF3D8B", glyph: "$", minZoom: 3, rank: 2 },
  station: { label: "Station-service", plural: "Stations", color: "#FF6F61", glyph: "⛽", minZoom: 3, rank: 3 },
  garage: { label: "Garage", plural: "Garages", color: "#5AB8FF", glyph: "G", minZoom: 3, rank: 3 },
  restaurant: { label: "Restaurant / bar", plural: "Restos & bars", color: "#FFD166", glyph: "R", minZoom: 4, rank: 4 },
  loisirs: { label: "Loisirs", plural: "Loisirs", color: "#2EE6D6", glyph: "♪", minZoom: 4, rank: 4 },
  hotel: { label: "Hôtel", plural: "Hôtels", color: "#B98CFF", glyph: "H", minZoom: 4, rank: 5 },
  transport: { label: "Transport", plural: "Transports", color: "#9AA7C2", glyph: "T", minZoom: 5, rank: 6 },
  autre: { label: "Lieu", plural: "Autres lieux", color: "#C9C3D8", glyph: "•", minZoom: 6, rank: 7 },
};

/** Catégories proposées en filtre (ordre d'affichage). */
export const POI_FILTERS: PoiCat[] = ["commerce", "station", "garage", "restaurant", "loisirs", "repere", "hotel", "transport", "autre"];

const GAS = /\b(gas station|fuel|gas)\b|\bxero\b|globe oil|\bron\b/i;
const GARAGE = /garage|pay ?['’]?n['’]? ?spray|customs|auto (shop|repair|body)|body shop|mechanic|\btow(ing)?\b|impound/i;
const SHOP = /supermarket|market|\bshop\b|store|\bmart\b|liquor|pawn|ammu-?nation|clothing|boutique|pharmacy|souvenir/i;
const FOOD = /restaurant|diner|caf[eé]|bar\b|grill|pizza|burger|taco|bistro|cantina|club\b|lounge|tavern|pub\b|anchor/i;

export function poiCategory(l: Landmark): PoiCat {
  const t = new Set(l.tags);
  const n = l.name;
  if (GAS.test(n)) return "station";
  if (GARAGE.test(n)) return "garage";
  if (t.has("restaurant") || t.has("fastfood")) return "restaurant";
  if (t.has("retail") || t.has("supermarket") || SHOP.test(n)) return "commerce";
  if (t.has("leisure") || t.has("events") || t.has("recreation")) return FOOD.test(n) ? "restaurant" : "loisirs";
  if (t.has("hotel")) return "hotel";
  if (t.has("landmark")) return "repere";
  if (t.has("transportation")) return "transport";
  if (FOOD.test(n) && t.has("enterable")) return "restaurant";
  return "autre";
}

export type PoiStatus = "uncertain" | "community";
/** « uncertain » : position ou identité incertaine selon gtadb (tag, point d'interrogation, démoli/fermé). */
export function poiStatus(l: Landmark): PoiStatus {
  return l.tags.some((t) => t === "unconfirmed" || t === "demolished" || t === "closed" || t === "cancelled") || /\?/.test(l.name) ? "uncertain" : "community";
}

export const POI_STATUS_FR: Record<PoiStatus, string> = {
  community: "Repère communautaire (gtadb) — non confirmé comme interactif en jeu",
  uncertain: "Repère incertain (position ou identité non confirmée par gtadb)",
};

export const poiName = (l: Landmark) => (l.name === "Lieu non identifié" ? "Lieu non identifié" : l.name.replace(/\?$/, ""));

const nk = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Mots de recherche (français ou anglais) qui désignent une catégorie. */
const CAT_WORDS: Array<[RegExp, PoiCat]> = [
  [/\b(commerces?|magasins?|boutiques?|shops?|stores?|supermarch[eé]s?|supermarkets?|superette|courses|epicerie)\b/, "commerce"],
  [/\b(stations?(-| )?service|stations?|essence|carburant|gas)\b/, "station"],
  [/\b(garages?|carrosserie|pay ?n ?spray|customs)\b/, "garage"],
  [/\b(restos?|restaurants?|bars?|manger|boire|diner|cafes?)\b/, "restaurant"],
  [/\b(loisirs?|activites?|divertissements?|clubs?|sorties?)\b/, "loisirs"],
  [/\b(hotels?|motels?)\b/, "hotel"],
  [/\b(reperes?|monuments?|landmarks?|attractions?)\b/, "repere"],
];

export function categoryFromQuery(q: string): PoiCat | null {
  const n = nk(q);
  for (const [re, c] of CAT_WORDS) if (re.test(n)) return c;
  return null;
}

/** Quartier/région cité dans la phrase, parmi ceux des repères (« à Key Lento »). */
export function districtFromQuery(q: string, landmarks: Landmark[]): string | null {
  const n = ` ${nk(q)} `;
  let best: string | null = null;
  const seen = new Set<string>();
  for (const l of landmarks) {
    for (const part of l.district.split(",").map((p) => p.trim()).filter(Boolean)) {
      if (seen.has(part)) continue;
      seen.add(part);
      if (part.length > 3 && n.includes(` ${nk(part)} `) && (!best || part.length > best.length)) best = part;
    }
  }
  return best;
}

const STOP = new Set(["the", "a", "of", "le", "la", "les", "de", "du", "des", "ou", "est", "trouver", "aller", "lieu"]);

/** Repère cité par son nom (tous les mots significatifs du nom présents dans la phrase). */
export function findPoi(q: string, landmarks: Landmark[], district?: string | null): Landmark | null {
  const qTok = new Set(nk(q).split(" "));
  let best: { l: Landmark; s: number } | null = null;
  for (const l of landmarks) {
    if (l.name === "Lieu non identifié") continue;
    const toks = nk(poiName(l)).split(" ").filter((t) => t && !STOP.has(t));
    if (!toks.length || !toks.every((t) => qTok.has(t) || qTok.has(t.replace(/s$/, "")))) continue;
    let s = toks.join("").length;
    if (district && l.district.includes(district)) s += 20;
    if (poiStatus(l) === "uncertain") s -= 5;
    if (!best || s > best.s) best = { l, s };
  }
  return best?.l ?? null;
}

/** Recherche de la carte : nom, quartier, catégorie (« supermarket », « station Key Lento »). */
export function searchPois(q: string, landmarks: Landmark[], limit = 12): Landmark[] {
  const n = nk(q);
  if (n.length < 2) return [];
  const cat = categoryFromQuery(q);
  const district = districtFromQuery(q, landmarks);
  const words = n.split(" ").filter((w) => w.length >= 2);
  const scored: Array<{ l: Landmark; s: number }> = [];
  for (const l of landmarks) {
    const name = nk(l.name);
    const dist = nk(l.district);
    let s = 0;
    if (name.includes(n)) s += 10;
    else if (words.every((w) => name.includes(w) || dist.includes(w) || l.tags.some((t) => t.startsWith(w)))) s += 5;
    if (cat && poiCategory(l) === cat) s += 6;
    if (district && l.district.includes(district)) s += cat ? 4 : 1;
    // une catégorie demandée filtre strictement (sauf nom exact), un quartier demandé aussi
    if (cat && poiCategory(l) !== cat && !name.includes(n)) s = 0;
    if (district && !l.district.includes(district) && !name.includes(n)) s = 0;
    if (s > 0) scored.push({ l, s: s - (poiStatus(l) === "uncertain" ? 1 : 0) - (l.name === "Lieu non identifié" ? 3 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s || POI_CATS[poiCategory(a.l)].rank - POI_CATS[poiCategory(b.l)].rank).slice(0, limit).map((x) => x.l);
}
