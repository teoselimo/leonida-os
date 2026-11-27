"""Adaptateur GTADB : dépôt public github.com/rolux/gtadb.org (CC BY 4.0).
Repères BRUTS = public/data/landmarks.json (format historique, inchangé) ; ici on produit des enregistrements Hub
« place » qui gardent tout ce que la source fournit (photos disponibles, contrepartie réelle, étiquettes, dates)."""
import json, os, subprocess, time

REPO = "https://github.com/rolux/gtadb.org"
LIC = "CC BY 4.0 — GTA VI Landmarks Data (CC BY 4.0) — https://map.gtadb.org"

def sync_clone(path, offline=False):
    """Clone épars (map/data/6) ou mise à jour. Retourne (révision, date, erreur|None)."""
    err = None
    if not os.path.isdir(os.path.join(path, ".git")):
        if offline:
            return None, None, "clone absent (mode hors ligne)"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        r = subprocess.run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO, path], capture_output=True, text=True)
        if r.returncode:
            return None, None, r.stderr[-300:]
        subprocess.run(["git", "-C", path, "sparse-checkout", "set", "--no-cone", "map/data/6/"], capture_output=True)
    elif not offline:
        r = subprocess.run(["git", "-C", path, "fetch", "--depth", "1", "origin", "main"], capture_output=True, text=True)
        if r.returncode:
            err = "fetch : " + r.stderr[-200:]
        else:
            subprocess.run(["git", "-C", path, "reset", "--hard", "FETCH_HEAD"], capture_output=True)
    rev = subprocess.run(["git", "-C", path, "log", "-1", "--format=%H|%cI"], capture_output=True, text=True).stdout.strip().split("|")
    return rev[0] or None, (rev[1] if len(rev) > 1 else None), err

FLAG_TAGS = {"unconfirmed": "non confirmé par GTADB", "demolished": "démoli", "closed": "fermé", "construction": "en construction", "reused": "modèle réutilisé", "mirrored": "inversé", "enterable": "accessible à l'intérieur"}

def records(path, rev, revdate):
    raw = json.load(open(os.path.join(path, "map", "data", "6", "landmarks.json")))
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    out = []
    for lid, v in raw.items():
        name, pos, igsz, real, latlng, rlsz, tags, _user, ts = (v + [None] * 9)[:9]
        parts = [p.strip() for p in (name or "").split(",")]
        label = parts[0] if parts and parts[0] != "?" else None
        commerce = [t[1:] for t in tags if t.startswith("#")]
        flags = [FLAG_TAGS[t] for t in tags if t in FLAG_TAGS]
        fields = {
            "gtadbName": name,
            "district": parts[-1] if len(parts) > 1 else None,
            "neighbourhood": parts[1] if len(parts) > 2 else None,
            "position": {"x": round(pos[0], 1), "y": round(pos[1], 1)} if pos else None,
            "tags": [t for t in tags if t.isalpha()],
            "commerce": commerce,
            "flags": flags,
            "realWorld": {"address": real, "lat": latlng[0], "lng": latlng[1]} if real and latlng else ({"address": real} if real else None),
            "photos": {"inGame": bool(igsz), "realLife": bool(rlsz)},
            "gtadbUpdated": time.strftime("%Y-%m-%d", time.gmtime(ts[0])) if ts and ts[0] else None,
        }
        fields = {k: x for k, x in fields.items() if x not in (None, [], {})}
        missing = [k for k in ("position", "label") if (k == "position" and not pos) or (k == "label" and not label)]
        out.append({
            "id": f"place:gtadb-{lid}",
            "type": "place",
            "name": label or name,
            "unnamed": not label,
            "fields": fields,
            "rel": [],
            "prov": [{"source": "gtadb", "ref": lid, "url": f"https://map.gtadb.org/?id={lid}", "revision": rev, "revisionDate": revdate, "collectedAt": now, "license": LIC}],
            "conf": "faible" if "unconfirmed" in tags or not pos else "moyenne",
            "cov": {"present": sorted(fields), "missing": missing},
        })
    return out
