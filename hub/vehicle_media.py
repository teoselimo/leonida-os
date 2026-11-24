#!/usr/bin/env python3
"""Couche média du Garage (V0.20.1) : quelle image RÉELLE peut illustrer chaque fiche, avec association EXACTE.

  python3 hub/vehicle_media.py                     # mesure la couverture, écrit le manifeste (aucune image tierce intégrée)
  python3 hub/vehicle_media.py --allow gtabase     # intègre les images GTABase exactes (à n'activer qu'après accord)

Règles d'association : une image n'est retenue que si elle est l'image PRINCIPALE de la page de CETTE fiche ET que son
nom de fichier contient l'identifiant de la fiche (ex. page /gta-6/vehicles/sultan → …/karin-sultan.jpg). Sinon : écartée
(« ambiguë »), jamais rattachée à un modèle voisin. Les captures du joueur sont gérées dans l'app (sauvegarde locale).
Sortie : public/data/hub/vehicle-media.json (+ planches public/data/hub/vatlas/*.jpg si une source est autorisée ;
vignettes individuelles dans hub/cache/vehicles, non versionnées)."""
import argparse, io, json, os, re, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
ap = argparse.ArgumentParser(); ap.add_argument("--allow", action="append", default=[]); a = ap.parse_args()
recs = json.load(open(os.path.join(HERE, "records", "gtabase-vehicle.json")))
exact, ambiguous, missing = {}, [], []
for r in recs:
    url = r["prov"][0]["url"]; slug = url.rstrip("/").split("/")[-1]
    img = r["fields"].get("imageUrl")
    if not img:
        missing.append(r["id"]); continue
    fname = img.rsplit("/", 1)[-1].lower()
    toks = [t for t in slug.split("-") if len(t) > 1]
    if toks and all(t in fname for t in toks):
        exact[r["id"]] = img
    else:
        ambiguous.append({"id": r["id"], "image": img})
out = {"policy": "image principale de la page de la fiche, nom de fichier contenant l'identifiant de la fiche ; sinon aucune image",
       "sources": {"gtabase": {"allowed": "gtabase" in a.allow, "license": "GTABase.com — tous droits réservés ; intégration validée par Théo le 24/11/2026 (Artifact privé), image créditée et liée", "exactAvailable": len(exact), "ambiguous": len(ambiguous), "noImage": len(missing)}},
       "refs": {}}
if "gtabase" in a.allow:
    from PIL import Image
    d = os.path.join(HERE, "cache", "vehicles"); os.makedirs(d, exist_ok=True)  # vignettes individuelles : cache local
    for vid, img in exact.items():
        f = vid.split("/")[-1] + ".jpg"
        dst = os.path.join(d, f)
        if os.path.exists(dst):  # reprise : image déjà réduite
            out["refs"][vid] = {"file": dst, "source": img, "credit": "GTABase"}; continue
        __import__("time").sleep(0.4)  # politesse
        raw = subprocess.run(["curl", "-sSL", "-m", "30", "-A", "Mozilla/5.0 (compatible; LEONIDA-OS-DataHub/0.20.1)", img], capture_output=True).stdout
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGB"); im.thumbnail((480, 480))
            b = io.BytesIO(); im.save(b, "JPEG", quality=70, optimize=True)
            open(dst, "wb").write(b.getvalue())
            out["refs"][vid] = {"file": dst, "source": img, "credit": "GTABase"}
        except Exception as e:
            print("échec", vid, e)
# Planches (« atlas ») : un Artifact est limité à 512 fichiers ; 32 vignettes 320×180 par planche, dans l'ordre
# constructeur puis nom (≈ l'ordre d'affichage du Garage) pour que la première page ne charge qu'une ou deux planches.
if out["refs"]:
    from PIL import Image
    vrec = {r["id"]: r for r in recs}
    order = sorted(out["refs"], key=lambda v: ((vrec[v]["fields"].get("manufacturer") or "~").lower(), vrec[v]["name"].lower()))
    adir = os.path.join(ROOT, "public", "data", "hub", "vatlas"); os.makedirs(adir, exist_ok=True)
    for f in os.listdir(adir):
        os.remove(os.path.join(adir, f))
    COLS, ROWS, CW, CH = 8, 4, 320, 180
    for a in range(0, len(order), COLS * ROWS):
        sheet = Image.new("RGB", (COLS * CW, ROWS * CH), (232, 232, 240))
        for k, vid in enumerate(order[a:a + COLS * ROWS]):
            im = Image.open(out["refs"][vid]["file"]).convert("RGB")
            im.thumbnail((CW, CH))
            cell = Image.new("RGB", (CW, CH), im.getpixel((2, 2)))
            cell.paste(im, ((CW - im.width) // 2, (CH - im.height) // 2))
            sheet.paste(cell, ((k % COLS) * CW, (k // COLS) * CH))
            out["refs"][vid].update({"atlas": f"data/hub/vatlas/{a // (COLS * ROWS)}.jpg", "i": k})
        sheet.save(os.path.join(adir, f"{a // (COLS * ROWS)}.jpg"), "JPEG", quality=72, optimize=True, progressive=True)
    out["atlas"] = {"cols": COLS, "rows": ROWS, "cellW": CW, "cellH": CH}
    for v in out["refs"].values():
        v.pop("file", None)
json.dump(out, open(os.path.join(ROOT, "public", "data", "hub", "vehicle-media.json"), "w"), ensure_ascii=False, indent=0)
print(json.dumps(out["sources"], ensure_ascii=False), "intégrées :", len(out["refs"]))
print("exemples ambigus :", ambiguous[:5])
