#!/usr/bin/env python3
"""Références visuelles Vision (V0.20.1) : photos EN JEU du dépôt GTADB (map/photos/6/L…,ig.jpg, CC BY 4.0 selon le
dépôt ; usage validé par Théo le 24/11/2026) → images réduites + index landmarkId → photo.

  python3 hub/vision_refs.py            # sélection par défaut (≈ 40), clone épars dans hub/cache/gtadb
  python3 hub/vision_refs.py --max 50

Sélection, par ordre : lieux Knowledge (déjà sourcés), planques, marinas, lieux NOMMÉS de Key Lento (chapitre 1),
aéroports et stations-service du chapitre 1, puis autres lieux nommés de Key Lento. Photo trop petite (< 400 px) : écartée.
Poids : 640 px de large au plus, JPEG ajusté jusqu'à ≤ 70 Ko. Sortie : public/data/hub/refs/*.jpg + vision-refs.json."""
import argparse, io, json, os, subprocess, sys, time
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
ap = argparse.ArgumentParser(); ap.add_argument("--max", type=int, default=42); ap.add_argument("--clone", default=os.path.join(HERE, "cache", "gtadb"))
a = ap.parse_args()
raw = json.load(open(os.path.join(a.clone, "map", "data", "6", "landmarks.json")))
ents = json.load(open(os.path.join(HERE, "state", "leonida-entities.json")))
know = {e["landmark"]: e for e in ents["knowledge"] if e.get("landmark")}
rev = subprocess.run(["git", "-C", a.clone, "log", "-1", "--format=%H|%cI"], capture_output=True, text=True).stdout.strip().split("|")

SKIP = ("Cell Tower", "Intersection", "Parking Lot", "Bridge")
def ok(lid):
    v = raw.get(lid)
    # une référence doit montrer un lieu reconnaissable : pas d'antenne, de carrefour ou de parking génériques
    return bool(v and v[1] and v[2] and v[2][0] >= 400 and "utilities" not in v[6] and not v[0].startswith(SKIP))
def named(lid):
    return not raw[lid][0].startswith("?")

picked, why = [], {}
def take(lid, reason):
    if lid not in why and ok(lid) and len(picked) < a.max:
        picked.append(lid); why[lid] = reason
for lid in know: take(lid, f"lieu Knowledge « {know[lid]['name']} »")
for lid, v in raw.items():
    if "#safehouse" in v[6]: take(lid, "planque")
for lid, v in raw.items():
    if "#marina" in v[6]: take(lid, "marina")
for lid, v in raw.items():
    if "Key Lento" in v[0] and named(lid) and "unconfirmed" not in v[6]: take(lid, "lieu nommé de Key Lento (chapitre 1)")
for lid, v in raw.items():
    if ("#airport" in v[6] or "#gas" in v[6]) and named(lid) and any(d in v[0] for d in ("Key Lento", "Mariana", "Grassrivers", "Hamlet", "Watson Bay", "Port Gellhorn")): take(lid, "aérodrome ou station du sud de Leonida")
for lid, v in raw.items():
    if "Key Lento" in v[0] and v[2][0] >= 900 if v[2] else False: take(lid, "vue large de Key Lento (lieu non nommé)")

# récupération des seules photos choisies (clone épars, pas les 2 487)
pats = ["map/data/6/"] + [f"/map/photos/6/{lid},ig.jpg" for lid in picked]
subprocess.run(["git", "-C", a.clone, "sparse-checkout", "set", "--no-cone", *pats], capture_output=True)
out_dir = os.path.join(ROOT, "public", "data", "hub", "refs"); os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    os.remove(os.path.join(out_dir, f))
index, total = [], 0
for lid in picked:
    src = os.path.join(a.clone, "map", "photos", "6", f"{lid},ig.jpg")
    if not os.path.exists(src):
        print("photo absente", lid); continue
    im = Image.open(src).convert("RGB"); im.thumbnail((640, 640))
    q = 74
    while True:
        b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True, progressive=True); data = b.getvalue()
        if len(data) <= 70_000 or q <= 40: break
        q -= 6
    open(os.path.join(out_dir, f"{lid}.jpg"), "wb").write(data); total += len(data)
    v = raw[lid]; parts = [p.strip() for p in v[0].split(",")]
    index.append({"id": lid, "name": parts[0] if parts[0] != "?" else None, "district": parts[-1] if len(parts) > 1 else None,
                  "file": f"data/hub/refs/{lid}.jpg", "w": im.width, "h": im.height, "bytes": len(data),
                  "knowledge": know.get(lid, {}).get("id"), "tags": [t for t in v[6] if not t.startswith("l") or not t[1:].isdigit()],
                  "why": why[lid], "source": f"https://github.com/rolux/gtadb.org/blob/main/map/photos/6/{lid},ig.jpg",
                  "gtadbUpdated": time.strftime("%Y-%m-%d", time.gmtime(v[8][1])) if v[8] and v[8][1] else None})
meta = {"revision": rev[0], "revisionDate": rev[1] if len(rev) > 1 else None, "license": "CC BY 4.0 — GTA VI Landmarks Data (CC BY 4.0) — https://map.gtadb.org (photos en jeu ; images du jeu © Rockstar Games)",
        "modified": "réduites à 640 px, JPEG ≤ 70 Ko", "available": sum(1 for v in raw.values() if v[2]), "count": len(index), "bytes": total, "refs": index}
json.dump(meta, open(os.path.join(ROOT, "public", "data", "hub", "vision-refs.json"), "w"), ensure_ascii=False, indent=0)
print(f"{len(index)} références, {total/1024:.0f} Ko au total ({total/max(1,len(index))/1024:.0f} Ko en moyenne)")
for r in index: print(r["id"], r["name"], r["district"], r["why"])
