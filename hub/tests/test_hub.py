"""Tests du Data Hub (pipeline Python). Fixtures SYNTHÉTIQUES reproduisant la structure du CMS GTABase et du
fichier GTADB (aucune page réelle copiée dans le dépôt). Lancer : python3 -m unittest discover -s hub/tests -v"""
import json, os, re, sys, tempfile, unittest, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from adapters import gtabase as G, gtadb as D
from adapters.html_fields import parse_page
import dedup, diff, unlocks, fetchlib

def nk(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", re.sub(r"[’'`]", "", s)).strip()

VEH = """<html><head><title>Emperor Sultan | GTA 6</title><link rel="canonical" href="https://www.gtabase.com/gta-6/vehicles/sultan">
<script type="application/ld+json">{"@graph":[{"@type":"Article","datePublished":"2023-12-05T00:00:00Z","dateModified":"2026-11-22T20:08:42Z"}]}</script></head><body>
<h1>Emperor Sultan <small>Details</small></h1>
<ul class="fields-container">
<li class="field-entry vehicle-class "> <span class="field-label">Vehicle Class</span><span class="field-value "><a href="/x">Sports</a></span></li>
<li class="field-entry manufacturer "> <span class="field-label">Manufacturer</span><span class="field-value ">Emperor</span></li>
<li class="field-entry seats "> <span class="field-label">Seats</span><span class="field-value ">4</span></li>
<li class="field-entry weight "><span class="field-label ">Mass / Weight</span><span class="field-value ">1,400 <span class="field-suffix"> KG</span></span></li>
<li class="field-entry variant-conversion grid"> <span class="field-label">Variant / Conversion</span><span class="field-value "><div><a href="/gta-6/vehicles/moses-sultan">Moses' Sultan</a></div></span></li>
<li class="field-entry speed speed"><div class="field-label">Speed</div><div class="field-value">4.9</div></li>
<li class="field-entry acceleration"><div class="field-label">Acceleration</div><div class="field-value">6.1</div></li>
</ul></body></html>"""
VAR = VEH.replace("Emperor Sultan", "Emperor Moses' Sultan").replace("/gta-6/vehicles/sultan\"", "/gta-6/vehicles/moses-sultan\"").replace(
    '<li class="field-entry variant-conversion grid"> <span class="field-label">Variant / Conversion</span><span class="field-value "><div><a href="/gta-6/vehicles/moses-sultan">Moses\' Sultan</a></div></span></li>',
    '<li class="field-entry converted-from"> <span class="field-label">Base Model</span><span class="field-value "><a href="/gta-6/vehicles/sultan">Sultan</a></span></li>')
MIS = """<html><head><title>Building a Life | GTA 6</title></head><body><h1>Building a Life</h1>
<li class="field-entry mission-number"> <span class="field-label">Mission Number</span><span class="field-value ">19</span></li>
<li class="field-entry mission-type labels"> <span class="field-label">Mission Type</span><span class="field-value ">Mandatory Mission</span></li>
<li class="field-entry chapter-gta6"> <span class="field-label">Chapter</span><span class="field-value ">Chapter 1</span></li>
<li class="field-entry mission-protagonist"> <span class="field-label">Protagonist (Playable)</span><span class="field-value "><a href="/gta-6/characters/jason">Jason Duval</a></span></li>
<li class="field-entry how-to-unlock"> <span class="field-label">How To Unlock</span><span class="field-value ">completing Clear Skies, as it starts right after it</span></li>
<h3 class="indexed"><span></span>Help Build the Coffee Table</h3>
<span class="mission-reward__value">New coffee table</span>
<span class="mission-reward__label">Unlocked</span>
</body></html>"""
INDEX = """<h2>Chapter 1</h2>
<a href="/gta-6/missions/gear-up" class="items-row"><h3 class="contentheading"><input> <span class="field-value ">3</span>. Gear Up </h3></a>
<a href="/gta-6/missions/get-shirleys-rum" class="items-row items-row--opt"><h3 class="contentheading"><input> <span class="gtm-title">Get Shirley's Rum</span> <span class="gtm-badges"><span class="gtm-badge gtm-badge--opt">OPTIONAL</span><span class="gtm-badge gtm-badge--miss">MISSABLE</span></span></h3></a>
<a href="/gta-6/missions/tourist-trap" class="items-row"><h3 class="contentheading"><input> <span class="field-value ">23</span>. Tourist Trap <span class="gtm-badges"><span class="gtm-badge">CHAPTER 1 POINT OF NO RETURN</span></span></h3></a>
<h2>Chapter 2</h2>
<a href="/gta-6/missions/moses" class="items-row"><h3 class="contentheading"><input> <span class="field-value ">32</span>. Moses </h3></a>"""

def rec(section, url, html):
    return G.normalize(section, url, html, {"lastmod": "2026-11-22T00:00:00Z"}, "2026-11-24T10:00:00+0100")

class TestGtabaseAdapter(unittest.TestCase):
    def test_vehicle_fields_present_only(self):
        r = rec("vehicles", "https://www.gtabase.com/gta-6/vehicles/sultan", VEH)
        self.assertEqual(r["type"], "vehicle")
        self.assertEqual(r["fields"]["class"], "Sports")
        self.assertEqual(r["fields"]["weightKg"], 1400)
        self.assertEqual(r["fields"]["stats"], {"speed": 4.9, "acceleration": 6.1})
        self.assertNotIn("price", r["fields"])            # absent de la page → absent, jamais 0
        self.assertIn("price", r["cov"]["missing"])
        self.assertEqual(r["fields"]["tier"], "model")
        self.assertEqual(r["prov"][0]["modified"], "2026-11-22T20:08:42Z")
        self.assertEqual(r["conf"], "moyenne")             # une seule source

    def test_variant_and_unique(self):
        v = rec("vehicles", "https://www.gtabase.com/gta-6/vehicles/moses-sultan", VAR)
        self.assertEqual(v["fields"]["tier"], "variant")
        self.assertTrue(any(x["kind"] == "variant_of" for x in v["rel"]))
        u = rec("vehicles", "https://www.gtabase.com/gta-6/vehicles/donnie-car", VEH.replace("</ul>", '<li class="field-entry owned-by"><span class="field-label">Notable Owners</span><span class="field-value "><a href="/gta-6/characters/donnie">Donnie</a></span></li></ul>'))
        self.assertEqual(u["fields"]["tier"], "unique")

    def test_mission_fields_and_objectives(self):
        m = rec("missions", "https://www.gtabase.com/gta-6/missions/building-a-life", MIS)
        f = m["fields"]
        self.assertEqual((f["number"], f["chapter"], f["missionType"]), (19, 1, "Mandatory Mission"))
        self.assertEqual(f["protagonist"], ["Jason Duval"])
        self.assertEqual(f["objectives"], ["Help Build the Coffee Table"])
        self.assertEqual(f["rewards"], [{"value": "New coffee table", "label": "Unlocked"}])

    def test_list_page_is_not_a_mission(self):
        r = rec("strangers", "https://www.gtabase.com/gta-6/strangers-missions", "<h1>GTA 6 Strangers &amp; Freaks Missions List</h1>")
        self.assertEqual(r["type"], "list-page")

    def test_mission_index_badges(self):
        L = G.parse_mission_index(INDEX)
        self.assertEqual([x["name"] for x in L], ["Gear Up", "Get Shirley's Rum", "Tourist Trap", "Moses"])
        self.assertEqual([x["chapter"] for x in L], [1, 1, 1, 2])
        self.assertTrue(L[1]["missable"] and L[1]["optional"])
        self.assertTrue(L[2]["pointOfNoReturn"])

class TestUnlocks(unittest.TestCase):
    def setUp(self):
        names = ["Gear Up", "Lab Fees", "Just a Scratch", "Unwanted Attention", "Pipework", "Day Release", "Swamped", "Party Hard", "Power Play", "Mami Knows Best", "Car Service"]
        self.ix = unlocks.build_name_index([{"id": n, "name": n} for n in names], nk)
    def p(self, t):
        return unlocks.parse(t, "self", self.ix, nk)
    def test_list_stops_at_colon(self):
        u = self.p("completing Gear Up, Lab Fees, Just a Scratch and Unwanted Attention: Shirley then calls out to Jason on the way to Pipework.")
        self.assertEqual(sorted(u["after"]), ["Gear Up", "Just a Scratch", "Lab Fees", "Unwanted Attention"])
    def test_while_is_not_a_prerequisite(self):
        u = self.p("a text from Cal after Day Release, while Jason is driving to meet Brian in Swamped. It's missable")
        self.assertEqual(u["after"], ["Day Release"])
        self.assertTrue(u["missable"])
    def test_lost_window(self):
        u = self.p("completing Party Hard, after which Andrea asks you. It's missable and becomes unavailable once you start Power Play")
        self.assertEqual((u["after"], u["lostAtStart"]), (["Party Hard"], ["Power Play"]))
    def test_usually_is_weak(self):
        u = self.p("a call from Andy while playing as Lucia in Chapter 3, usually after Mami Knows Best and Car Service")
        self.assertTrue(u["weak"])
        self.assertIn("en jouant Lucia", u["conditions"])
    def test_no_sentence_no_prereq(self):
        self.assertEqual(self.p("")["after"], [])

class TestDedupAndDiff(unittest.TestCase):
    def _r(self, typ, name, url, **f):
        return {"id": f"gtabase:{url}", "type": typ, "name": name, "fields": f, "rel": [], "prov": [{"url": "https://x/" + url}]}
    def test_same_mission_in_two_sections_merged_with_conflict_kept(self):
        rep = {}
        out = dedup.dedup([self._r("mission", "Bad Driver!", "missions/bad-driver", chapter=4), self._r("stranger", "Bad Driver!", "strangers/bad-driver", chapter=3)], rep, nk)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], "gtabase:strangers/bad-driver")
        self.assertEqual(len(out[0]["prov"]), 2)
        self.assertEqual(out[0]["conflicts"][0]["field"], "chapter")
        self.assertEqual(len(rep["duplicates"]), 1)
    def test_variants_are_not_duplicates(self):
        out = dedup.dedup([self._r("vehicle", "Sultan", "v/sultan"), self._r("vehicle", "Moses' Sultan", "v/moses-sultan")], {}, nk)
        self.assertEqual(len(out), 2)
    def test_map_views_kept_apart(self):
        out = dedup.dedup([self._r("map-feature", "GTA 6 Interactive Map", "map/a"), self._r("map-feature", "GTA 6 Interactive Map", "map/b")], {}, nk)
        self.assertEqual(len(out), 2)
    def test_change_detection(self):
        a = diff.snapshot([self._r("vehicle", "Sultan", "v/s", price=1000), self._r("vehicle", "Old", "v/o")])
        b = diff.snapshot([self._r("vehicle", "Sultan", "v/s", price=1200), self._r("vehicle", "New", "v/n")])
        self.assertEqual(diff.compare(a, b), (["gtabase:v/n"], ["gtabase:v/o"], ["gtabase:v/s"]))

class TestFetchErrors(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.old = fetchlib.CACHE; fetchlib.CACHE = self.tmp
    def tearDown(self):
        fetchlib.CACHE = self.old
    def test_offline_miss_is_reported_not_invented(self):
        html, info = fetchlib.fetch_cached("t", "https://x/none", offline=True, st={})
        self.assertIsNone(html); self.assertEqual(info["status"], "offline-miss")
    def test_failure_keeps_previous_copy_flagged(self):
        url = "https://x/page"; p = fetchlib.cache_path("t", url)
        os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write("ancienne")
        orig = fetchlib.get; fetchlib.get = lambda u: (0, None, "timeout")
        try:
            st = {url: {"lastmod": "old"}}
            html, info = fetchlib.fetch_cached("t", url, lastmod="new", st=st)
        finally:
            fetchlib.get = orig
        self.assertEqual((html, info["status"]), ("ancienne", "failed"))
        self.assertEqual(st[url]["lastError"], "timeout")
    def test_cache_hit_when_lastmod_unchanged(self):
        url = "https://x/c"; p = fetchlib.cache_path("t", url)
        os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write("x")
        html, info = fetchlib.fetch_cached("t", url, lastmod="L", st={url: {"lastmod": "L"}})
        self.assertEqual(info["status"], "cached")

class TestGtadbAdapter(unittest.TestCase):
    def test_raw_landmarks_to_records(self):
        d = tempfile.mkdtemp(); os.makedirs(os.path.join(d, "map", "data", "6"))
        json.dump({"L266": ["Jason's House, Key Lento", [-2353.5, -5532.2], [3840, 1728], "12522 FL-24", [29.1, -83.0], [580, 436], ["#safehouse", "enterable", "l4"], "u", [1791723484, 0, 0]],
                   "L9": ["?, Somewhere", [], [], "", [], [], ["unconfirmed"], "u", [0, 0, 0]]}, open(os.path.join(d, "map", "data", "6", "landmarks.json"), "w"))
        r = {x["id"]: x for x in D.records(d, "abc", "2026-11-19")}
        j = r["place:gtadb-L266"]
        self.assertEqual(j["name"], "Jason's House")
        self.assertEqual(j["fields"]["commerce"], ["safehouse"])
        self.assertTrue(j["fields"]["photos"]["inGame"])
        self.assertEqual(j["prov"][0]["revision"], "abc")
        u = r["place:gtadb-L9"]
        self.assertNotIn("position", u["fields"])          # jamais de position inventée
        self.assertEqual(u["conf"], "faible")

if __name__ == "__main__":
    unittest.main()
