#!/usr/bin/env node
/**
 * Collecte LEONIDA OS.
 *   tsx src/cli.ts --data ../data-branch            exécution planifiée (sources dues seulement)
 *   tsx src/cli.ts --data ../data-branch --force    toutes les sources maintenant (déclenchement manuel)
 *   tsx src/cli.ts --diagnose                       diagnostic sans écriture : état de chaque connecteur
 *   --only rockstar-youtube,pcgamer                 limiter aux sources citées
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFeed, runCollection } from "./engine.ts";
import { loadStore, saveStore } from "./store/fileStore.ts";
import type { Override, SourceConfig } from "./types.ts";
import type { VehicleOverride } from "./pipeline/garage.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const { sources } = JSON.parse(readFileSync(here("../sources.json"), "utf8")) as { sources: SourceConfig[] };
const ovFile = JSON.parse(readFileSync(here("../overrides.json"), "utf8")) as { items: Record<string, Override>; vehicles?: Record<string, VehicleOverride> };
const overrides = ovFile.items;
const diagnose = flag("diagnose");
const dataDir = val("data") ?? (diagnose ? "/tmp/leonida-diagnose" : "../data-branch");

const store = loadStore(dataDir);
const t0 = Date.now();
const summary = await runCollection(store, {
  sources,
  overrides,
  vehicleOverrides: ovFile.vehicles ?? {},
  env: process.env,
  force: flag("force") || diagnose,
  only: val("only")?.split(","),
  log: (m) => console.log(m),
  trigger: process.env.GITHUB_EVENT_NAME ?? "local",
  runId: process.env.GITHUB_RUN_ID ?? null,
});
const feed = buildFeed(store, sources, summary);
console.log(`Déclenchement : ${process.env.GITHUB_EVENT_NAME ?? "local"}${process.env.GITHUB_RUN_ID ? ` (run ${process.env.GITHUB_RUN_ID})` : ""}`);
console.log(`\nRésumé : ${summary.newItems} nouvelles fiches · ${summary.updatedItems} mises à jour · ${summary.duplicates} doublons ignorés · ${summary.deepReads} articles lus · ${summary.merged} fusions · ${summary.vehicles ?? 0} véhicules au garage · filtrés ${JSON.stringify(summary.filtered)} · ${feed.items.length} fiches publiées · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!diagnose) saveStore(dataDir, store, feed);
else console.log("(diagnostic : rien n'a été écrit)");
const hardFailures = summary.runs.filter((r) => !r.ok && !r.skipped);
// Échec du job seulement si TOUTES les sources tentées ont échoué : une source en panne ne bloque pas les autres
if (summary.runs.length && hardFailures.length === summary.runs.filter((r) => !r.skipped).length && hardFailures.length > 0) process.exit(2);
