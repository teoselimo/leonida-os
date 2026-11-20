import { DISCOVERIES, RADAR, REGIONS } from "@/data/demo";
import type { Discovery, RadarSignal, Region } from "./types";

/**
 * Couche d'accès aux données.
 * V0 : `demoRepository` (données statiques embarquées, synchrone).
 * V1 : `apiRepository` → routes Next.js `/api/*` → PostgreSQL (voir db/schema.sql).
 * L'UI ne dépend que de cette interface.
 */
export interface ContentRepository {
  regions(): Region[];
  discoveries(): Discovery[];
  signals(): RadarSignal[];
}

export const demoRepository: ContentRepository = {
  regions: () => REGIONS,
  discoveries: () => DISCOVERIES,
  signals: () => RADAR,
};

/** Interface de persistance joueur (localStorage en V0, table player_progress en V1). */
export interface ProgressStore<T> {
  load(): T | null;
  save(state: T): void;
  clear(): void;
}

export function localProgressStore<T>(key: string): ProgressStore<T> {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        window.localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* stockage indisponible (navigation privée, quota) : l'app continue en mémoire */
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
