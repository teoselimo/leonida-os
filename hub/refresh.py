#!/usr/bin/env python3
"""LEONIDA DATA HUB — commande d'actualisation reproductible.

  python3 hub/refresh.py                 # GTADB (git) + GTABase (sitemap → cache → extraction) + liaison + rapport + bundles
  python3 hub/refresh.py --offline       # aucune requête réseau : rejoue l'extraction sur le cache local
  python3 hub/refresh.py --source gtadb  # une seule source
  python3 hub/refresh.py --max 50        # limite les téléchargements (essai)

Sorties :
  hub/records/<source>-<type>.json   référentiel normalisé (une ligne de provenance par enregistrement)
  hub/history/changes.jsonl          historique des ajouts / suppressions / champs modifiés
  hub/reports/latest.{json,md}       rapport d'import (sources OK / en échec, comptes, couverture, contradictions)
  public/data/hub/*.json             bundles chargés à la demande par l'app (Garage, catalogue, lieux)
  src/data/hub/*.json                bundles embarqués (missions pour Story/Autopilot, méta)
Rien n'est jamais inventé : une page non lue est signalée, ses anciennes données restent marquées « non revérifiées »."""
import argparse, collections, json, os, re, subprocess, sys, time, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from fetchlib import cache_path, load_state, STATE
from adapters import gtadb as A_GTADB, gtabase as A_GTABASE

ap = argparse.ArgumentParser()
ap.add_argument("--offline", action="store_true")
ap.add_argument("--source", default="all", choices=["all", "gtadb", "gtabase"])
ap.add_argument("--max", type=int, default=None)
ap.add_argument("--gtadb-clone", default=os.path.join(HERE, "cache", "gtadb"))
a = ap.parse_args()
NOW = time.strftime("%Y-%m-%dT%H:%M:%S%z")
REC = os.path.join(HERE, "records"); os.makedirs(REC, exist_ok=True)
report = {"runAt": NOW, "mode": "hors ligne" if a.offline else "en ligne", "sources": {}, "counts": {}, "changes": {}, "links": {}, "conflicts": [], "gaps": {}, "duplicates": []}

def nk(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[’'`]", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def load(p, d=None):
    try:
        return json.load(open(p))
    except Exception:
        return d

def dump(p, obj, compact=False):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 0, sort_keys=not compact)
    os.replace(tmp, p)

# une source non relancée garde son dernier état connu (signalé comme tel)
_prev_report = load(os.path.join(HERE, "reports", "latest.json"), {}) or {}
for _k, _v in (_prev_report.get("sources") or {}).items():
    report["sources"][_k] = {**_v, "status": _v.get("status"), "note": f"non relancée lors de cette exécution (état du {_prev_report.get('runAt', '?')})"}

# ── 1. GTADB ─────────────────────────────────────────────────────────────
places = load(os.path.join(REC, "gtadb-place.json"), [])
if a.source in ("all", "gtadb"):
    rev, revdate, err = A_GTADB.sync_clone(a.gtadb_clone, offline=a.offline)
    cur = load(os.path.join(ROOT, "public", "data", "gtadb.json"), {})
    st = {"name": "GTADB (github.com/rolux/gtadb.org)", "license": "CC BY 4.0", "revision": rev, "revisionDate": revdate, "ourRevision": cur.get("revision")}
    if rev:
        places = A_GTADB.records(a.gtadb_clone, rev, revdate)
        st["status"] = "ok" if not err else "partiel"
        st["upToDate"] = rev == cur.get("revision")
    else:
        st["status"] = "échec"
    if err:
        st["error"] = err
    report["sources"]["gtadb"] = st

# ── 2. GTABase ───────────────────────────────────────────────────────────
# source non relancée : on repart du référentiel déjà écrit (jamais d'effacement)
gb = [r for f in sorted(os.listdir(REC)) if f.startswith("gtabase-") and f != "gtabase-mission-index.json" for r in (load(os.path.join(REC, f), []) or [])]
mission_index = load(os.path.join(REC, "gtabase-mission-index.json"), [])
if a.source in ("all", "gtabase"):
    args = [sys.executable, os.path.join(HERE, "crawl_gtabase.py")] + (["--offline"] if a.offline else []) + ([f"--max={a.max}"] if a.max else [])
    r = subprocess.run(args, capture_output=True, text=True)
    tail = (r.stdout.strip().splitlines() or ["?"])[-1]
    index = load(os.path.join(STATE, "gtabase-index.json"), {"urls": {}})
    fst = load_state("gtabase")
    out, failed, notcached = [], [], []
    for url, meta in index["urls"].items():
        p = cache_path("gtabase", url)
        if not os.path.exists(p):
            (failed if url in fst and fst[url].get("lastError") else notcached).append({"url": url, "error": fst.get(url, {}).get("lastError")})
            continue
        html = open(p, encoding="utf-8").read()
        if url.rstrip("/").endswith("/gta-6/missions"):
            mission_index = A_GTABASE.parse_mission_index(html)
        rec = A_GTABASE.normalize(meta["section"], url, html, meta, fst.get(url, {}).get("fetchedAt"))
        if fst.get(url, {}).get("lastError"):
            rec["stale"] = True  # dernière lecture en échec : données de la lecture précédente
        out.append(rec)
    previous_urls = {p["url"] for row in gb for p in row["prov"]}
    read_urls = {p["url"] for row in out for p in row["prov"]}
    gb = out
    report["sources"]["gtabase"] = {"name": "GTABase (www.gtabase.com, sitemap public)", "license": A_GTABASE.LIC, "status": "partiel" if failed or notcached else "ok",
                                    "sitemapUrls": len(index["urls"]), "discoveredAt": index.get("discoveredAt"), "sitemapFailures": index.get("sitemapFailures", []),
                                    "read": len(out), "failed": failed, "notFetchedYet": len(notcached), "crawler": tail,
                                    "notes": ["Endpoint /media/com_jamegafilter/en_gb/1.json (403) non utilisé.", "Aucune API supposée : lecture du HTML public et du sitemap."]}

# Une collecte incomplète ne doit pas remplacer les fiches et leurs relations.
incomplete = []
if a.source in ("all", "gtadb") and (not places or st["status"] != "ok"):
    incomplete.append("gtadb")
if a.source in ("all", "gtabase") and (
    r.returncode or not out or previous_urls - read_urls or index.get("sitemapFailures")
    or any(row.get("stale") for row in out)
):
    incomplete.append("gtabase")
if incomplete:
    dump(os.path.join(HERE, "reports", "last-attempt.json"),
         {"attemptAt": NOW, "staleSources": incomplete, "sources": report["sources"],
          "retainedSnapshotAt": _prev_report.get("runAt")})
    sys.exit("Collecte incomplète, instantané précédent conservé : " + ", ".join(incomplete))

# ── 3. Déduplication et variantes ───────────────────────────────────────
import dedup
gb = dedup.dedup(gb, report, nk)

# ── 4. Liaison aux entités déjà intégrées (relier, jamais reconstruire) ─
subprocess.run(["node", os.path.join(HERE, "export-leonida.mjs")], capture_output=True)
L = load(os.path.join(STATE, "leonida-entities.json"), {})
def name_index(items, extra=lambda e: []):
    ix = {}
    for e in items:
        for n in [e["name"]] + e.get("aliases", []) + extra(e):
            ix.setdefault(nk(n), e)
    return ix
prog_ix = name_index(L.get("progression", []))
story_ix = name_index(L.get("story", []))
know_ix = name_index(L.get("knowledge", []))
rvl_ix = name_index(L.get("rareVehicles", []), lambda e: [re.sub(r"^'\d+\s+|\s+'\d+", " ", e["name"]).strip()])
place_ix = collections.defaultdict(list)
for p in places:
    if not p.get("unnamed"):
        place_ix[nk(p["name"])].append(p)
mi_by_url = {m["url"]: m for m in mission_index}
link_stats = collections.Counter()
for r in gb:
    k = nk(r["name"])
    url = r["prov"][0]["url"]
    if r["type"] in ("mission", "stranger", "activity"):
        mi = next((mi_by_url[p["url"]] for p in r["prov"] if p["url"] in mi_by_url), None)
        if mi:
            r["fields"].update({k2: v for k2, v in (("order", mi["order"]), ("optional", mi["optional"]), ("missable", mi["missable"]), ("pointOfNoReturn", mi["pointOfNoReturn"])) if v})
            if mi.get("chapter") is not None and "chapter" not in r["fields"]:
                r["fields"]["chapter"] = mi["chapter"]
            if nk(mi["name"]) != k:
                r.setdefault("aliases", []).append(mi["name"])
        names = [r["name"]] + r.get("aliases", [])
        node = next((prog_ix.get(nk(n)) for n in names if prog_ix.get(nk(n))), None)
        snode = next((story_ix.get(nk(n)) for n in names if story_ix.get(nk(n))), None)
        if node:
            r["leonida"] = {"progression": node["id"]}; link_stats["mission→graphe"] += 1
            ch = r["fields"].get("chapter")
            if ch is not None and node.get("chapter") is not None and ch != node["chapter"]:
                report["conflicts"].append({"entity": node["id"], "field": "chapter", "leonida": node["chapter"], "gtabase": ch, "url": url, "applied": False})
        elif snode:
            r["leonida"] = {"story": snode["id"]}; link_stats["mission→Story"] += 1
        else:
            link_stats["mission nouvelle"] += 1
    elif r["type"] == "vehicle":
        e = rvl_ix.get(k) or rvl_ix.get(nk(f"{r['fields'].get('manufacturer', '')} {r['name']}"))
        if e:
            r["leonida"] = {"rareVehicle": e["id"]}; link_stats["véhicule→Rare Vehicle Locator"] += 1
        kv = know_ix.get(k)
        if kv and kv.get("type") == "vehicle":
            r.setdefault("leonida", {})["knowledge"] = kv["id"]; link_stats["véhicule→Knowledge"] += 1
    elif r["type"] in ("property", "character", "map-feature"):
        kv = know_ix.get(k)
        if kv:
            r["leonida"] = {"knowledge": kv["id"]}; link_stats[f"{r['type']}→Knowledge"] += 1
        if r["type"] == "property":
            cand = place_ix.get(k) or place_ix.get(nk(re.sub(r"\s+(safehouse|garage)$", "", r["name"], flags=re.I)))
            if cand and len(cand) == 1:
                r["rel"].append({"kind": "located_at", "to": cand[0]["id"], "basis": "nom identique au repère GTADB"}); link_stats["propriété→repère GTADB"] += 1
            elif cand:
                r["rel"].append({"kind": "located_candidates", "to": [c["id"] for c in cand], "basis": "plusieurs repères du même nom"}); link_stats["propriété→repères ambigus"] += 1
# phrases « How To Unlock » → missions préalables, fenêtre de perte, conditions (faits seulement)
import unlocks
aliases = (load(os.path.join(HERE, "aliases.json"), {}) or {}).get("missions", {})
mrecs = [r for r in gb if r["type"] in ("mission", "stranger", "activity")]
names = unlocks.build_name_index(mrecs, nk)
for r in mrecs:
    al = aliases.get(r["name"])
    if al and not (r.get("leonida") or {}).get("progression") and not (r.get("leonida") or {}).get("story"):
        r["leonida"] = {k: v for k, v in al.items() if k != "why"}; r["leonida"]["basis"] = "correspondance manuelle (hub/aliases.json)"
        link_stats["mission→LEONIDA (alias manuel)"] += 1; link_stats["mission nouvelle"] -= 1
    txt = r["fields"].get("unlockedBy")
    if not txt:
        continue
    u = unlocks.parse(txt, r["id"], names, nk)
    r["rel"] = [x for x in r["rel"] if x.get("kind") not in ("unlocked_by", "lost_at_start")]
    for t in u["after"]:
        r["rel"].append({"kind": "unlocked_by", "to": t, "basis": "phrase « How To Unlock »" + (" (« usually » : lien probable)" if u["weak"] else "")})
        if u["weak"]:
            r["fields"]["unlockWeak"] = True
    for t in u["lostAtStart"]:
        r["rel"].append({"kind": "lost_at_start", "to": t, "basis": "phrase « How To Unlock »"})
    if u["conditions"]:
        r["fields"]["conditions"] = u["conditions"]
    if u["missable"]:
        r["fields"]["missable"] = True
    if u["allOtherMains"]:
        r["fields"]["afterAllMainsOfChapter"] = u["allOtherMains"]
    link_stats["prérequis lus dans « How To Unlock »"] += len(u["after"])
    link_stats["fenêtres de perte lues"] += len(u["lostAtStart"])
# prérequis GTABase ≠ graphe validé : contradiction conservée (jamais appliquée au graphe)
hub2leo = {r["id"]: r["leonida"].get("progression") for r in mrecs if r.get("leonida", {}).get("progression")}
prog_by = {e["id"]: e for e in L.get("progression", [])}
for r in mrecs:
    pid = r.get("leonida", {}).get("progression")
    if not pid:
        continue
    theirs = [hub2leo.get(x["to"]) for x in r["rel"] if x.get("kind") == "unlocked_by"]
    mine = set(prog_by.get(pid, {}).get("prereq") or [])
    extra = [t for t in theirs if t and t not in mine]
    if theirs and extra:
        report["conflicts"].append({"entity": pid, "field": "prérequis", "leonida": sorted(mine), "gtabase": [t for t in theirs if t], "url": r["prov"][0]["url"], "applied": False})
# lieux GTADB déjà reliés à Knowledge / établissements
for e in L.get("knowledge", []):
    if e.get("landmark"):
        link_stats["Knowledge→repère GTADB"] += 1
for e in L.get("establishments", []):
    if e.get("landmark"):
        link_stats["établissement→repère GTADB"] += 1
report["links"] = dict(link_stats)

# résolution des relations par URL → ids Hub
url_to_id = {}
for r in gb:
    for p in r["prov"]:
        url_to_id[p["url"].rstrip("/")] = r["id"]
        if p.get("canonical"):
            url_to_id[p["canonical"].rstrip("/")] = r["id"]
unresolved = 0
for r in gb:
    for rl in r["rel"]:
        if "url" in rl:
            rl["to"] = url_to_id.get(rl["url"].rstrip("/"))
            if not rl["to"]:
                unresolved += 1
report["links"]["relations non résolues (page absente du sitemap)"] = unresolved

# ── 4c. Soluces GTABase → faits structurés par mission (V0.20.1) ─────────
from adapters import guides as A_GUIDES
gnames = A_GUIDES.name_dicts(gb, places, L.get("knowledge", []))
url_to_name = {}
for r in gb:
    for p in r["prov"]:
        url_to_name[p["url"].replace("https://www.gtabase.com", "").rstrip("/")] = r["name"]
gstat = collections.Counter()
for r in gb:
    if r["type"] not in ("mission", "stranger", "activity"):
        continue
    for p in r["prov"]:
        cp = cache_path("gtabase", p["url"])
        if not os.path.exists(cp):
            continue
        g = A_GUIDES.extract(open(cp, encoding="utf-8").read(), gnames, url_to_name, r["name"])
        if g and (g["steps"] or g["flags"]):
            r["fields"]["guide"] = g
            gstat["missions avec soluce structurée"] += 1
            gstat["étapes"] += len(g["steps"])
            gstat["faits (manquable, choix, conseil, non-retour)"] += len(g["flags"])
            gstat["entités citées"] += sum(len(v) for st in g["steps"] for v in st.get("e", {}).values())
            break
report["guides"] = dict(gstat)

# ── 5. Changements depuis la dernière exécution ─────────────────────────
import diff
prev = {}
for f in os.listdir(REC):
    if f.endswith(".json") and f != "gtabase-mission-index.json":
        prev.update(diff.snapshot([r for r in (load(os.path.join(REC, f), []) or []) if isinstance(r, dict) and "id" in r]))
new = diff.snapshot(places + gb)
added, removed, changed = diff.compare(prev, new)
first_run = not prev
report["changes"] = {"firstRun": first_run, "added": len(added), "removed": len(removed), "changed": len(changed), "examplesChanged": changed[:15], "examplesRemoved": removed[:15]}
os.makedirs(os.path.join(HERE, "history"), exist_ok=True)
with open(os.path.join(HERE, "history", "changes.jsonl"), "a") as fh:
    fh.write(json.dumps({"at": NOW, "firstRun": first_run, "added": added if not first_run else len(added), "removed": removed, "changed": changed}, ensure_ascii=False) + "\n")

# ── 6. Écriture du référentiel ──────────────────────────────────────────
dump(os.path.join(REC, "gtadb-place.json"), places, compact=True)
groups = collections.defaultdict(list)
for r in gb:
    groups[r["type"]].append(r)
for f in os.listdir(REC):
    if f.startswith("gtabase-") and f != "gtabase-mission-index.json":
        os.remove(os.path.join(REC, f))
for typ, rs in groups.items():
    dump(os.path.join(REC, f"gtabase-{typ}.json"), sorted(rs, key=lambda r: r["id"]), compact=True)
dump(os.path.join(REC, "gtabase-mission-index.json"), mission_index)
report["counts"] = {"gtadb": {"place": len(places), "placeAvecPosition": sum(1 for p in places if p["fields"].get("position")), "placeSansPosition": sum(1 for p in places if not p["fields"].get("position")), "photosEnJeuDisponibles": sum(1 for p in places if p["fields"].get("photos", {}).get("inGame"))},
                    "gtabase": {t: len(rs) for t, rs in sorted(groups.items(), key=lambda kv: -len(kv[1]))}, "gtabaseMissionIndex": len(mission_index)}
for typ, rs in groups.items():
    exp = A_GTABASE.EXPECTED.get(typ)
    if exp:
        report["gaps"][typ] = {f: sum(1 for r in rs if f in r["cov"]["missing"]) for f in exp}
for r in gb:
    for c in r.get("conflicts", []):
        report["conflicts"].append({"entity": r["id"], **c, "applied": False})

# ── 7. Bundles pour l'app ───────────────────────────────────────────────
import snapshot
snapshot.build(import_report=report)
bstats = report["bundles"]
import report_md
open(os.path.join(HERE, "reports", "latest.md"), "w").write(report_md.render(report))
print(json.dumps({"counts": report["counts"], "changes": report["changes"], "links": report["links"], "bundles": bstats}, ensure_ascii=False, indent=1))

attempt = os.path.join(HERE, "reports", "last-attempt.json")
if os.path.exists(attempt) and a.source == "all":
    os.remove(attempt)
