// Build de l'Artifact LEONIDA OS (pilote « Claude dans un Artifact », issue #10).
// Même code que l'app GitHub Pages ; seules changent la source du flux (instantané daté embarqué)
// et la détection du moteur (Claude via le compte du joueur, détecté à l'exécution).
//   node scripts/artifact-build.mjs  →  out-artifact/ + out-artifact/manifest.json (fichiers à publier)
import { execSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
// 1. Instantané du flux : branche data (source de vérité de la veille)
run("git fetch -q origin data");
const feed = execSync("git show origin/data:radar.json", { maxBuffer: 64 << 20 }).toString();
const generatedAt = JSON.parse(feed).generatedAt;
// 2. Build statique avec le flux local
run("npx next build && node scripts/fix-export.mjs", { NEXT_PUBLIC_RADAR_URL: "data/radar.json", NEXT_PUBLIC_FEED_SNAPSHOT: "1", NEXT_TELEMETRY_DISABLED: "1" });
rmSync("out-artifact", { recursive: true, force: true });
cpSync("out", "out-artifact", { recursive: true });
rmSync("out-artifact/gameplay", { recursive: true, force: true });
// Les chemins commençant par « _ » sont réservés par l'hébergeur d'Artifacts : « _next » devient « nx »
// (références réécrites), et les fichiers du routeur « pages » inutilisés par l'app (export statique, routeur app) sont retirés.
renameSync("out-artifact/_next", "out-artifact/nx");
const prune = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (f.startsWith("_")) rmSync(p, { recursive: true, force: true });
    else if (statSync(p).isDirectory()) prune(p);
  }
};
prune("out-artifact");
const rewrite = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) rewrite(p);
    else if (/\.(html|js|css|txt|json|webmanifest)$/.test(f) && !p.includes("/data/")) {
      const t = readFileSync(p, "utf8");
      const n = t.replaceAll("_next/", "nx/");
      if (n !== t) writeFileSync(p, n);
    }
  }
};
rewrite("out-artifact");
writeFileSync("out-artifact/data/radar.json", feed);
// 3. Manifeste (limites de publication : 256 fichiers, 20 Mio par fichier, 64 Mio au total)
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ as: p.slice("out-artifact/".length), path: join(process.cwd(), p), size: statSync(p).size });
  }
};
walk("out-artifact");
const total = files.reduce((a, f) => a + f.size, 0);
writeFileSync("out-artifact/manifest.json", JSON.stringify({ generatedAt, builtAt: new Date().toISOString(), count: files.length, totalBytes: total, files }, null, 1));
console.log(`Artifact : ${files.length} fichiers, ${(total / 1048576).toFixed(1)} Mio, instantané du ${generatedAt}`);
if (files.some((f) => f.size > 20 << 20)) throw new Error("Fichier > 20 Mio : limite de publication dépassée");
if (files.length > 256 || total > 64 << 20) console.warn(`Publication en plusieurs envois nécessaire (${files.length} fichiers, 256 maximum par envoi ; 64 Mio maximum par envoi).`);
