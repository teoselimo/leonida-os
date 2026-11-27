"""Accès réseau du Data Hub : cache disque, reprise, politesse (1 requête/1,2 s), journal des échecs.
Aucune page n'est jamais « reconstituée » : une page non lue reste signalée en échec."""
from pathlib import Path
from datetime import datetime, timezone
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

NO_LASTMOD_TTL = 7 * 24 * 3600


def cache_state(path, prev, lastmod):
    if not os.path.isfile(path):
        return "missing"
    if prev.get("lastError"):
        return "expired"
    if lastmod:
        return "fresh" if prev.get("lastmod") == lastmod else "expired"
    try:
        stamp = datetime.fromisoformat(prev["fetchedAt"])
        if stamp.tzinfo is not None:
            age = (datetime.now(timezone.utc) - stamp).total_seconds()
            if 0 <= age < NO_LASTMOD_TTL:
                return "fresh"
    except (KeyError, TypeError, ValueError):
        pass
    return "expired"


def fetch_cached(source, url, lastmod=None, force=False, offline=False, st=None):
    """Lit le cache si la page n'a pas changé (lastmod du sitemap identique), sinon télécharge.
    Retourne (html|None, info). info.status ∈ cached | fetched | failed | offline-miss."""
    st = st if st is not None else load_state(source)
    p = cache_path(source, url)
    prev = st.get(url, {})
    state = cache_state(p, prev, lastmod)
    if state == "fresh" and (offline or not force):
        return Path(p).read_text(encoding="utf-8"), {**prev, "status": "cached", "cacheState": state}
    if offline:
        if os.path.exists(p):
            return Path(p).read_text(encoding="utf-8"), {**prev, "status": "cached-stale", "cacheState": state}
        return None, {"status": "offline-miss", "cacheState": state}
    code, body, err = get(url)
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    if body is None:
        st[url] = {**prev, "lastError": err, "lastTry": now, "code": code}
        return (Path(p).read_text(encoding="utf-8") if os.path.exists(p) else None), {"status": "failed", "cacheState": state, "error": err, "code": code}
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "w", encoding="utf-8") as stream:
        stream.write(body)
    os.replace(p + ".tmp", p)
    st[url] = {"lastmod": lastmod, "fetchedAt": now, "code": code, "sha": hashlib.sha1(body.encode()).hexdigest()[:12]}
    return body, {"status": "fetched", "cacheState": state, **st[url]}
