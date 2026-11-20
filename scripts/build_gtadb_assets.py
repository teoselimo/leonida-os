#!/usr/bin/env python3
"""
Construit les assets carte de LEONIDA OS à partir d'un clone de github.com/rolux/gtadb.org.

  python3 scripts/build_gtadb_assets.py <chemin_clone_gtadb> [--tileset day] [--maxz 5]

Sorties (dans public/) :
  tiles/{z}/{x}/{y}.jpg   tuiles 2048 px (assemblage 8×8 des tuiles 256 px gtadb) — schéma XYZ, peu de fichiers
  data/landmarks.json     lieux compactés : [id, nom, x, y, adresse_réelle, tags]
  data/gtadb.json         métadonnées (révision, date, licence)

Licence des données/tuiles : CC BY 4.0 — "GTA VI Landmarks Data / Map Tiles (CC BY 4.0) — https://map.gtadb.org".
Modifications : tuiles ré-assemblées en 1024 px et recompressées ; données réduites aux champs utiles.
"""
import json, os, subprocess, sys, argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--tileset", default="day")
ap.add_argument("--maxz", type=int, default=5)
ap.add_argument("--block", type=int, default=8, help="tuiles 256 px assemblées par côté (8 → tuiles 2048 px)")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public"))
a = ap.parse_args()

tdir = os.path.join(a.src, "maps", "tiles", "6", a.tileset)
out_tiles = os.path.join(a.out, "tiles")
os.makedirs(out_tiles, exist_ok=True)

# Couleur de l'océan prise dans un coin de la carte
first = os.path.join(tdir, "0", sorted(os.listdir(os.path.join(tdir, "0")))[0])
ocean = Image.open(first).convert("RGB").getpixel((4, 4))

count = 0
for z in range(0, a.maxz + 1):
    zdir = os.path.join(tdir, str(z))
    tiles = {}
    for f in os.listdir(zdir):
        _, y, x = f[:-4].split(",")
        tiles[(int(x), int(y))] = os.path.join(zdir, f)
    import math
    B = a.block
    oz = z + 2 - int(math.log2(B))
    if oz < 0:
        continue
    metas = {(x // B, y // B) for (x, y) in tiles}
    for (MX, MY) in metas:
        im = Image.new("RGB", (256 * B, 256 * B), ocean)
        for dx in range(B):
            for dy in range(B):
                p = tiles.get((MX * B + dx, MY * B + dy))
                if p:
                    im.paste(Image.open(p).convert("RGB"), (dx * 256, dy * 256))
        d = os.path.join(out_tiles, str(oz), str(MX))
        os.makedirs(d, exist_ok=True)
        im.save(os.path.join(d, f"{MY}.jpg"), quality=80, optimize=True, progressive=True)
        count += 1
    print(f"z{oz}: {len(metas)} tuiles {256*B} px")

raw = json.load(open(os.path.join(a.src, "map", "data", "6", "landmarks.json")))
lm = []
for k, v in raw.items():
    name, pos, _, real, _, _, tags, _, _ = v
    if not pos:
        continue
    lm.append([k, name, round(pos[0], 1), round(pos[1], 1), real or "", [t for t in tags if t.isalpha()][:4]])
os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
json.dump(lm, open(os.path.join(a.out, "data", "landmarks.json"), "w"), ensure_ascii=False, separators=(",", ":"))

rev = subprocess.run(["git", "-C", a.src, "log", "-1", "--format=%H|%cI"], capture_output=True, text=True).stdout.strip().split("|")
meta = {
    "source": "https://github.com/rolux/gtadb.org",
    "revision": rev[0] if rev else None,
    "updatedAt": rev[1] if len(rev) > 1 else None,
    "tileset": a.tileset,
    "tileSize": 256 * a.block,
    "maxzoom": a.maxz + 2 - __import__("math").ceil(__import__("math").log2(a.block)),
    "landmarks": len(lm),
    "license": "CC BY 4.0",
    "attribution": "GTA VI Landmarks Data & Map Tiles (CC BY 4.0) — map.gtadb.org",
    "changes": "Tuiles ré-assemblées en grandes tuiles et recompressées, assombries à l'affichage ; données réduites.",
}
json.dump(meta, open(os.path.join(a.out, "data", "gtadb.json"), "w"), ensure_ascii=False, indent=1)
print(f"{count} tuiles, {len(lm)} lieux — révision {meta['revision']}")
