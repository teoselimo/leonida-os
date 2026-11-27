#!/usr/bin/env python3
"""
Construit les assets carte de LEONIDA OS à partir d'un clone de github.com/rolux/gtadb.org.

  python3 scripts/build_gtadb_assets.py <chemin_clone_gtadb> [--tileset day] [--maxz 5]

Sorties (dans public/) :
  tiles/{z}/{x}/{y}.jpg   tuiles 2048 px (assemblage 8×8 des tuiles 256 px gtadb) — schéma XYZ, peu de fichiers
  data/landmarks.json     lieux compactés : [id, nom, x, y, adresse_réelle, tags]
  data/gtadb.json         métadonnées (révision, date, licence)

Licence des données/tuiles : CC BY 4.0 — "GTA VI Landmarks Data / Map Tiles (CC BY 4.0) — https://map.gtadb.org".
Modifications : tuiles ré-assemblées en 2048 px et recompressées (V0.15 : niveau natif z6 inclus, JPEG 84) ; données réduites aux champs utiles.
"""
import json, os, subprocess, sys, argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--tileset", default="day")
ap.add_argument("--maxz", type=int, default=6, help="zoom gtadb maximal (6 = résolution native du fond « day », 2 px par unité de jeu)")
ap.add_argument("--block", type=int, default=8, help="tuiles 256 px assemblées par côté (8 → tuiles 2048 px)")
ap.add_argument("--quality", type=int, default=84, help="qualité JPEG (84, sous-échantillonnage 4:2:0 : indiscernable de la source à l'œil)")
ap.add_argument("--minz", type=int, default=0, help="ne régénère que les niveaux gtadb >= minz")
ap.add_argument("--data-only", action="store_true", help="ne régénère que data/*.json")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public"))
a = ap.parse_args()

tdir = os.path.join(a.src, "maps", "tiles", "6", a.tileset)
count = 0
if a.data_only:
    a.maxz = -1
out_tiles = os.path.join(a.out, "tiles")
os.makedirs(out_tiles, exist_ok=True)

# Couleur de l'océan prise dans un coin de la carte
first = None
if not a.data_only:
  first = os.path.join(tdir, "0", sorted(os.listdir(os.path.join(tdir, "0")))[0])
  ocean = Image.open(first).convert("RGB").getpixel((4, 4))
for z in range(a.minz, a.maxz + 1):
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
        im.save(os.path.join(d, f"{MY}.jpg"), quality=a.quality, optimize=True, progressive=True, subsampling=2)
        count += 1
    print(f"z{oz}: {len(metas)} tuiles {256*B} px")

raw = json.load(open(os.path.join(a.src, "map", "data", "6", "landmarks.json")))
def tags_of(tags):
    # « #clothes », « #tattoos »… = type de commerce indiqué par gtadb : conservé sans le « # »
    out = []
    for t in [t[1:] for t in tags if t.startswith("#")] + [t for t in tags if t.isalpha()]:
        if t.isalpha() and t not in out:
            out.append(t)
    return out[:5]

lm = []
for k, v in raw.items():
    name, pos, _, real, _, _, tags, _, _ = v
    if not pos:
        continue
    lm.append([k, name, round(pos[0], 1), round(pos[1], 1), real or "", tags_of(tags)])
os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
json.dump(lm, open(os.path.join(a.out, "data", "landmarks.json"), "w"), ensure_ascii=False, separators=(",", ":"))

rev = subprocess.run(["git", "-C", a.src, "log", "-1", "--format=%H|%cI"], capture_output=True, text=True).stdout.strip().split("|")
prev = {}
try:
    prev = json.load(open(os.path.join(a.out, "data", "gtadb.json")))
except Exception:
    pass
meta = {
    "source": "https://github.com/rolux/gtadb.org",
    "revision": rev[0] if rev else None,
    "updatedAt": rev[1] if len(rev) > 1 else None,
    "tileset": a.tileset,
    "tileSize": 256 * a.block,
    "maxzoom": prev.get("maxzoom") if a.data_only else a.maxz + 2 - __import__("math").ceil(__import__("math").log2(a.block)),
    "landmarks": len(lm),
    "license": "CC BY 4.0",
    "attribution": "GTA VI Landmarks Data & Map Tiles (CC BY 4.0) — map.gtadb.org",
    "changes": "Tuiles ré-assemblées en grandes tuiles et recompressées, assombries à l'affichage ; données réduites (type de commerce « #… » conservé).",
}
json.dump(meta, open(os.path.join(a.out, "data", "gtadb.json"), "w"), ensure_ascii=False, indent=1)
print(f"{count} tuiles, {len(lm)} lieux — révision {meta['revision']}")
