"""Détection des changements entre deux exécutions : nom, champs ET relations de chaque enregistrement."""
import json

def snapshot(recs):
    return {r["id"]: json.dumps({"name": r.get("name"), "type": r.get("type"), **r.get("fields", {}), "_rel": sorted(f"{x.get('kind')}>{x.get('to')}" for x in r.get("rel", []))}, sort_keys=True, ensure_ascii=False) for r in recs}

def compare(prev, new):
    added = [i for i in new if i not in prev]
    removed = [i for i in prev if i not in new]
    changed = [i for i in new if i in prev and prev[i] != new[i]]
    return added, removed, changed
