"""Rendu d'une fenêtre de la carte GTADB (tuiles z5 locales, 2 px par unité) avec grille et repères."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
T = __import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'public', 'tiles', '5')
L = json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'public', 'data', 'landmarks.json')))
def px(x, y): return ((x + 16384) * 2, (16384 - y) * 2)
def crop(x0, x1, y0, y1):
    ax, ay = px(x0, y1); bx, by = px(x1, y0)
    W, H = int(bx - ax), int(by - ay)
    im = Image.new('RGB', (W, H), (40, 80, 110))
    for tx in range(int(ax // 2048), int(bx // 2048) + 1):
        for ty in range(int(ay // 2048), int(by // 2048) + 1):
            f = f'{T}/{tx}/{ty}.jpg'
            if os.path.exists(f): im.paste(Image.open(f), (int(tx * 2048 - ax), int(ty * 2048 - ay)))
    return im, ax, ay
def render(name, x0, x1, y0, y1, grid=100, pts=(), scale=1.0, labels=True):
    im, ax, ay = crop(x0, x1, y0, y1)
    d = ImageDraw.Draw(im)
    f = ImageFont.load_default()
    g = (x0 // grid) * grid
    while g <= x1:
        X = px(g, 0)[0] - ax; d.line([(X, 0), (X, im.height)], fill=(255, 0, 0), width=1); d.text((X + 2, 2), str(int(g)), fill=(0, 0, 0), font=f); g += grid
    g = (y0 // grid) * grid
    while g <= y1:
        Y = px(0, g)[1] - ay; d.line([(0, Y), (im.width, Y)], fill=(255, 0, 0), width=1); d.text((2, Y + 2), str(int(g)), fill=(0, 0, 0), font=f); g += grid
    if labels:
        for r in L:
            if x0 <= r[2] <= x1 and y0 <= r[3] <= y1:
                X, Y = px(r[2], r[3]); X -= ax; Y -= ay
                d.ellipse([X - 4, Y - 4, X + 4, Y + 4], fill=(255, 255, 0)); d.text((X + 6, Y - 6), str(r[1])[:28], fill=(0, 0, 0), font=f)
    for (x, y, lab, col) in pts:
        X, Y = px(x, y); X -= ax; Y -= ay
        d.ellipse([X - 7, Y - 7, X + 7, Y + 7], outline=col, width=3); d.text((X + 9, Y + 4), lab, fill=col, font=f)
    if scale != 1: im = im.resize((int(im.width * scale), int(im.height * scale)))
    im.save(f'/tmp/{name}.png'); return f'/tmp/{name}.png'
if __name__ == '__main__':
    a = sys.argv; print(render(a[1], *map(float, a[2:6]), grid=float(a[6]) if len(a) > 6 else 100))
