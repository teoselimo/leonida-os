"""Bundles applicatifs générés depuis le référentiel Hub (format compact, faits uniquement)."""
import json, os, re

def _w(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    open(p, "w").write(s)
    return len(s.encode())

def slug(r):
    return r["id"].split("/", 1)[1]

def short(s, n=110):
    if not s:
        return None
    s = s.strip()
    if len(s) <= n:
        return s
    cut = s[:n]
    return cut[: cut.rfind(" ")] + "…"

def ids(rels, kind, prefix=None):
    out = []
    for r in rels:
        if r.get("kind") == kind and isinstance(r.get("to"), str) and (not prefix or r["to"].startswith(prefix)):
            if r["to"] not in out:
                out.append(r["to"])
    return out

def mod_of(r):
    return max([p.get("modified") or "" for p in r["prov"]])[:10] or None

def build(root, places, groups, mission_index, report):
    stats = {}
    # ── missions (embarquées : Story Intelligence / Autopilot les lisent de façon synchrone)
    ms = []
    kind_of = {"mission": None, "stranger": "stranger", "activity": "activity"}
    for typ in ("mission", "stranger", "activity"):
        for r in groups.get(typ, []):
            f = r["fields"]
            mt = (f.get("missionType") or "").lower()
            kind = kind_of[typ] or ("main" if "mandatory" in mt or f.get("number") else "side")
            if typ == "mission" and f.get("optional"):
                kind = "side"
            m = {
                "id": r["id"], "name": r["name"], "kind": kind,
                "chapter": f.get("chapter"), "number": f.get("number"), "order": f.get("order"),
                "jason": "Jason Duval" in (f.get("protagonist") or []), "lucia": "Lucia Caminos" in (f.get("protagonist") or []),
                "giver": f.get("giver") or None, "money": f.get("money"),
                "rewards": [{"v": short(x["value"], 60), "l": x["label"]} for x in (f.get("rewards") or [])][:6] or None,
                "after": [t for t in ids(r["rel"], "unlocked_by") if t != r["id"]] or None,
                "unlockKnown": bool(f.get("unlockedBy")),
                "lostAt": (ids(r["rel"], "lost_at_start") or [None])[0], "cond": f.get("conditions") or None, "afterAllMains": f.get("afterAllMainsOfChapter"), "weak": f.get("unlockWeak"),
                "optional": f.get("optional") or None, "missable": f.get("missable") or None, "pnr": f.get("pointOfNoReturn") or None,
                "req100": f.get("required100"), "objectives": (f.get("objectives") or [])[:8] or None,
                "url": r["prov"][0]["url"], "mod": mod_of(r), "leonida": r.get("leonida"), "aliases": r.get("aliases"),
                "location": f.get("location"),
            }
            ms.append({k: v for k, v in m.items() if v not in (None, [], False) or k in ("jason", "lucia") and v})
    ms.sort(key=lambda m: (m.get("chapter") or 99, m.get("order") or 999, m.get("number") or 999, m["name"]))
    stats["src/data/hub/missions.json"] = _w(os.path.join(root, "src", "data", "hub", "missions.json"), ms)

    # ── véhicules (chargés à la demande par le Garage)
    vs = []
    for r in groups.get("vehicle", []):
        f = r["fields"]
        v = {"id": r["id"], "n": r["name"], "c": f.get("class"), "m": f.get("manufacturer"), "e": f.get("era"), "st": f.get("style"), "sp": f.get("specialist"),
             "set": f.get("standoutSet"), "seats": f.get("seats"), "dt": f.get("drivetrain"), "g": f.get("gears"), "kg": f.get("weightKg"), "sto": f.get("storage"),
             "b": f.get("basedOn"), "p": f.get("price"), "reg": f.get("registerCost"), "sell": f.get("sellStolen"), "tr": f.get("tracker"), "cond": f.get("bodyCondition"),
             "how": short(f.get("howToGet"), 140), "ed": f.get("edition"), "s": f.get("stats"), "r": f.get("rating"), "t": f.get("tier"),
             "base": (ids(r["rel"], "variant_of") or [None])[0], "vars": ids(r["rel"], "has_variant") or None, "own": f.get("owners") or None,
             "u": r["prov"][0]["url"], "mod": mod_of(r), "lk": r.get("leonida"), "alt": len(r["prov"]) > 1 or None}
        vs.append({k: x for k, x in v.items() if x not in (None, [], "")})
    # variantes déclarées seulement d'un côté : on complète l'autre côté (même fait, deux sens)
    byid = {v["id"]: v for v in vs}
    for v in vs:
        if v.get("base") in byid:
            b = byid[v["base"]]
            b.setdefault("vars", [])
            if v["id"] not in b["vars"]:
                b["vars"].append(v["id"])
    vs.sort(key=lambda v: (v.get("m") or "~", v["n"]))
    stats["public/data/hub/vehicles.json"] = _w(os.path.join(root, "public", "data", "hub", "vehicles.json"), vs)

    # ── catalogue multi-catégories
    keep = {"weapon": ["category", "manufacturer", "price", "howToGet", "stats"], "character": ["role", "occupation", "location", "aka", "affiliation"],
            "property": ["propertyType", "style", "location", "region", "price", "capacity", "howToUnlock", "occupants"], "animal": ["group", "class", "habitat", "location", "size"],
            "radio": [], "map-feature": ["sections"], "gang": [], "random-event": [], "cheat": [], "guide": []}
    cat = []
    for typ, flds in keep.items():
        for r in groups.get(typ, []):
            f = {k: (short(r["fields"][k], 140) if isinstance(r["fields"][k], str) else r["fields"][k]) for k in flds if k in r["fields"]}
            rel = [{"k": x["kind"], "to": x["to"]} for x in r["rel"] if x.get("to")][:12]
            c = {"id": r["id"], "t": typ, "n": r["name"], "f": f or None, "rel": rel or None, "u": r["prov"][0]["url"], "mod": mod_of(r), "lk": r.get("leonida")}
            cat.append({k: x for k, x in c.items() if x})
    stats["public/data/hub/catalog.json"] = _w(os.path.join(root, "public", "data", "hub", "catalog.json"), cat)

    # ── couche lieux enrichie (les repères bruts restent public/data/landmarks.json)
    linked = {}
    for typ in ("property",):
        for r in groups.get(typ, []):
            for x in r["rel"]:
                if x["kind"] == "located_at":
                    linked.setdefault(x["to"].replace("place:gtadb-", ""), []).append(r["id"])
    enrich = {}
    unplaced = []
    for p in places:
        lid = p["prov"][0]["ref"]; f = p["fields"]
        if not f.get("position"):
            unplaced.append({"id": lid, "n": p["name"], "d": f.get("district"), "tags": f.get("tags") or None})
            continue
        e = {"hub": linked.get(lid), "photo": 1 if f.get("photos", {}).get("inGame") else None, "flags": f.get("flags") or None}
        e = {k: v for k, v in e.items() if v}
        if e.get("hub") or e.get("flags"):
            enrich[lid] = e
    photos = sum(1 for p in places if p["fields"].get("photos", {}).get("inGame"))
    stats["public/data/hub/places.json"] = _w(os.path.join(root, "public", "data", "hub", "places.json"), {"enrich": enrich, "unplaced": unplaced, "photosInGame": photos})

    # ── méta (fraîcheur, comptes, état des sources) — embarquée
    counts = {"missions": sum(1 for m in ms if m["kind"] in ("main", "side")), "strangers": sum(1 for m in ms if m["kind"] == "stranger"), "activities": sum(1 for m in ms if m["kind"] == "activity"),
              "vehicles": len(vs), "vehicleModels": sum(1 for v in vs if v.get("t") == "model"), "vehicleVariants": sum(1 for v in vs if v.get("t") == "variant"), "vehicleUniques": sum(1 for v in vs if v.get("t") == "unique"),
              **{k + "s": sum(1 for c in cat if c["t"] == k) for k in keep}, "places": len(places), "placesUnplaced": len(unplaced)}
    gb = report["sources"].get("gtabase", {}); gd = report["sources"].get("gtadb", {})
    meta = {"runAt": report["runAt"], "counts": counts,
            "gtabase": {"status": gb.get("status"), "read": gb.get("read"), "failed": len(gb.get("failed", [])), "discoveredAt": gb.get("discoveredAt"),
                        "latestModified": max([""] + [m.get("mod") or "" for m in ms] + [v.get("mod") or "" for v in vs]) or None},
            "gtadb": {"status": gd.get("status"), "revision": (gd.get("revision") or "")[:7], "revisionDate": gd.get("revisionDate"), "upToDate": gd.get("upToDate")},
            "missionIndex": len(mission_index)}
    stats["src/data/hub/meta.json"] = _w(os.path.join(root, "src", "data", "hub", "meta.json"), meta)
    return stats
