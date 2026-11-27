"""Lecture générique des pages du CMS GTABase (Joomla + champs personnalisés).
Ne garde que ce qui est réellement présent dans la page ; jamais de valeur par défaut inventée."""
import html as H, json, re

def clean(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()

def links(s):
    return [{"href": H.unescape(m.group(1)), "text": clean(m.group(2))} for m in re.finditer(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', s or "", re.S)]

def _ld(t):
    out = []
    for m in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', t, re.S):
        try:
            out.append(json.loads(m))
        except Exception:
            pass
    return out

def _li_blocks(t):
    """<li class="field-entry …"> … </li> avec imbrication (les valeurs contiennent parfois des <li>)."""
    for m in re.finditer(r'<li class="field-entry ([^"]*)"[^>]*>', t):
        start = m.end(); depth = 1; i = start
        for mm in re.finditer(r"<li\b|</li>", t[start:]):
            depth += 1 if mm.group(0) == "<li" else -1
            if depth == 0:
                i = start + mm.start(); break
        yield m.group(1).split()[0], t[start:i]

def parse_page(t, url):
    rec = {"url": url}
    m = re.search(r"<title>(.*?)</title>", t, re.S); rec["title"] = clean(m.group(1)) if m else None
    m = re.search(r'<link rel="canonical" href="([^"]+)"', t); rec["canonical"] = m.group(1) if m else None
    m = re.search(r'<meta property="og:image" content="([^"]+)"', t) or re.search(r'<link rel="preload" href="(/images/gta-6/[^"]+)" as="image"', t)
    rec["image"] = (("https://www.gtabase.com" + m.group(1)) if m.group(1).startswith("/") else m.group(1)) if m else None
    for ld in _ld(t):
        g = ld.get("@graph", [ld]) if isinstance(ld, dict) else []
        for node in g:
            if isinstance(node, dict) and node.get("@type") == "Article":
                rec["published"] = node.get("datePublished"); rec["modified"] = node.get("dateModified")
            if isinstance(node, dict) and node.get("@type") == "BreadcrumbList":
                rec["breadcrumb"] = [it.get("item", {}).get("name") for it in node.get("itemListElement", [])]
    m = re.search(r'<h1[^>]*>(.*?)</h1>', t, re.S); rec["h1"] = clean(m.group(1)) if m else None
    fields = {}
    for key, body in _li_blocks(t):
        lab = re.search(r'class="field-label[^"]*">(.*?)</(?:span|div)>', body, re.S)
        val = re.search(r'class="field-value[^"]*">(.*)', body, re.S)
        h3 = re.search(r"<h3[^>]*>(.*?)</h3>", body, re.S)
        label = clean(lab.group(1)) if lab else (clean(h3.group(1)) if h3 else key)
        vraw = val.group(1) if val else body
        entry = {"label": label, "text": clean(vraw), "links": links(vraw)}
        if key in fields:  # champ répété (ex. deux blocs « Rating »)
            key = key + "-" + str(sum(1 for k in fields if k.startswith(key)) + 1)
        fields[key] = entry
    rec["fields"] = fields
    rec["groups"] = [clean(g) for g in re.findall(r'<h2 class="module field-group-title">(.*?)</h2>', t, re.S)]
    rec["rewards"] = [{"value": clean(v), "label": clean(l)} for v, l in re.findall(r'mission-reward__value">(.*?)</span>\s*<span class="mission-reward__label">(.*?)</span>', t, re.S)]
    rec["headings"] = [clean(h) for h in re.findall(r'<h3 class="indexed">(.*?)</h3>', t, re.S)]
    rec["h2"] = [clean(h) for h in re.findall(r"<h2[^>]*>(.*?)</h2>", t, re.S)][:60]
    m = re.search(r'<meta name="description" content="([^"]*)"', t); rec["metaDescription"] = H.unescape(m.group(1)) if m else None
    return rec
