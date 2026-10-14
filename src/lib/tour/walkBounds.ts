// Keeping the walker inside the walkable area (floor plane, metres).
//
// The walkable area is either one polygon, or a WalkArea: an outer polygon
// with holes cut out of it (the racks). Holes may overlap each other; a point
// is walkable when it is inside the outer polygon and inside no hole.
//
// clampStep(from, to, area) is called once per frame with the current
// position and the position the motion would like to reach. If `to` is
// walkable, it is returned unchanged. Otherwise the walker SLIDES: `to` is
// projected onto the nearest boundary edge (which drops the part of the step
// that points into the wall or rack and keeps the part along it), nudged a
// hair back toward `from`. If that lands somewhere blocked (a concave corner,
// two overlapping racks), the step is tried along x alone and along z alone;
// if nothing works the walker simply stays at `from`.
// Polygons may be concave; each must be simple (no self-intersections).

export type Vec2 = [number, number];

/** An outer polygon minus holes (obstacles). */
export interface WalkArea {
  outer: ReadonlyArray<Vec2>;
  holes: ReadonlyArray<ReadonlyArray<Vec2>>;
}

/** A plain polygon, or a polygon with holes. */
export type Walkable = ReadonlyArray<Vec2> | WalkArea;

function toArea(w: Walkable): WalkArea {
  return Array.isArray(w) ? { outer: w as ReadonlyArray<Vec2>, holes: [] } : (w as WalkArea);
}

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

/** Inside the outer polygon and outside every hole. */
export function pointInArea(p: Vec2, walkable: Walkable): boolean {
  const area = toArea(walkable);
  return pointInPolygon(p, area.outer) && !area.holes.some((h) => pointInPolygon(p, h));
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

/** Closest point to `p` on any boundary edge (outer or hole), and its distance. */
export function closestOnArea(p: Vec2, walkable: Walkable): { point: Vec2; distance: number } {
  const area = toArea(walkable);
  let best = closestOnPolygon(p, area.outer);
  for (const h of area.holes) {
    const c = closestOnPolygon(p, h);
    if (c.distance < best.distance) best = c;
  }
  return best;
}

/** How far the slid point is pulled back inside, metres. */
const INSET = 0.002;

/**
 * Where the walker ends up when it tries to move from `from` to `to`.
 * `from` is assumed walkable; the result always is (or equals `from`).
 */
export function clampStep(from: Vec2, to: Vec2, walkable: Walkable): Vec2 {
  if (pointInArea(to, walkable)) return to;
  const reach = Math.hypot(to[0] - from[0], to[1] - from[1]) + 0.01;
  const { point } = closestOnArea(to, walkable);
  // Nudge from the edge toward where we came from, so the result is inside.
  const dx = from[0] - point[0];
  const dz = from[1] - point[1];
  const len = Math.hypot(dx, dz);
  const slid: Vec2 = len > 1e-9 ? [point[0] + (dx / len) * INSET, point[1] + (dz / len) * INSET] : point;
  // never jump further than the step itself (e.g. onto the far side of a rack)
  if (len <= reach && pointInArea(slid, walkable)) return slid;
  // concave corner or overlapping obstacles: keep whichever axis still works
  const alongX: Vec2 = [to[0], from[1]];
  const alongZ: Vec2 = [from[0], to[1]];
  const okX = pointInArea(alongX, walkable);
  const okZ = pointInArea(alongZ, walkable);
  if (okX && okZ) return Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? alongX : alongZ;
  if (okX) return alongX;
  if (okZ) return alongZ;
  return from;
}

/** A start point that is not walkable is moved to the nearest walkable point (5 cm search grid). */
export function ensureInside(p: Vec2, walkable: Walkable): Vec2 {
  if (pointInArea(p, walkable)) return p;
  const step = 0.05;
  for (let ring = 1; ring <= 200; ring++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const q: Vec2 = [p[0] + i * step, p[1] + j * step];
        const d = Math.hypot(i, j);
        if (d < bestD && pointInArea(q, walkable)) {
          best = q;
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return toArea(walkable).outer[0];
}
