"""Accès réseau du Data Hub : cache disque, reprise, politesse (1 requête/1,2 s), journal des échecs.
Aucune page n'est jamais « reconstituée » : une page non lue reste signalée en échec."""
import hashlib, json, os, subprocess, time

UA = "Mozilla/5.0 (compatible; LEONIDA-OS-DataHub/0.20; usage personnel, cache local)"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
STATE = os.path.join(HERE, "state")

def _key(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]

def cache_path(source, url):
    return os.path.join(CACHE, source, _key(url) + ".html")

def load_state(source):
    p = os.path.join(STATE, f"{source}-fetch.json")
    try:
        return json.load(open(p))
    except Exception:
        return {}

def save_state(source, st):
    os.makedirs(STATE, exist_ok=True)
    p = os.path.join(STATE, f"{source}-fetch.json")
    tmp = p + ".tmp"
    json.dump(st, open(tmp, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    os.replace(tmp, p)

_last = [0.0]
def get(url, delay=0.6, timeout=45, retries=2):
    """Retourne (status, texte|None, erreur|None). Jamais d'exception."""
    for attempt in range(retries + 1):
        wait = delay - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        # curl : connexions bien plus rapides via le proxy de l'environnement que urllib (mesuré : 0,4 s contre 4 s)
        r = subprocess.run(["curl", "-sS", "-L", "--compressed", "-m", str(timeout), "-A", UA, "-H", "Accept-Language: en-GB,en;q=0.8",
                            "-w", "\n__HTTP_CODE__%{http_code}", url], capture_output=True)
        out = r.stdout.decode("utf-8", "replace")
        code = int(out.rsplit("__HTTP_CODE__", 1)[1]) if "__HTTP_CODE__" in out else 0
        body = out.rsplit("\n__HTTP_CODE__", 1)[0]
        if r.returncode == 0 and 200 <= code < 300:
            return code, body, None
        if code in (403, 404, 410):
            return code, None, f"HTTP {code}"
        err = f"HTTP {code}" if code else ("curl " + r.stderr.decode()[:120].strip())
        time.sleep(3 * (attempt + 1))
    return 0, None, err

def fetch_cached(source, url, lastmod=None, force=False, offline=False, st=None):
    """Lit le cache si la page n'a pas changé (lastmod du sitemap identique), sinon télécharge.
    Retourne (html|None, info). info.status ∈ cached | fetched | failed | offline-miss."""
    st = st if st is not None else load_state(source)
    p = cache_path(source, url)
    prev = st.get(url, {})
    fresh = os.path.exists(p) and (lastmod is None or prev.get("lastmod") == lastmod)
    if fresh and not force:
        return open(p, encoding="utf-8").read(), {"status": "cached", **prev}
    if offline:
        if os.path.exists(p):
            return open(p, encoding="utf-8").read(), {"status": "cached-stale", **prev}
        return None, {"status": "offline-miss"}
    code, body, err = get(url)
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    if body is None:
        st[url] = {**prev, "lastError": err, "lastTry": now, "code": code}
        return (open(p, encoding="utf-8").read() if os.path.exists(p) else None), {"status": "failed", "error": err, "code": code}
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(body)
    st[url] = {"lastmod": lastmod, "fetchedAt": now, "code": code, "sha": hashlib.sha1(body.encode()).hexdigest()[:12]}
    return body, {"status": "fetched", **st[url]}
