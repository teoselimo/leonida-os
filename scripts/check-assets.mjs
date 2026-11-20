// Vérifie avant le build que les assets de carte sont présents (sinon carte vide en production).
import { existsSync, readdirSync } from "node:fs";

const required = ["public/tiles/0/0/0.jpg", "public/data/landmarks.json", "public/data/gtadb.json"];
const missing = required.filter((p) => !existsSync(p));
if (missing.length) {
  console.error(`\n✖ Assets de carte manquants : ${missing.join(", ")}
  Régénérez-les (voir README › Carte) :
    git clone --depth 1 --filter=blob:none --sparse https://github.com/rolux/gtadb.org ../gtadb
    git -C ../gtadb sparse-checkout set map/data/6 maps/tiles/6/day
    python3 scripts/build_gtadb_assets.py ../gtadb\n`);
  process.exit(1);
}
const count = (d) => readdirSync(d, { recursive: true }).filter((f) => String(f).endsWith(".jpg")).length;
console.log(`✓ Assets carte : ${count("public/tiles")} tuiles, lieux et métadonnées présents`);
