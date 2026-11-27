"""V0.17 · Prototype visuel du Garage (option A+) : 20 véhicules réels du flux LEONIDA.

Trois états de vignette, tous sans image protégée :
  1. capture du joueur (emplacement prévu, aucune fournie à ce jour) ;
  2. extrait de la carte communautaire gtadb.org (CC BY 4.0) pour les 5 véhicules à position calibrée ;
  3. carte d'identité générée (constructeur, modèle, type) pour les autres.
Aucune photo de GTA VI n'est intégrée : voir docs/V0.17.md (contraintes restantes).
Usage : python3 scripts/garage_proto.py docs/v017-garage-prototype.jpg
"""
import sys, os, hashlib, colorsys
sys.path.insert(0, os.path.dirname(__file__))
from rvl_render import crop, px
from PIL import Image, ImageDraw, ImageFont

FD = '/usr/share/fonts/opentype/inter/'
def font(s, w='Regular'):
    for f in (f'{FD}Inter-{w}.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        try: return ImageFont.truetype(f, s)
        except OSError: pass
    return ImageFont.load_default()

KIND = {'hidden': 'Caché', 'delivery': 'Commande', 'dynamic': 'En circulation', 'news': 'Annoncé'}
# (constructeur, modèle, type flux, position calibrée V0.16.1 ou None, état joueur)
CARS = [
    ('Maibatsu', "'97 Penumbra FF", 'hidden', (532, 1305), 'Trouvé'),
    ('Karin', 'Futo', 'hidden', (-7655, 4684), 'À trouver'),
    ('Annis', 'Hellion', 'hidden', (-6509, 2924), 'À trouver'),
    ('BF', 'Bandito', 'hidden', (-3570, 1709), 'À trouver'),
    ('Declasse', 'Vamos', 'hidden', (-5075, 7066), 'À trouver'),
    ('Vapid', "'55 Stanier", 'hidden', None, 'À trouver'),
    ('Vapid', "'67 Dominator", 'delivery', None, 'À trouver'),
    ('Grotti', "'95 Cheetah", 'delivery', None, 'À trouver'),
    ('Ascot', 'Paragon', 'dynamic', None, 'Conservé'),
    ('Bravado', 'Banshee', 'dynamic', None, 'À trouver'),
    ('Bravado', 'Gauntlet Hellfire', 'hidden', None, 'À trouver'),
    ('Declasse', 'Yosimite 1500', 'hidden', None, 'À trouver'),
    ('Pegassi', 'Infernus', 'hidden', None, 'À trouver'),
    ('Pegassi', 'Tempesta', 'dynamic', None, 'À trouver'),
    ('Pegassi', 'Toros', 'dynamic', None, 'À trouver'),
    ('Pegassi', 'Vitello', 'hidden', None, 'À trouver'),
    ('Pfister', 'Comet S2', 'hidden', None, 'À trouver'),
    ('Pfister', 'Growler', 'dynamic', None, 'À trouver'),
    ('Progen', 'Emerus', 'hidden', None, 'À trouver'),
    ('Western', 'Nightblade', 'hidden', None, 'À trouver'),
]
BG, CARD, LINE, INK, QUIET = (12, 10, 20), (24, 20, 36), (52, 46, 74), (245, 243, 250), (160, 155, 180)
PINK, TEAL, AMBER = (255, 92, 170), (70, 220, 200), (255, 196, 80)
TW, TH, VH, GAP, COLS = 300, 300, 190, 22, 5

def hue(name):
    h = int(hashlib.md5(name.encode()).hexdigest()[:4], 16) / 65535
    return tuple(int(c * 255) for c in colorsys.hsv_to_rgb(h, .55, .55)), tuple(int(c * 255) for c in colorsys.hsv_to_rgb((h + .08) % 1, .7, .25))

def generated(maker, model):
    a, b = hue(maker)
    im = Image.new('RGB', (TW, VH), b)
    d = ImageDraw.Draw(im)
    for i in range(VH):  # dégradé diagonal discret
        t = i / VH
        d.line([(0, i), (TW, i)], fill=tuple(int(a[k] * (1 - t) + b[k] * t) for k in range(3)))
    d.text((18, 14), maker.upper(), fill=(255, 255, 255, 200), font=font(15, 'SemiBold'))
    d.text((TW - 18, VH - 8), maker[0], fill=tuple(min(255, c + 40) for c in a), font=font(140, 'Bold'), anchor='rd')
    d.text((18, VH - 40), 'Visuel généré', fill=(230, 230, 240), font=font(13))
    d.text((18, VH - 22), '+ ajoute ta capture', fill=(255, 255, 255), font=font(13, 'SemiBold'))
    return im

def mapthumb(x, y):
    half = 180
    sub, ax, ay = crop(x - half, x + half, y - half, y + half)
    X, Y = px(x, y)
    d = ImageDraw.Draw(sub)
    d.ellipse([X - ax - 26, Y - ay - 26, X - ax + 26, Y - ay + 26], outline=(10, 10, 10), width=14)
    d.ellipse([X - ax - 26, Y - ay - 26, X - ax + 26, Y - ay + 26], outline=TEAL, width=8)
    s = sub.resize((TW, TW * sub.height // sub.width))
    top = (s.height - VH) // 2
    s = s.crop((0, top, TW, top + VH))
    d = ImageDraw.Draw(s)
    d.rectangle([0, VH - 24, TW, VH], fill=(0, 0, 0))
    d.text((10, VH - 19), 'Carte gtadb.org · CC BY 4.0', fill=(220, 220, 230), font=font(12))
    return s

def main(out):
    rows = (len(CARS) + COLS - 1) // COLS
    W = COLS * TW + (COLS + 1) * GAP
    H = 150 + rows * (TH + GAP) + 90
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((GAP, 26), 'Garage A+ · prototype de galerie, 20 véhicules réels du flux LEONIDA', fill=INK, font=font(30, 'Bold'))
    d.text((GAP, 70), 'Aucune photo de GTA VI intégrée : 5 vignettes « carte calibrée » (gtadb.org, CC BY 4.0), 15 cartes d’identité générées.', fill=QUIET, font=font(17))
    d.text((GAP, 96), 'Une capture du joueur remplacera chaque visuel ; une photo officielle Rockstar seulement si le kit média est fourni.', fill=QUIET, font=font(17))
    for i, (maker, model, kind, pos, state) in enumerate(CARS):
        cx, cy = GAP + (i % COLS) * (TW + GAP), 150 + (i // COLS) * (TH + GAP)
        d.rounded_rectangle([cx, cy, cx + TW, cy + TH], 16, fill=CARD, outline=LINE, width=2)
        vis = mapthumb(*pos) if pos else generated(maker, model)
        mask = Image.new('L', (TW, VH), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, TW, VH + 20], 16, fill=255)
        img.paste(vis, (cx, cy), mask)
        d.text((cx + 14, cy + VH + 12), maker, fill=QUIET, font=font(14))
        d.text((cx + 14, cy + VH + 30), model, fill=INK, font=font(21, 'SemiBold'))
        k = KIND[kind] + (' · position calibrée' if pos else '')
        d.text((cx + 14, cy + VH + 64), k, fill=TEAL if pos else QUIET, font=font(13))
        col = {'Trouvé': PINK, 'Conservé': AMBER}.get(state, LINE)
        tw = d.textlength(state, font=font(13, 'SemiBold'))
        d.rounded_rectangle([cx + TW - tw - 34, cy + VH + 60, cx + TW - 12, cy + VH + 84], 12, fill=col if state != 'À trouver' else None, outline=col, width=2)
        d.text((cx + TW - tw - 23, cy + VH + 64), state, fill=(20, 14, 30) if state != 'À trouver' else QUIET, font=font(13, 'SemiBold'))
    y = H - 70
    d.text((GAP, y), 'Prototype statique (non intégré à l’app V0.17). États « Trouvé » et « Conservé » fictifs pour montrer les pastilles. Sur iPhone : 2 colonnes ; iPad : 4 à 5.', fill=QUIET, font=font(15))
    img.save(out, quality=88)
    print(out, img.size)

if __name__ == '__main__':
    main(sys.argv[1])
