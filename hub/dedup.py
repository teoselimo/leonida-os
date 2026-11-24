"""Déduplication : une même entité sous plusieurs URL (deux schémas d'URL GTABase, ou une mission présente à la fois
dans « missions » et « strangers ») devient UN enregistrement qui garde toutes ses provenances ; un champ différent
entre les deux pages est conservé comme contradiction, jamais tranché en silence. Les variantes (modèle de base,
variante, exemplaire unique) restent des enregistrements distincts reliés entre eux."""
import collections

FAMILY = {"stranger": "mission"}
BY_URL = ("article", "list-page", "other", "map-feature")

def dedup(records, report, nk):
    by_type = collections.defaultdict(list)
    # la page « strangers » est gardée en priorité (champs propres aux missions secondaires)
    for r in sorted(records, key=lambda r: 0 if r["type"] == "stranger" else 1):
        by_type[FAMILY.get(r["type"], r["type"])].append(r)
    merged = []
    for typ, rs in by_type.items():
        seen = {}
        for r in rs:
            k = nk(r["name"]) if typ not in BY_URL else r["prov"][0]["url"]
            canon = r["prov"][0].get("canonical") if typ != "map-feature" else None
            hit = seen.get(k) or (seen.get(canon) if canon else None)
            if hit:
                for f, v in r["fields"].items():
                    if f in hit["fields"] and hit["fields"][f] != v and f not in ("imageUrl", "objectives", "rewards"):
                        hit.setdefault("conflicts", []).append({"field": f, "values": [{"v": hit["fields"][f], "src": hit["prov"][0]["url"]}, {"v": v, "src": r["prov"][0]["url"]}]})
                    elif f not in hit["fields"]:
                        hit["fields"][f] = v
                hit["prov"] += r["prov"]
                hit["rel"] += r["rel"]
                hit.setdefault("aliasIds", []).append(r["id"])
                report.setdefault("duplicates", []).append({"type": typ, "name": r["name"], "kept": hit["id"], "merged": r["id"]})
                continue
            seen[k] = r
            if canon:
                seen[canon] = r
            merged.append(r)
    return merged
