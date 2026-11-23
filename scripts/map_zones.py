"""V0.19 · Index des zones cartographiques pour la reconnaissance de cartes (LEONIDA Visual Grounding).

Calcule, à partir des données GTADB embarquées (repères + tuiles z5, CC BY 4.0), des zones candidates
(aérodromes, marinas, ports) et leurs caractéristiques MESURÉES :
  - éléments voisins (≤ 1 800 unités) : aérodrome, base militaire, marina, quais/port, pont, voie express ;
  - part d'eau dans un rayon de 1 000 unités (pixels « eau » des tuiles) et dans un anneau de 2 500 (insularité).
Aucune coordonnée n'est inventée : chaque zone est centrée sur un repère GTADB existant.
Usage : python3 scripts/map_zones.py > src/data/mapZones.json
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from rvl_render import crop

L = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'landmarks.json')))

def is_air(r): return bool({'airport', 'airbase'} & set(r[5])) or any(k in r[1] for k in ('Airport', 'Airfield', 'Air Station'))
def is_marina(r): return 'marina' in r[5] or 'Marina' in r[1] or 'Boatyard' in r[1]
def is_dock(r): return not r[1].startswith(('Bus Stop', 'Tennis', 'Tunnel')) and any(k in r[1] for k in ('Docks', 'Dock ', 'Dry Dock', 'Pier', 'Container Crane', 'Ferry Terminal', 'Cruise', 'Coast Guard'))
def is_bridge(r): return r[1].startswith('Bridge') or 'Bridge' in r[1]
def is_military(r): return 'airbase' in r[5] or 'Air Station' in r[1] or 'military' in r[1].lower()
def district(r): return r[1].split(', ', 1)[1] if ', ' in r[1] else ''

def water_ratio(x, y, rad):
    sub, ax, ay = crop(x - rad, x + rad, y - rad, y + rad)
    sm = sub.convert('RGB').resize((96, 96))
    px = list(sm.getdata())
    w = sum(1 for (r, g, b) in px if b > 130 and b > r + 50)
    return round(w / len(px), 2)

# zones : un repère représentatif par lieu (premier repère nommé d'un même ensemble)
seeds, names = [], set()
# repère représentatif : d'abord ceux étiquetés « airport / airbase » (tour de contrôle plutôt qu'un hangar)
for r in sorted(L, key=lambda r: 0 if {'airport', 'airbase'} & set(r[5]) else 1):
    if r[1].startswith('?'): continue
    kind = 'aerodrome' if is_air(r) else 'marina' if is_marina(r) else 'port' if is_dock(r) else None
    if not kind: continue
    # aérodromes : un par lieu ; marinas et ports : un par quartier (évite 9 zones « grue » à Port Vice City)
    group = (r[1].split(', ')[-1] if 'Vice City International Airport' in r[1] else r[1]) if kind == 'aerodrome' else f'{kind}:{district(r)}'
    if group in names: continue
    names.add(group)
    seeds.append((kind, r, group))

zones = []
for kind, r, group in seeds:
    x, y = r[2], r[3]
    near = [o for o in L if math.hypot(o[2] - x, o[3] - y) < 1800]
    feats = sorted({f for o in near for f, ok in (('aerodrome', is_air(o)), ('militaire', is_military(o)), ('marina', is_marina(o)), ('quais', is_dock(o)), ('pont', is_bridge(o))) if ok})
    w1 = water_ratio(x, y, 1000)
    w2 = water_ratio(x, y, 2500)
    zones.append({
        'id': f'zone-{r[0]}', 'landmarkId': r[0], 'name': 'Vice City International Airport' if 'Vice City International Airport' in r[1] else r[1].split(', ')[0] if kind == 'aerodrome' else (r[1].split(', ')[0] if kind == 'marina' else f"Port · {district(r)}"),
        'district': district(r), 'kind': kind, 'x': round(x), 'y': round(y), 'features': feats,
        'water': w1, 'waterWide': w2, 'coastal': 0.12 <= w1 <= 0.85, 'island': w2 >= 0.55,
    })
print(json.dumps({'generatedFrom': 'GTADB landmarks + tuiles z5 (CC BY 4.0)', 'radius': {'features': 1800, 'water': 1000, 'island': 2500}, 'zones': zones}, ensure_ascii=False, indent=0))
