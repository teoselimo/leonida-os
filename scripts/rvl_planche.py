import sys, json, math
sys.path.insert(0, __import__('os').path.dirname(__file__))
from rvl_render import crop, px
from PIL import Image, ImageDraw, ImageFont
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def font(s, b=False):
    try: return ImageFont.truetype(FB if b else F, s)
    except: return ImageFont.load_default()
CARS = json.load(open(sys.argv[1]))
W, ROWH = 1800, 560
img = Image.new('RGB', (W, 120 + ROWH * len(CARS)), (14, 12, 22))
d = ImageDraw.Draw(img)
d.text((40, 30), "LEONIDA OS V0.16.1 · Rare Vehicle Locator : avant / après", fill=(255, 255, 255), font=font(38, True))
d.text((40, 80), "Fond : carte communautaire gtadb.org (CC BY 4.0). Rouge pointillé = zone V0.16 · Vert = position V0.16.1 (calibrée, non testée en jeu) et son incertitude.", fill=(170, 170, 190), font=font(20))
def wrap(t, n):
    out, cur = [], ''
    for w in t.split():
        if len(cur) + len(w) + 1 > n: out.append(cur); cur = w
        else: cur = (cur + ' ' + w).strip()
    if cur: out.append(cur)
    return out
for i, c in enumerate(CARS):
    y0 = 120 + i * ROWH
    d.rectangle([20, y0 + 10, W - 20, y0 + ROWH - 10], outline=(50, 45, 70), width=2)
    # deux vignettes : large (V0.16 vs V0.16.1) et zoom (V0.16.1)
    for k, (cx, cy, half) in enumerate([c['wide'], c['zoom']]):
        sub, ax, ay = crop(cx - half, cx + half, cy - half, cy + half)
        dd = ImageDraw.Draw(sub)
        def P(x, y): X, Y = px(x, y); return X - ax, Y - ay
        sc = 2  # px par unité
        if c.get('v016') and k == 0:
            x, y, r = c['v016']; X, Y = P(x, y)
            for a in range(0, 360, 8):
                a1, a2 = math.radians(a), math.radians(a + 4)
                dd.line([(X + r * sc * math.cos(a1), Y + r * sc * math.sin(a1)), (X + r * sc * math.cos(a2), Y + r * sc * math.sin(a2))], fill=(255, 60, 80), width=8)
        for line in c.get('route', []):
            dd.line([P(x, y) for x, y in line], fill=(10, 16, 25), width=22 if k else 30)
            dd.line([P(x, y) for x, y in line], fill=(60, 230, 120), width=12 if k else 18)
        if c.get('point'):
            x, y, e = c['point']; X, Y = P(x, y)
            dd.ellipse([X - e * sc, Y - e * sc, X + e * sc, Y + e * sc], outline=(60, 230, 120), width=6, fill=None)
            rr = 14 if k else 30
            dd.ellipse([X - rr, Y - rr, X + rr, Y + rr], fill=(60, 230, 120), outline=(255, 255, 255), width=5)
        sub = sub.resize((470, 470))
        img.paste(sub, (40 + k * 490, y0 + 45))
        d.text((44 + k * 490, y0 + 18), ["Vue large : V0.16 vs V0.16.1", "Zoom : position V0.16.1"][k], fill=(200, 200, 220), font=font(18))
    x0 = 1040
    d.text((x0, y0 + 24), c['name'], fill=(255, 255, 255), font=font(30, True))
    yy = y0 + 70
    for lab, val in c['rows']:
        d.text((x0, yy), lab, fill=(150, 150, 175), font=font(17, True))
        for ln in wrap(val, 62):
            d.text((x0 + 175, yy), ln, fill=(230, 230, 240), font=font(17)); yy += 24
        yy += 6
img.save(sys.argv[2], quality=88)
print(sys.argv[2], img.size)
