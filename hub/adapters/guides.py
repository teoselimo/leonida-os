"""Soluces GTABase → FAITS structurés (V0.20.1). Rien du texte rédigé n'est conservé : seulement le titre de chaque étape
(objectif affiché en jeu), les entités citées (lieux, personnages, véhicules, armes — par lien interne ou nom exact
d'une fiche connue), les montants, et des drapeaux (manquable, choix, conseil, non-retour) rattachés à l'étape."""
import re
from .html_fields import clean

MISSABLE = re.compile(r"missable|gone for good|permanent(?:ly)?|can'?t (?:come|go) back|won'?t be able|last chance|only chance|unavailable (?:after|once)|lose (?:access|it)", re.I)
CHOICE = re.compile(r"\b(?:you (?:can|must|get to) (?:choose|decide)|(?:a|the|this|your) choice|kill or spare|spare (?:him|her|them)|decide whether)\b", re.I)
PNR = re.compile(r"point of no return", re.I)
MONEY = re.compile(r"\$\s?([\d]{1,3}(?:,\d{3})+|\d{3,7})")
KIND_OF_LINK = [("/characters/", "char"), ("/vehicles/", "veh"), ("/weapons/", "weapon"), ("/properties/", "place"), ("/missions/", "mission"), ("/strangers/", "mission")]

def _sections(html):
    a = html.find('id="walkthrough"')
    if a < 0:
        return []
    b = html.find('class="checklist-item', a)
    body = html[a:b if b > 0 else a + 60000]
    body = body[body.find('<div class="mission-walkthrough">'):] if '<div class="mission-walkthrough">' in body else body
    parts = re.split(r'<h3 class="indexed">(.*?)</h3>', body, flags=re.S)
    out = []
    if parts and clean(parts[0]):
        out.append(("", parts[0]))
    for i in range(1, len(parts), 2):
        out.append((clean(parts[i]), parts[i + 1] if i + 1 < len(parts) else ""))
    return out

def _ents(seg, names, url_to_name):
    found = {"place": [], "char": [], "veh": [], "weapon": [], "mission": []}
    for href, _txt in re.findall(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', seg, re.S):
        for frag, k in KIND_OF_LINK:
            if frag in href:
                nm = url_to_name.get(href.split("#")[0].rstrip("/"))
                if nm and nm not in found[k]:
                    found[k].append(nm)
    # un point de fin de phrase n'appartient pas au nom (« Key Lento. ») ; « .38 » reste intact
    text = " " + re.sub(r"\.(?!\d)", " ", re.sub(r"[^a-z0-9&.' ]+", " ", clean(seg).lower())) + " "
    for k, lst in names.items():
        for low, nm in lst:
            if f" {low} " in text and nm not in found[k] and not any(nm in x for x in found[k]):
                found[k].append(nm)
    return {k: v[:6] for k, v in found.items() if v}

def extract(html, names, url_to_name, self_name=""):
    secs = _sections(html)
    if not secs:
        return None
    steps, flags = [], []
    for title, seg in secs:
        ents = _ents(seg, names, url_to_name)
        if "mission" in ents:
            ents["mission"] = [m for m in ents["mission"] if m != self_name] or None
            if not ents["mission"]:
                del ents["mission"]
        money = sorted({int(m.replace(",", "")) for m in MONEY.findall(clean(seg))})[:4]
        if title:
            steps.append({"t": title[:80], **({"e": ents} if ents else {}), **({"$": money} if money else {})})
        # drapeaux, paragraphe par paragraphe (les entités viennent du paragraphe concerné)
        for p in re.findall(r"<p>(.*?)</p>|<div class=\"tip-box\">(.*?)</div>", seg, re.S):
            raw = p[0] or p[1]
            tx = clean(raw)
            if not tx:
                continue
            kinds = []
            if MISSABLE.search(tx): kinds.append("manquable")
            if CHOICE.search(tx): kinds.append("choix")
            if PNR.search(tx): kinds.append("non-retour")
            if p[1] or tx.lower().startswith("tip"): kinds.append("conseil")
            for k in kinds:
                e = _ents(raw, names, url_to_name)
                if e.get("mission"):
                    e["mission"] = [x for x in e["mission"] if x != self_name]
                    if not e["mission"]:
                        del e["mission"]
                m = sorted({int(x.replace(",", "")) for x in MONEY.findall(tx)})[:3]
                f = {"k": k, "step": title[:80] or None, **({"e": e} if e else {}), **({"$": m} if m else {})}
                if f not in flags:
                    flags.append(f)
    trophies = []
    a = html.find('id="trophies"') if 'id="trophies"' in html else html.find("Trophies &amp; Achievements")
    if a > 0:
        seg = html[a:html.find('id="walkthrough"', a) if 'id="walkthrough"' in html[a:] else a + 6000]
        trophies = [clean(x) for x in re.findall(r'<h3[^>]*>(.*?)</h3>', seg, re.S)][:6]
    return {"steps": steps[:16], "flags": flags[:12], **({"trophies": trophies} if trophies else {})}

STOP = {"pool", "bus", "taxi", "boat", "bike", "car", "truck", "van", "knife", "bat", "phone", "house", "home", "bar", "store", "shop", "beach", "marina", "dock", "pier", "airport", "motel", "park", "farm", "church", "bank", "the bank", "hotel", "garage", "gas station", "parking lot", "bridge", "intersection", "cell tower", "fist", "unarmed", "flashlight", "camera", "binoculars",
        "liquor store", "construction site", "supermarket", "gas stop", "warehouse", "trailer park", "apartment", "apartments", "restaurant", "nightclub", "hospital", "police station", "fire station", "school", "office", "factory", "airfield", "dealership", "body shop", "boat ramp", "lighthouse", "the docks", "the beach"}

def name_dicts(records, places, knowledge):
    """Noms exacts → entités, par type (minuscules ; noms courts ou génériques écartés)."""
    d = {"place": {}, "char": {}, "veh": {}, "weapon": {}, "mission": {}}
    def add(k, n, show=None):
        low = re.sub(r"[^a-z0-9&.' ]+", " ", (n or "").lower()).strip()
        if len(low) >= 5 and low not in STOP:
            d[k].setdefault(low, show or n)
    for r in records:
        t = r["type"]
        if t == "character":
            add("char", r["name"])
            for a in r["fields"].get("aka", []):
                add("char", a, r["name"])
        elif t in ("vehicle", "weapon"):
            k = "veh" if t == "vehicle" else "weapon"
            add(k, r["name"])
            mf = r["fields"].get("manufacturer")
            if mf and r["name"].startswith(mf + " "):
                add(k, r["name"][len(mf) + 1:], r["name"])  # la soluce dit « Donnie's H&L .38 », la fiche « Hawk & Little Donnie's H&L .38 »
        elif t == "property":
            add("place", r["name"])
        elif t in ("mission", "stranger"):
            add("mission", r["name"])
    for p in places:
        nm = (p["name"] or "").rstrip("?").strip().strip('"')
        if not p.get("unnamed") and p["fields"].get("position") and len(nm) >= 7 and not p["name"].endswith("?"):
            add("place", nm)
    for e in knowledge:
        if e.get("type") not in ("vehicle", "véhicule", "personnage"):
            add("place", e["name"])
    return {k: sorted(v.items(), key=lambda kv: -len(kv[0])) for k, v in d.items()}
