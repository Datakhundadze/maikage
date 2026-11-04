// Physical print size for the admin "საბეჭდი პაკეტი".
//
// The shop's rule (David, 2026-11-04): a design that fills the whole placement
// zone on the site is printed ~A3, 28 cm wide, height proportional; one that
// looks ~A4 gets ~25 cm; a chest logo is ~8–9 cm. The site's zone is the same
// "full print" frame on every garment (T-shirt 0.35 of the canvas, hoodie
// 0.28), so the size is read from the design's extent RELATIVE TO THE ZONE.
//
// The curve is piecewise-linear through those anchors, not one straight line:
// the shop prints mid-size designs larger than a linear 28·f would (an
// A4-looking design at ~0.7 of the zone is 25 cm, not 19.6). A design that
// fills the zone prints at A3: 28 cm wide, or — when it is portrait — up to
// 40 cm tall. Width is capped at 28 cm and height at 40 cm (max print is A3).
//
// Non-garment products (cap, mug, phone case) have no such rule — they return
// null and the caller keeps the file at its rendered resolution.

export const MAX_WIDTH_CM = 28;
export const MAX_HEIGHT_CM = 40;
export const PRINT_DPI = 300;

/** Products where the zone → centimetre rule applies. */
const GARMENT_PRODUCTS = new Set(["T-Shirt", "Hoodie", "Tote Bag", "Apron", "Sport"]);

export function hasPhysicalSizeRule(product: string | null | undefined): boolean {
  return !!product && GARMENT_PRODUCTS.has(product);
}

/** [fraction of the zone, centimetres] for the design's WIDTH (landscape / square). */
const WIDTH_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.3, 8.5],
  [0.7, 25],
  [1, MAX_WIDTH_CM],
];
/** Same for a PORTRAIT design's height: a full-zone portrait print uses the
 *  whole A3 height (40 cm), not a 28 cm square. */
const HEIGHT_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.3, 8.5],
  [0.7, 25],
  [1, MAX_HEIGHT_CM],
];

function curve(anchors: ReadonlyArray<readonly [number, number]>, f: number): number {
  const last = anchors[anchors.length - 1];
  if (f >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [f1, c1] = anchors[i];
    if (f <= f1) {
      const [f0, c0] = anchors[i - 1];
      return c0 + ((f - f0) / (f1 - f0)) * (c1 - c0);
    }
  }
  return last[1];
}

const round05 = (v: number) => Math.round(v * 2) / 2;

export interface PhysicalSize {
  widthCm: number;
  heightCm: number;
  /** Pixel size of the PNG at PRINT_DPI. */
  widthPx: number;
  heightPx: number;
}

/**
 * @param fw design width as a fraction of the zone width
 * @param fh design height as a fraction of the zone height (zones are square)
 */
export function physicalSizeFromZoneFraction(fw: number, fh: number): PhysicalSize | null {
  if (!(fw > 0) || !(fh > 0) || !Number.isFinite(fw) || !Number.isFinite(fh)) return null;
  // The longer side drives the size; portrait designs follow the A3 height curve.
  const portrait = fh > fw;
  const f = portrait ? fh : fw;
  const cmPerZone = curve(portrait ? HEIGHT_ANCHORS : WIDTH_ANCHORS, f) / f;
  let w = fw * cmPerZone;
  let h = fh * cmPerZone;
  if (w > MAX_WIDTH_CM) { h *= MAX_WIDTH_CM / w; w = MAX_WIDTH_CM; }
  if (h > MAX_HEIGHT_CM) { w *= MAX_HEIGHT_CM / h; h = MAX_HEIGHT_CM; }
  const widthCm = Math.max(0.5, round05(w));
  const heightCm = Math.max(0.5, round05(h));
  return {
    widthCm,
    heightCm,
    widthPx: Math.round((w / 2.54) * PRINT_DPI),
    heightPx: Math.round((h / 2.54) * PRINT_DPI),
  };
}
