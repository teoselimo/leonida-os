import { assetUrl } from "@/lib/gtadb";
import type { HubCatalogItem, HubPlaces, HubVehicle } from "./model";

/**
 * Bundles du Data Hub chargés À LA DEMANDE (même origine que l'app : aucune connexion à GTABase ou GTADB pendant
 * la partie). Un échec de chargement rend une liste vide signalée, jamais des données de remplacement.
 */
const cache = new Map<string, Promise<unknown>>();
function load<T>(path: string, empty: T): Promise<{ data: T; ok: boolean }> {
  if (typeof document === "undefined" || typeof fetch === "undefined") return Promise.resolve({ data: empty, ok: false });
  if (!cache.has(path))
    cache.set(
      path,
      fetch(assetUrl(path))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data) => ({ data, ok: true }))
        .catch(() => {
          cache.delete(path);
          return { data: empty, ok: false };
        }),
    );
  return cache.get(path) as Promise<{ data: T; ok: boolean }>;
}

export const loadHubVehicles = () => load<HubVehicle[]>("data/hub/vehicles.json", []);
export const loadHubCatalog = () => load<HubCatalogItem[]>("data/hub/catalog.json", []);
export const loadHubPlaces = () => load<HubPlaces>("data/hub/places.json", { enrich: {}, unplaced: [], photosInGame: 0 });
