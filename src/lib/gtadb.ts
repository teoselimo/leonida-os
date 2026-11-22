/**
 * Intégration de la carte communautaire gtadb.org.
 *
 *  - Fond de carte et lieux : "GTA VI Landmarks Data & Map Tiles (CC BY 4.0) — map.gtadb.org"
 *  - Les assets sont générés en local par scripts/build_gtadb_assets.py (jamais chargés en direct
 *    depuis gtadb.org, conformément à la demande du projet).
 *  - Ce n'est PAS la carte officielle de Rockstar : c'est une reconstitution communautaire.
 */

export const GTADB_ATTRIBUTION = "Fond de carte & lieux : GTA VI Landmarks Data & Map Tiles (CC BY 4.0) — map.gtadb.org, modifiés";
export const GTADB_URL = "https://map.gtadb.org";
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";

/** Taille du monde gtadb (unités de jeu) — l'origine est au centre, y pointe vers le nord. */
const WORLD = 32768;
const HALF = 16384;

/** Coordonnées de jeu → pseudo lng/lat Web Mercator (tuiles XYZ alignées sur le monde gtadb). */
export function gameToLngLat(x: number, y: number): [number, number] {
  const u = (x + HALF) / WORLD;
  const v = (HALF - y) / WORLD;
  const lng = u * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;
  return [lng, lat];
}

export function lngLatToGame(lng: number, lat: number): [number, number] {
  const u = (lng + 180) / 360;
  const v = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  return [u * WORLD - HALF, HALF - v * WORLD];
}

/** Emprise des terres de Leonida (unités de jeu), pour le cadrage. */
export const LAND = { minX: -9900, maxX: 3300, minY: -8100, maxY: 9100 };

export interface Landmark {
  id: string;
  name: string;
  district: string;
  x: number;
  y: number;
  real: string;
  tags: string[];
}

let cache: Promise<Landmark[]> | null = null;

export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

export function loadLandmarks(): Promise<Landmark[]> {
  if (!cache) {
    cache = fetch(assetUrl("data/landmarks.json"))
      .then((r) => r.json())
      .then((rows: [string, string, number, number, string, string[]][]) =>
        rows.map(([id, full, x, y, real, tags]) => {
          const parts = full.split(",").map((p) => p.trim());
          const head = parts[0] === "?" ? "Lieu non identifié" : parts[0].replace(/"/g, "");
          return { id, name: head, district: parts.slice(1).join(", "), x, y, real, tags };
        }),
      )
      .catch(() => {
        cache = null;
        return [];
      });
  }
  return cache;
}

export interface GtadbMeta {
  revision: string | null;
  updatedAt: string | null;
  landmarks: number;
  tileset: string;
}

export function loadMeta(): Promise<GtadbMeta | null> {
  return fetch(assetUrl("data/gtadb.json")).then((r) => r.json()).catch(() => null);
}

const TAG_FR: Record<string, string> = {
  hotel: "Hôtel", residential: "Résidentiel", retail: "Commerce", restaurant: "Restaurant", leisure: "Loisirs",
  industrial: "Industriel", transportation: "Transport", natural: "Nature", government: "Public", utilities: "Infrastructure",
  enterable: "Accessible à l'intérieur", landmark: "Monument", demolished: "Démoli (IRL)", unconfirmed: "Non confirmé", events: "Événements", public: "Public",
  // types de commerce indiqués par gtadb (« #clothes »…), conservés depuis la V0.13
  clothes: "Type : vêtements", hair: "Type : coiffeur", tattoos: "Type : tatoueur", modshop: "Type : garage tuning", gas: "Type : station-service",
  supermarket: "Type : supérette", fastfood: "Type : restauration rapide", bar: "Type : bar", marina: "Type : marina", safehouse: "Planque", hospital: "Hôpital", police: "Police",
};
export const tagFr = (t: string) => TAG_FR[t] ?? t;
