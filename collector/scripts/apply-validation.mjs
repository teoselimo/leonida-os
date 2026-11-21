#!/usr/bin/env node
/**
 * Applique une validation de point depuis une demande GitHub (corps de l'issue sur stdin).
 * Formats acceptés (bloc ```json) :
 *   { "vehicle": "v-pegassi-vitello", "point": { "x": -1100, "y": 2950 } }     → overrides.vehicles
 *   { "r-48606a2278": { "location": { "x": 1, "y": 2, "place": "…" } } }       → overrides.items
 * Garde-fous : identifiants au format attendu, coordonnées numériques dans les limites de la carte, rien d'autre n'est modifié.
 */
import { readFileSync, writeFileSync } from "node:fs";

const body = readFileSync(0, "utf8");
const m = body.match(/```json\s*([\s\S]*?)```/);
if (!m) {
  console.error("Aucun bloc ```json dans la demande.");
  process.exit(1);
}
let data;
try {
  data = JSON.parse(m[1]);
} catch (e) {
  console.error("JSON invalide : " + e.message);
  process.exit(1);
}
const inMap = (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 16384;
const path = new URL("../overrides.json", import.meta.url);
const ov = JSON.parse(readFileSync(path, "utf8"));
ov.items ??= {};
ov.vehicles ??= {};
const done = [];
if (data.vehicle) {
  if (!/^v-[a-z0-9-]{3,80}$/.test(data.vehicle) || !inMap(data.point?.x) || !inMap(data.point?.y) || (data.point.x === 0 && data.point.y === 0)) {
    console.error("Validation véhicule refusée : identifiant ou point invalide (remplacez x/y par le point relevé en jeu).");
    process.exit(1);
  }
  ov.vehicles[data.vehicle] = { ...(ov.vehicles[data.vehicle] ?? {}), point: { x: Math.round(data.point.x * 10) / 10, y: Math.round(data.point.y * 10) / 10 } };
  done.push(`${data.vehicle} → x=${data.point.x}, y=${data.point.y}`);
} else {
  for (const [id, v] of Object.entries(data)) {
    const loc = v?.location;
    if (!/^r-[a-f0-9]{10}$/.test(id) || !inMap(loc?.x) || !inMap(loc?.y) || (loc.x === 0 && loc.y === 0)) {
      console.error(`Validation refusée pour ${id} : identifiant ou point invalide.`);
      process.exit(1);
    }
    ov.items[id] = { ...(ov.items[id] ?? {}), location: { x: loc.x, y: loc.y, ...(typeof loc.place === "string" ? { place: loc.place.slice(0, 120) } : {}) } };
    done.push(`${id} → x=${loc.x}, y=${loc.y}`);
  }
}
writeFileSync(path, JSON.stringify(ov, null, 2) + "\n");
console.log(done.join("\n"));
