// Keeping the walker inside the walkable polygon (floor plane, metres).
//
// clampStep(from, to, polygon) is called once per frame with the current
// position and the position the motion would like to reach. If `to` is inside,
// it is returned unchanged. Otherwise the walker SLIDES: `to` is projected onto
// the nearest polygon edge (which drops the part of the step that points into
// the wall and keeps the part along it), nudged a hair back inside. If that
// still fails (a sharp concave corner), the walker simply stays at `from`.
// The polygon may be concave; it must be simple (no self-intersections).

export type Vec2 = [number, number];

/** Even–odd ray test. Points exactly on an edge may go either way. */
export function pointInPolygon(p: Vec2, poly: ReadonlyArray<Vec2>): boolean {
  const [x, z] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point to `p` on the segment a–b. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2)) : 0;
  return [a[0] + t * dx, a[1] + t * dz];
}

/** Closest point to `p` on the polygon's outline, and its distance. */
export function closestOnPolygon(p: Vec2, poly: ReadonlyArray<Vec2>): { point: Vec2; distance: number } {
  let best: Vec2 = poly[0];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return { point: best, distance: bestD };
}

/** How far the slid point is pulled back inside, metres. */
const INSET = 0.002;

/**
 * Where the walker ends up when it tries to move from `from` to `to`.
 * `from` is assumed inside; the result always is (or equals `from`).
 */
export function clampStep(from: Vec2, to: Vec2, poly: ReadonlyArray<Vec2>): Vec2 {
  if (pointInPolygon(to, poly)) return to;
  const { point } = closestOnPolygon(to, poly);
  // Nudge from the edge toward where we came from, so the result is inside.
  const dx = from[0] - point[0];
  const dz = from[1] - point[1];
  const len = Math.hypot(dx, dz);
  const slid: Vec2 = len > 1e-9 ? [point[0] + (dx / len) * INSET, point[1] + (dz / len) * INSET] : point;
  return pointInPolygon(slid, poly) ? slid : from;
}

/** A start point that is outside the polygon is moved to the nearest inside point. */
export function ensureInside(p: Vec2, poly: ReadonlyArray<Vec2>): Vec2 {
  if (pointInPolygon(p, poly)) return p;
  // walk toward the polygon's vertex centroid until inside
  const c: Vec2 = [
    poly.reduce((s, v) => s + v[0], 0) / poly.length,
    poly.reduce((s, v) => s + v[1], 0) / poly.length,
  ];
  const { point } = closestOnPolygon(p, poly);
  for (let k = 1; k <= 50; k++) {
    const t = k * 0.01;
    const q: Vec2 = [point[0] + (c[0] - point[0]) * t, point[1] + (c[1] - point[1]) * t];
    if (pointInPolygon(q, poly)) return q;
  }
  return poly[0];
}
