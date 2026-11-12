"""Rack photo -> the same photo WITHOUT its front garment (blurred fill), for the
photo designer, which hangs the site's own product photo there instead.

Run from the repo root:  python3 tools/showroom/make_backgrounds.py
Needs the garment masks made by make_garments.py in /tmp/garment-masks/<id>.png
(make_garments.py writes them next to the white photos; copy or regenerate).
Prints the RACK_GARMENTS boxes for src/lib/tour/siteGarment.ts.
"""
import cv2, numpy as np, json, sys, os
MASKS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/garment-masks'
out = {}
for f in sorted(os.listdir(MASKS)):
    n = f[:-4]
    img = cv2.imread(f'public/tour/racks/{n}.webp')
    m = cv2.imread(f'{MASKS}/{f}', 0)
    mk = cv2.dilate((m > 40).astype(np.uint8), np.ones((19, 19), np.uint8))
    small = cv2.resize(img, (300, 375)); ms = cv2.resize(mk, (300, 375), interpolation=cv2.INTER_NEAREST)
    fill = cv2.inpaint(small, ms * 255, 9, cv2.INPAINT_TELEA)
    fill = cv2.GaussianBlur(cv2.resize(fill, (1200, 1500), interpolation=cv2.INTER_CUBIC), (0, 0), 14)
    a = cv2.GaussianBlur(mk.astype(np.float32), (0, 0), 7)[..., None]
    cv2.imwrite(f'public/tour/garments/{n}-bg.webp', (img * (1 - a) + fill * a).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 84])
    ys, xs = np.where(m > 128)
    out[n] = dict(x=int(xs.min()), y=int(ys.min()), w=int(xs.max() - xs.min()), h=int(ys.max() - ys.min()))
print(json.dumps(out))
