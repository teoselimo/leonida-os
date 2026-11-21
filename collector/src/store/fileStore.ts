import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CycleLog, RadarFeed, RadarRecord, RawItem, RunLog, SourceState, VehicleRecord } from "../types.ts";

/**
 * Stockage fichier (branche Git `data`). Même modèle que les tables SQL de sql/001_schema.sql :
 * raw_items, discoveries (+ evidence, revisions), ingestion_runs, source_registry state.
 * Remplaçable par un SupabaseStore sans toucher au pipeline.
 */
export interface Store {
  raw: Record<string, RawItem>;
  records: RadarRecord[];
  runs: RunLog[];
  state: Record<string, SourceState>;
  cycles: CycleLog[];
  vehicles: VehicleRecord[];
}

const read = <T>(dir: string, f: string, fallback: T): T => {
  const p = join(dir, f);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
};

const write = (dir: string, f: string, data: unknown) => {
  const p = join(dir, f);
  writeFileSync(p + ".tmp", JSON.stringify(data, null, 1));
  renameSync(p + ".tmp", p); // écriture atomique
};

export function loadStore(dir: string): Store {
  mkdirSync(dir, { recursive: true });
  return {
    raw: read(dir, "raw_items.json", {}),
    records: read(dir, "records.json", []),
    runs: read(dir, "runs.json", []),
    state: read(dir, "state.json", {}),
    cycles: read(dir, "cycles.json", []),
    vehicles: read(dir, "vehicles.json", []),
  };
}

export function saveStore(dir: string, s: Store, feed: RadarFeed) {
  mkdirSync(dir, { recursive: true });
  // Rétention : 60 jours d'éléments bruts, 400 dernières exécutions
  const cutoff = Date.now() - 60 * 86400_000;
  const raw = Object.fromEntries(Object.entries(s.raw).filter(([, r]) => Date.parse(r.fetchedAt) > cutoff));
  write(dir, "raw_items.json", raw);
  write(dir, "records.json", s.records);
  write(dir, "runs.json", s.runs.slice(-400));
  write(dir, "state.json", s.state);
  write(dir, "cycles.json", s.cycles.slice(-500));
  write(dir, "vehicles.json", s.vehicles ?? []);
  write(dir, "radar.json", feed);
}
