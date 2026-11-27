// Exporte les entités déjà intégrées à LEONIDA (graphe de progression, Story, Knowledge, Rare Vehicle Locator,
// établissements) pour que le Data Hub les RELIE au lieu de les reconstruire. Transpile les fichiers TS (types effacés).
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "leonida-export-"));
const files = ["progression", "story", "knowledge", "rareVehicles", "establishments"];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, "src/data", f + ".ts"), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, f + ".mjs"), out);
}
const imp = async (f) => import(path.join(tmp, f + ".mjs"));
const { PROGRESSION } = await imp("progression");
const { STORY_NODES } = await imp("story");
const { K_ENTITIES, KNOWLEDGE, ENTITIES } = await imp("knowledge");
const kn = K_ENTITIES ?? KNOWLEDGE ?? ENTITIES ?? Object.values(await imp("knowledge")).find((v) => Array.isArray(v) && v[0]?.kind);
const { RARE_VEHICLES } = await imp("rareVehicles");
const est = Object.values(await imp("establishments")).find((v) => Array.isArray(v) && v[0]?.cats);
const out = {
  progression: PROGRESSION.map((n) => ({ id: n.id, name: n.name, aliases: n.aliases ?? [], kind: n.kind, chapter: n.chapter, prereq: n.prereq?.all ?? null })),
  story: STORY_NODES.map((n) => ({ id: n.id, name: n.name, aliases: n.aliases ?? [], kind: n.kind, chapter: n.chapter })),
  knowledge: (kn ?? []).map((e) => ({ id: e.id, name: e.name, aliases: e.aliases ?? [], type: e.type, chapters: e.chapters, landmark: e.location?.landmarkId ?? null, district: e.location?.district ?? null })),
  rareVehicles: RARE_VEHICLES.map((v) => ({ id: v.id, name: v.name, aliases: v.aliases ?? [] })),
  establishments: (est ?? []).map((e) => ({ id: e.id, name: e.name, landmark: e.position?.landmarkId ?? null, district: e.district })),
};
fs.mkdirSync(path.join(ROOT, "hub/state"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "hub/state/leonida-entities.json"), JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
