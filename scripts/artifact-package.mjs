// Prépare ./out pour un hébergeur qui réserve les noms commençant par "_" :
// renomme _next → nx et les fichiers préfixés, puis réécrit les références.
import { cpSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const SRC = "out", DST = "out-artifact";
rmSync(DST, { recursive: true, force: true });
cpSync(SRC, DST, { recursive: true });
renameSync(join(DST, "_next"), join(DST, "nx"));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
// renommer les segments commençant par "_"
for (const pass of [0, 1, 2]) {
  for (const p of walk(DST)) {
    const parts = p.split("/");
    const i = parts.findIndex((s, k) => k > 0 && s.startsWith("_"));
    if (i > 0) {
      const from = parts.slice(0, i + 1).join("/");
      const to = parts.slice(0, i).concat("u" + parts[i].slice(1)).join("/");
      try { renameSync(from, to); } catch {}
    }
  }
}
const rules = [
  [/_next\//g, "nx/"],
  [/\/_(error|app|not-found|buildManifest|ssgManifest)/g, "/u$1"],
  [/"_(buildManifest|ssgManifest)/g, '"u$1'],
];
for (const p of walk(DST)) {
  if (!/\.(html|js|css|txt|json)$/.test(p)) continue;
  let s = readFileSync(p, "utf8");
  for (const [re, rep] of rules) s = s.replace(re, rep);
  writeFileSync(p, s);
}
console.log(walk(DST).filter((p) => p.split("/").some((s, k) => k > 0 && s.startsWith("_"))).length, "chemins réservés restants");
