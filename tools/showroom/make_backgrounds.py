"""Rack photo -> the same photo WITHOUT its front garment, for the photo
designer, which hangs the site's own product photo there instead.

The hole is filled by diffusion: the known pixels blurred into it, coarse to
fine (normalised convolution) — smooth like the shop's own out-of-focus
background, no streaks — plus a little grain.

Run from the repo root:  python3 tools/showroom/make_backgrounds.py [masks dir]
Needs each rack's garment mask as <masks dir>/<rack id>.png (grey, 1200x1500;
tools/showroom/garment_mask.py makes them). Prints the boxes for
src/lib/tour/siteGarment.ts RACK_GARMENTS.
"""
import cv2, numpy as np, json, sys, os
MASKS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/garment-masks'


def background(img, m):
    mk = cv2.dilate((m > 30).astype(np.uint8), np.ones((41, 41), np.uint8))
    f = img.astype(np.float32)
    known = (1 - mk).astype(np.float32)
    acc = f * known[..., None]
    fill = None
    for sig in (220, 110, 55, 28, 14):
        den = cv2.GaussianBlur(known, (0, 0), sig)
        est = cv2.GaussianBlur(acc, (0, 0), sig) / np.maximum(den, 1e-4)[..., None]
        if fill is None:
            fill = est
        else:
            conf = np.clip(den * 2.5, 0, 1)[..., None]   # finer scales win where they have support
            fill = fill * (1 - conf) + est * conf
    fill = cv2.GaussianBlur(fill, (0, 0), 8)
    fill += np.random.default_rng(1).normal(0, 1.5, fill.shape).astype(np.float32)
    a = cv2.GaussianBlur(mk.astype(np.float32), (0, 0), 10)[..., None]
    return np.clip(f * (1 - a) + fill * a, 0, 255).astype(np.uint8)


if __name__ == '__main__':
    out = {}
    for fn in sorted(os.listdir(MASKS)):
        n = fn[:-4]
        img = cv2.imread(f'public/tour/racks/{n}.webp')
        m = cv2.imread(f'{MASKS}/{fn}', 0)
        cv2.imwrite(f'public/tour/garments/{n}-bg.webp', background(img, m), [cv2.IMWRITE_WEBP_QUALITY, 84])
        ys, xs = np.where(m > 128)
        out[n] = dict(x=int(xs.min()), y=int(ys.min()), w=int(xs.max() - xs.min()), h=int(ys.max() - ys.min()))
    print(json.dumps(out))
