// Automatic removal of a SOLID, meaningless background (white box behind a
// logo, a one-colour frame, the flat backdrop of a screenshot) for print files.
//
// Policy (David, 2026-11-04): a solid frame / pointless background goes away
// automatically; a real photographic background is NOT touched here — the
// admin removes that by hand with the AI button, because the customer approved
// the sketch with it.
//
// Detection: the image border (2 px ring) must be opaque and ≥ 90 % of it
// within a small colour distance of one colour. Removal: flood fill from the
// border only, so the same colour INSIDE the design (white lettering inside a
// logo) is kept. Pixels near the tolerance edge get partial alpha (soft edge).
// Pure function on RGBA data — unit tested.

export interface SolidBackgroundResult {
  removed: boolean;
  /** Background colour as #rrggbb when detected. */
  color: string | null;
  /** Share of all pixels made transparent. */
  keyedFraction: number;
}

const BORDER = 2;
const AGREE_SHARE = 0.9;
const MATCH_DIST = 38; // ≤ this: part of the background
const HARD_DIST = 18; //  ≤ this: fully transparent; between → soft edge
const MIN_KEYED = 0.02;

function dist(px: Uint8ClampedArray, i: number, r: number, g: number, b: number): number {
  const dr = px[i] - r;
  const dg = px[i + 1] - g;
  const db = px[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/** Mutates `px` in place only when a solid background is found and removed. */
export function removeSolidBackground(px: Uint8ClampedArray, w: number, h: number): SolidBackgroundResult {
  const none: SolidBackgroundResult = { removed: false, color: null, keyedFraction: 0 };
  if (w < 8 || h < 8) return none;

  // 1. Collect border pixels.
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= BORDER && x < w - BORDER && y >= BORDER && y < h - BORDER) {
        x = w - BORDER - 1; // jump to the right edge
        continue;
      }
      border.push((y * w + x) * 4);
    }
  }
  // Already cut out (transparent edge) → nothing to do.
  let transparent = 0;
  for (const i of border) if (px[i + 3] < 200) transparent++;
  if (transparent / border.length > 0.1) return none;

  // 2. Dominant border colour: mode of a 4-bit quantisation, then its mean.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of border) {
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2];
    buckets.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best) return none;
  const r = best.r / best.n, g = best.g / best.n, b = best.b / best.n;

  let agree = 0;
  for (const i of border) if (dist(px, i, r, g, b) <= MATCH_DIST) agree++;
  if (agree / border.length < AGREE_SHARE) return none;

  // 3. Flood fill from every matching border pixel.
  const visited = new Uint8Array(w * h);
  const newAlpha = new Uint8Array(w * h); // per visited pixel; applied only on success
  const stack: number[] = [];
  for (const i of border) {
    const p = i >> 2;
    if (!visited[p] && dist(px, i, r, g, b) <= MATCH_DIST) { visited[p] = 1; stack.push(p); }
  }
  let keyed = 0;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const d = dist(px, i, r, g, b);
    const a = d <= HARD_DIST ? 0 : Math.round(((d - HARD_DIST) / (MATCH_DIST - HARD_DIST)) * px[i + 3]);
    newAlpha[p] = Math.min(px[i + 3], a);
    if (a === 0) keyed++;
    const x = p % w;
    const y = (p - x) / w;
    const visit = (q: number) => {
      if (!visited[q] && dist(px, q * 4, r, g, b) <= MATCH_DIST) { visited[q] = 1; stack.push(q); }
    };
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }

  const keyedFraction = keyed / (w * h);
  // A fill that keys almost nothing is not a background: leave the image as is.
  const removed = keyedFraction >= MIN_KEYED;
  if (removed) for (let p = 0; p < visited.length; p++) if (visited[p]) px[p * 4 + 3] = newAlpha[p];
  return {
    removed,
    color: `#${hex(r)}${hex(g)}${hex(b)}`,
    keyedFraction,
  };
}
