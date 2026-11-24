"""Adaptateur GTABase : index (sitemap) → pages en cache → enregistrements Hub normalisés par catégorie.
Ne conserve que des FAITS (champs structurés, listes, liens) et l'URL : pas de reprise des textes rédigés
(soluces, descriptions), ni des images (droits réservés) — on garde seulement l'URL de l'image pour la provenance."""
import re, time
from .html_fields import clean, parse_page

BASE = "https://www.gtabase.com"
LIC = "GTABase.com — tous droits réservés : faits et liens uniquement, pas de texte ni d'image repris"

def slug_of(url):
    return url.rstrip("/").split("/")[-1].split("?feature=")[-1]

def _txt(r, key):
    f = r["fields"].get(key)
    return f["text"] if f else None

def _links(r, key, prefix=None):
    f = r["fields"].get(key)
    if not f:
        return []
    out, seen = [], set()
    for l in f["links"]:
        h = l["href"]
        if prefix and not any(p in h for p in prefix):
            continue
        if h in seen or not l["text"]:
            continue
        seen.add(h); out.append({"href": h if h.startswith("http") else BASE + h, "name": l["text"]})
    return out

def _num(s):
    if s is None:
        return None
    m = re.search(r"-?[\d,]+(?:\.\d+)?", s)
    if not m:
        return None
    v = m.group(0).replace(",", "")
    return float(v) if "." in v else int(v)

def _money(s):
    if not s or "$" not in s:
        return None
    return _num(s.split("$", 1)[1])

def _list(s):
    if not s:
        return []
    return [x.strip() for x in re.split(r"\s*(?:,|/|\band\b)\s*", s) if x.strip()]

def _chapter(s):
    m = re.search(r"Chapter\s*(\d+)", s or "")
    return int(m.group(1)) if m else None

TYPE_OF = {"missions": "mission", "strangers": "stranger", "side-missions": "activity", "vehicles": "vehicle", "weapons": "weapon",
           "characters": "character", "properties": "property", "map": "map-feature", "animals": "animal", "radio-stations": "radio",
           "gangs": "gang", "random-events": "random-event", "cheats": "cheat", "articles": "article", "guides": "guide",
           "soundtrack": "radio", "map-locations": "map-feature", "strangers-missions": "stranger"}

EXPECTED = {
    "mission": ["number", "chapter", "missionType", "protagonist", "giver", "rewards", "unlockedBy", "objectives"],
    "stranger": ["chapter", "giver", "protagonist", "rewards", "unlockedBy"],
    "activity": ["location", "rewards", "unlockedBy"],
    "vehicle": ["class", "manufacturer", "stats", "seats", "drivetrain", "price", "howToGet"],
    "weapon": ["category", "stats", "price"],
    "character": ["role", "occupation", "location"],
    "property": ["propertyType", "location", "price", "howToUnlock", "capacity"],
}

def _is_index_page(r, url):
    bc = r.get("breadcrumb") or []
    return url.rstrip("/").endswith(("/missions", "/vehicles", "/weapons", "/characters", "/properties", "/strangers", "/animals", "/radio-stations", "/side-missions")) or (len(bc) >= 4 and "News" in (bc[3] or ""))

def record_id(section, url):
    # Deux fiches distinctes partagent le slug caddy. L'identifiant historique
    # reste associé au modèle dont la photo figure dans le Garage.
    if url.rstrip("/") == "https://www.gtabase.com/vehicles/gta-6/caddy":
        return "gtabase:vehicles/caddy-82"
    return f"gtabase:{section}/{slug_of(url)}"


def normalize(section, url, html, meta, fetched):
    r = parse_page(html, url)
    typ = TYPE_OF.get(section, "other")
    name = r.get("h1") or (r.get("title") or "").split("|")[0].strip()
    name = re.sub(r"\s*(Details)?$", "", name or "").strip()
    if _is_index_page(r, url) and typ not in ("article", "map-feature"):
        typ = "list-page" if not (r.get("breadcrumb") and len(r["breadcrumb"]) >= 4 and "News" in (r["breadcrumb"][3] or "")) else "article"
    f = {}
    rel = []
    def link_rel(kind, items):
        for it in items:
            rel.append({"kind": kind, "url": it["href"], "name": it["name"]})
    if typ in ("mission", "stranger"):
        f["number"] = _num(_txt(r, "mission-number"))
        f["missionType"] = _txt(r, "mission-type")
        f["chapter"] = _chapter(_txt(r, "chapter-gta6"))
        f["giver"] = [l["name"] for l in _links(r, "mission-for")] or _list(_txt(r, "mission-for"))
        f["protagonist"] = [l["name"] for l in _links(r, "mission-protagonist")] or _list(_txt(r, "mission-protagonist"))
        f["featuring"] = [l["name"] for l in _links(r, "featuring")] or _list(_txt(r, "featuring"))
        f["required100"] = (_txt(r, "required-for-100") or "").lower().startswith("yes") if _txt(r, "required-for-100") else None
        f["rewardsSummary"] = _txt(r, "mission-rewards-summary")
        f["rewards"] = r["rewards"]
        f["money"] = _money(_txt(r, "mission-rewards-summary"))
        how = r["fields"].get("how-to-unlock")
        if how:
            f["unlockedBy"] = how["text"]
            link_rel("unlocked_by", [l for l in _links(r, "how-to-unlock") if "/missions/" in l["href"] or "/strangers/" in l["href"]])
        f["objectives"] = [h for h in r["headings"] if len(h) < 80][:20]
        if f.get("number") is None and f.get("chapter") is None and not f.get("missionType"):
            typ = "list-page"  # page de liste (« … Missions List & Guide ») : pas une mission
        link_rel("giver", _links(r, "mission-for", ["/characters/"]))
        link_rel("protagonist", _links(r, "mission-protagonist", ["/characters/"]))
    elif typ == "activity":
        f["missionType"] = _txt(r, "mission-type")
        f["location"] = _txt(r, "location")
        f["objective"] = _txt(r, "objective")
        f["rewardsSummary"] = _txt(r, "rewards")
        f["giver"] = _list(_txt(r, "mission-for"))
        f["required100"] = (_txt(r, "required-for-100") or "").lower().startswith("yes") if _txt(r, "required-for-100") else None
        if _txt(r, "how-to-unlock"):
            f["unlockedBy"] = _txt(r, "how-to-unlock")
        link_rel("features_vehicle", _links(r, "featuring", ["/vehicles/"]))
    elif typ == "vehicle":
        f["class"] = _txt(r, "vehicle-class")
        f["manufacturer"] = _txt(r, "manufacturer")
        f["era"] = _txt(r, "gta6-era")
        f["style"] = _txt(r, "gta6-style")
        f["specialist"] = _txt(r, "gta6-specialist")
        f["standoutSet"] = _txt(r, "gta6-standout-set")
        f["seats"] = _num(_txt(r, "seats"))
        f["drivetrain"] = _txt(r, "drivetrain")
        f["gears"] = _num(_txt(r, "gears"))
        f["weightKg"] = _num(_txt(r, "weight"))
        f["storage"] = _num(_txt(r, "vehicle-storage"))
        f["basedOn"] = _txt(r, "based-on")
        f["bodyCondition"] = _txt(r, "gta6-body-condition")
        f["tracker"] = _txt(r, "gta6-tracker")
        f["price"] = _money(_txt(r, "price-story"))
        f["sellStolen"] = _money(_txt(r, "sell-price-stolen"))
        f["registerCost"] = _money(_txt(r, "gta6-cost-to-register"))
        f["howToGet"] = _txt(r, "how-to-unlock")
        f["edition"] = _txt(r, "game-edition")
        f["features"] = _txt(r, "vehicle-features")
        st = {k: _num(_txt(r, key)) for k, key in [("speed", "speed"), ("acceleration", "acceleration"), ("handling", "asphalt-handling"), ("offroad", "off-road-handling"), ("strength", "strength")]}
        st = {k: v for k, v in st.items() if v is not None}
        if st:
            f["stats"] = st
        f["rating"] = _num(_txt(r, "overall"))
        link_rel("variant_of", _links(r, "converted-from", ["/vehicles/"]))
        link_rel("has_variant", [l for l in _links(r, "variant-conversion", ["/vehicles/"]) if "gta-6" in l["href"]])
        link_rel("owned_by", _links(r, "owned-by", ["/characters/"]))
        f["owners"] = [l["name"] for l in _links(r, "owned-by")] or _list(_txt(r, "owned-by"))
        f["imageUrl"] = r.get("image")
        # modèle / variante / exemplaire unique, sur indices explicites de la page
        if f["owners"]:
            f["tier"], f["tierBasis"] = "unique", "propriétaire nommé (Notable Owners)"
        elif r["fields"].get("converted-from"):
            f["tier"], f["tierBasis"] = "variant", "modèle de base indiqué (Base Model)"
        else:
            f["tier"], f["tierBasis"] = "model", "aucun modèle de base indiqué"
        if not (f.get("class") or st):
            typ = "list-page"
    elif typ == "weapon":
        for k, v in r["fields"].items():
            pass
        f["category"] = _txt(r, "weapon-type") or _txt(r, "weapon-class") or _txt(r, "gta6-weapon-type") or _txt(r, "type")
        f["manufacturer"] = _txt(r, "manufacturer")
        f["price"] = _money(_txt(r, "price-story") or _txt(r, "price"))
        f["howToGet"] = _txt(r, "how-to-unlock") or _txt(r, "how-to-get")
        f["unique"] = bool(re.search(r"unique|one-of-a-kind", (_txt(r, "gta6-weapon-type") or "") + name, re.I)) or None
        st = {}
        for k, e in r["fields"].items():
            if k in ("damage", "fire-rate", "accuracy", "range", "mobility", "control", "reload", "clip-size", "capacity"):
                v = _num(e["text"])
                if v is not None:
                    st[k] = v
        if st:
            f["stats"] = st
    elif typ == "character":
        f["role"] = _txt(r, "role"); f["occupation"] = _txt(r, "occupation"); f["location"] = _txt(r, "location")
        f["actor"] = _txt(r, "performer-actor"); f["aka"] = _list(_txt(r, "nicknames"))
        f["affiliation"] = [l["name"] for l in _links(r, "affiliation")]
        link_rel("property", _links(r, "house", ["/properties/"]))
        link_rel("vehicle", _links(r, "vehicle-gta5", ["/vehicles/"]) + _links(r, "vehicles", ["/vehicles/"]))
        link_rel("appears_in", _links(r, "in-story-missions", ["/missions/"]))
        link_rel("gives", _links(r, "missions-given"))
    elif typ == "property":
        f["propertyType"] = _txt(r, "property-type"); f["style"] = _txt(r, "property-style")
        f["location"] = _txt(r, "location"); f["region"] = _txt(r, "area")
        f["price"] = _money(_txt(r, "price-story")); f["capacity"] = _num(_txt(r, "vehicles-capacity"))
        f["howToUnlock"] = _txt(r, "how-to-unlock")
        f["occupants"] = [l["name"] for l in _links(r, "occupants")] or _list(_txt(r, "occupants"))
        link_rel("parked_vehicle", _links(r, "parked-vehicles", ["/vehicles/"]))
        if _txt(r, "how-to-unlock"):
            link_rel("unlocked_by", [l for l in _links(r, "how-to-unlock") if "/missions/" in l["href"]])
    elif typ == "animal":
        f["group"] = _txt(r, "gta6-animal-category"); f["class"] = _txt(r, "animal-class"); f["species"] = _txt(r, "species")
        f["habitat"] = _txt(r, "gta6-habitat"); f["location"] = _txt(r, "location"); f["size"] = _txt(r, "animal-size")
    elif typ == "map-feature":
        f["feature"] = slug_of(url)
        # toutes les vues de la carte ont le même titre : le nom vient du filtre de l'URL
        name = slug_of(url).replace("-", " ").capitalize()
        f["sections"] = [h for h in r["h2"] if h and len(h) < 70][:40]
    else:
        f["title"] = r.get("title")
    f = {k: v for k, v in f.items() if v not in (None, [], "", {})}
    exp = EXPECTED.get(typ, [])
    present = sorted(f)
    rec = {
        "id": record_id(section, url),
        "type": typ,
        "name": name,
        "fields": f,
        "rel": rel,
        "prov": [{"source": "gtabase", "url": url, "canonical": r.get("canonical"), "published": r.get("published"), "modified": r.get("modified") or meta.get("lastmod"), "collectedAt": fetched, "license": LIC}],
        "conf": "moyenne",  # une seule source : jamais « élevée » sans recoupement
        "cov": {"present": present, "missing": [k for k in exp if k not in f]},
    }
    return rec

def parse_mission_index(html):
    """Liste des missions (page /gta-6/missions/) : ordre, chapitre, badges OPTIONAL / MISSABLE / POINT OF NO RETURN."""
    out, chapter = [], None
    pos = 0
    for m in re.finditer(r'<h2[^>]*>(.*?)</h2>|<a href="(/gta-6/(?:missions|strangers)/[^"]+)" class="items-row([^"]*)">(.*?)</a>', html, re.S):
        if m.group(1) is not None:
            c = re.search(r"Chapter\s*(\d+)", clean(m.group(1)))
            if c:
                chapter = int(c.group(1))
            elif clean(m.group(1)).lower().startswith("prologue"):
                chapter = 0
            continue
        body = m.group(4)
        h3 = re.search(r'<h3 class="contentheading">(.*?)</h3>', body, re.S)
        if not h3:
            continue
        num = re.search(r'field-value ">(\d+)</span>', h3.group(1))
        title = re.search(r'gtm-title">(.*?)</span>', h3.group(1))
        badges = [clean(b) for b in re.findall(r'gtm-badge[^"]*">(.*?)</span>', h3.group(1))]
        nm = clean(title.group(1)) if title else re.sub(r"^\d+\s*\.\s*", "", clean(h3.group(1)))
        for b in badges:
            nm = nm.replace(b, "").strip()
        pos += 1
        out.append({"url": BASE + m.group(2), "name": nm, "number": int(num.group(1)) if num else None, "chapter": chapter, "order": pos,
                    "optional": "--opt" in m.group(3) or "OPTIONAL" in badges, "missable": any("MISSABLE" in b for b in badges),
                    "pointOfNoReturn": any("NO RETURN" in b for b in badges), "badges": badges})
    return out
