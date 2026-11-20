// Post-build : rend les URLs de polices relatives au fichier CSS
// (l'export statique avec assetPrefix "." produit des chemins relatifs au document).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "out/_next/static/css";
for (const f of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
  const p = join(dir, f);
  const css = readFileSync(p, "utf8").replaceAll("url(_next/static/media/", "url(../media/").replaceAll("url(./_next/static/media/", "url(../media/");
  writeFileSync(p, css);
}
console.log("export corrigé : URLs de polices relatives");
