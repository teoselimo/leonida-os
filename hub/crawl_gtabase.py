"""Étape 1 de l'adaptateur GTABase : découverte par sitemap → index des URL → téléchargement en cache (reprise possible)."""
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetchlib import get, fetch_cached, load_state, save_state, STATE

ROOT = "https://www.gtabase.com/sitemap-4seo.xml"
SECTIONS = ["missions", "side-missions", "strangers", "vehicles", "weapons", "characters", "properties", "map", "animals", "radio-stations", "articles", "gangs", "random-events", "strangers-missions", "map-locations", "guides"]

def section_of(url):
    m = re.match(r"https://www\.gtabase\.com/gta-6/([^/?]+)", url)
    if m:
        s = m.group(1)
        return s if s in SECTIONS else ("cheats" if "cheat" in s else "other")
    if re.match(r"https://www\.gtabase\.com/(vehicles|articles|news|side-missions|characters|animals|weapons|properties|gangs|soundtrack)/gta-6/", url):
        # second schéma d'URL du même CMS (/vehicles/gta-6/…), toujours actif : même section
        sec = url.split("/")[3]
        return "side-missions" if sec == "side-missions" else ("articles" if sec in ("articles", "news") else ("soundtrack" if sec == "soundtrack" else sec))
    return None

def discover():
    code, idx, err = get(ROOT)
    if not idx:
        raise SystemExit(f"Sitemap inaccessible : {err}")
    subs = [u for u in re.findall(r"<loc>([^<]+)</loc>", idx) if ".en-GB." in u]
    urls = {}
    failed = []
    for s in subs:
        c, x, e = get(s)
        if not x:
            failed.append({"url": s, "error": e}); continue
        for m in re.finditer(r"<url>\s*<loc>([^<]+)</loc>(?:\s*<lastmod>([^<]+)</lastmod>)?", x):
            u = m.group(1).replace("&amp;", "&")
            sec = section_of(u)
            if sec:
                urls[u] = {"section": sec, "lastmod": m.group(2)}
    return {"discoveredAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "sitemaps": subs, "sitemapFailures": failed, "urls": dict(sorted(urls.items()))}

LINK_RX = re.compile(r'href="(/(?:gta-6/(?:missions|strangers|vehicles|weapons|characters|properties|side-missions)|(?:vehicles|characters|properties|side-missions|weapons)/gta-6)/[a-z0-9][a-z0-9-]*)"')

def discover_links(index, rounds_cache):
    """Complète le sitemap (plafonné à 8 000 URL) par les liens internes des pages déjà lues : fiches GTA 6 uniquement."""
    from fetchlib import cache_path
    added = 0
    for u in list(index["urls"]):
        p = cache_path("gtabase", u)
        if not os.path.exists(p) or u in rounds_cache:
            continue
        rounds_cache.add(u)
        for h in LINK_RX.findall(open(p, encoding="utf-8").read()):
            if h.endswith(("/comparison", "/best-vehicles")):
                continue
            full = "https://www.gtabase.com" + h
            if full not in index["urls"] and full + "/" not in index["urls"]:
                sec = section_of(full)
                if sec:
                    index["urls"][full] = {"section": sec, "lastmod": None, "discoveredBy": "lien interne", "from": u}
                    added += 1
    return added

if __name__ == "__main__":
    offline = "--offline" in sys.argv
    limit = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--max=")), "100000"))
    os.makedirs(STATE, exist_ok=True)
    ip = os.path.join(STATE, "gtabase-index.json")
    old = json.load(open(ip)) if os.path.exists(ip) else {"urls": {}}
    if offline:
        index = old
    else:
        index = discover()
        # liens internes découverts lors des exécutions précédentes : conservés
        for u, m in old["urls"].items():
            if m.get("discoveredBy") and u not in index["urls"]:
                index["urls"][u] = m
    PRIO = {s: i for i, s in enumerate(["missions", "side-missions", "strangers", "properties", "characters", "vehicles", "map", "weapons", "gangs", "random-events", "map-locations", "guides", "strangers-missions", "radio-stations", "animals", "soundtrack", "cheats", "articles", "other"])}
    st = load_state("gtabase")
    n = {"cached": 0, "fetched": 0, "failed": 0, "offline-miss": 0, "cached-stale": 0}
    budget = [limit]
    def run(items):
        for i, (u, m) in enumerate(items):
            if budget[0] <= 0:
                return
            _, info = fetch_cached("gtabase", u, m.get("lastmod"), offline=offline, st=st)
            if info["status"] == "fetched":
                budget[0] -= 1
            n[info["status"]] = n.get(info["status"], 0) + 1
            if info["status"] == "failed":
                print("ÉCHEC", u, info.get("error"), flush=True)
            if i % 25 == 0:
                save_state("gtabase", st); print(i, len(items), n, flush=True)
    run(sorted(index["urls"].items(), key=lambda kv: (PRIO.get(kv[1]["section"], 99), kv[0])))
    if not offline:
        seen = set()
        for rnd in range(3):
            new = discover_links(index, seen)
            print("liens internes : +", new, flush=True)
            if not new:
                break
            run([(u, m) for u, m in index["urls"].items() if m.get("discoveredBy") and not os.path.exists(__import__("fetchlib").cache_path("gtabase", u))])
    json.dump(index, open(ip, "w"), ensure_ascii=False, indent=0)
    save_state("gtabase", st)
    print("FIN", n, "index", len(index["urls"]), flush=True)
