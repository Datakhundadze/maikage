"""Rack photo -> white garment photo + mask + print area / box (see garmentPhoto.ts GARMENTS).

Run from the repo root:  python3 tools/showroom/make_garments.py [rack-id ...]
Writes public/tour/garments/<id>-front.webp and -front-mask.png, prints the
area / box numbers for garmentPhoto.ts and a check sheet to /tmp/garments.jpg.
"""
import cv2, numpy as np, sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from garment_mask import mask_for, shade_for

# rack id: (search rect, sure-garment box, lowest row of the garment, kind)   — px in the 1200x1500 photo
CFG = {
    'giordano': ((120, 330, 1080, 1480), (420, 620, 780, 1200), 1388, 'tee'),
    'washed-tee': ((130, 300, 1090, 1480), (420, 620, 780, 1200), 1490, 'tee'),
    'gildan-hoodie': ((120, 180, 1090, 1500), (430, 520, 770, 900), 1356, 'hoodie'),
    'gildan': ((60, 300, 1090, 1400), (380, 520, 760, 1150), 1415, 'tee'),
    'gildan-kids': ((150, 480, 1010, 1290), (430, 640, 750, 1150), 1362, 'tee'),
    'hummer': ((90, 380, 1060, 1420), (400, 560, 780, 1250), 1466, 'tee'),
    'polo': ((60, 320, 1080, 1420), (380, 600, 760, 1250), 1430, 'polo'),
    'sols': ((110, 270, 1030, 1380), (400, 500, 760, 1200), 1400, 'tee'),
    'th': ((70, 360, 1140, 1440), (400, 560, 780, 1250), 1440, 'tee'),
    'washed-hoodie': ((170, 200, 980, 1240), (430, 480, 740, 1000), 1215, 'hoodie'),
    'bomber': ((90, 250, 1030, 1500), (380, 500, 760, 1150), 1445, 'tee'),
    'jel-zipper': ((250, 380, 1000, 1340), (440, 560, 760, 1150), 1500, 'zip'),
    'jel-standard-zipper': ((200, 370, 960, 1320), (400, 560, 700, 1100), 1310, 'zip'),
    'khundadze': ((240, 200, 940, 1040), (430, 360, 720, 880), 1018, 'tee'),
    'nike': ((160, 220, 880, 1040), (350, 420, 640, 900), 1010, 'tee'),
}
# print area inside the garment's bounds: x, y, w, h as fractions
AREA = {'tee': (0.2835, 0.181, 0.443, 0.4726), 'hoodie': (0.30, 0.30, 0.40, 0.27), 'polo': (0.29, 0.30, 0.42, 0.40), 'zip': (0.555, 0.30, 0.25, 0.20)}

out = {}; tiles = []
ids = sys.argv[1:] or list(CFG)
for n in ids:
    rect, fgr, ymax, kind = CFG[n]
    img = cv2.imread(f'public/tour/racks/{n}.webp')
    m = mask_for(img, rect, fgr); m[ymax:, :] = 0
    s, dark = shade_for(img, m)
    # a few px wider and soft: the dark edge of the photographed cloth must not ring the new colour
    m2 = cv2.GaussianBlur(cv2.dilate(m, np.ones((7, 7), np.uint8)), (0, 0), 1.6); m2[ymax + 4:, :] = 0
    a = (m2.astype(np.float32) / 255)[..., None]
    white = np.array((243, 245, 245), np.float32)[None, None, :] * np.clip(s, 0, 1.04)[..., None]
    wimg = np.clip(img * (1 - a) + white * a, 0, 255).astype(np.uint8)
    cv2.imwrite(f'public/tour/garments/{n}-front.webp', wimg, [cv2.IMWRITE_WEBP_QUALITY, 88])
    cv2.imwrite(f'public/tour/garments/{n}-front-mask.png', m2)
    ys, xs = np.where(m > 128); x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    pad = 14; bx = max(0, x0 - pad); by = max(0, y0 - pad); bw = min(1200, x1 + pad) - bx; bh = min(1500, y1 + pad) - by
    ax, ay, aw, ah = AREA[kind]; w = x1 - x0; h = y1 - y0
    area = dict(x=round(x0 + ax * w), y=round(y0 + ay * h), w=round(aw * w), h=round(ah * h))
    out[n] = dict(box=dict(x=bx, y=by, w=bw, h=bh), area=area, dark=bool(dark))
    t = wimg.copy()
    cv2.rectangle(t, (area['x'], area['y']), (area['x'] + area['w'], area['y'] + area['h']), (0, 0, 255), 4)
    cv2.rectangle(t, (bx, by), (bx + bw, by + bh), (0, 200, 0), 3)
    red = np.clip(img * (1 - a) + np.array((40, 30, 200), np.float32)[None, None, :] * s[..., None] * a, 0, 255).astype(np.uint8)
    tiles.append(np.hstack([cv2.resize(t, (300, 375)), cv2.resize(red, (300, 375))]))
print(json.dumps(out))
rows = [np.hstack(tiles[i:i + 4] + [np.zeros_like(tiles[0])] * (4 - len(tiles[i:i + 4]))) for i in range(0, len(tiles), 4)]
cv2.imwrite('/tmp/garments.jpg', np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 86])
