// The racks of the shop, for the rack markers in /showroom (VideoWalk +
// RackSheet). Each rack is a straight segment on the floor in the walk's own
// frame (WALK_TRACK.posM: metres, video-frame yaw), what hangs there, and
// whether it opens a set of products or the whole catalog.
//
// HOW THE RACKS WERE PLACED (2026-10-21, moved onto the new walk 2026-11-04):
// David numbered the racks on a top-down plan of the shop (made from the
// Scaniverse scan, 2026-10-20) and named them. Each walk's floor path
// (posM) was fitted onto the scan's free floor (best overlap of the path
// with the floor; for the 2026-11-03 take: rotation 85°, 1.36 m per camera
// height of floor flow), and the rack ends taken across from the scan.
// Checked against video frames (the yellow catalog rack, the polo rack).
// Good enough to point at a rack; the "nearby" chip uses distance, which is
// more forgiving.

import type { ProductType } from "@/lib/catalog";
import { WALK_TRACK, type WalkTrack } from "./walkTrack";

export interface RackItem {
  product: ProductType;
  /** Exact SUB_PRODUCTS string (catalog.ts). */
  brand: string;
}

export interface ShowroomRack {
  id: string;
  /** Short label shown on the marker and the sheet. */
  title: string;
  /** Rack ends on the floor (walk frame, m). */
  a: readonly [number, number];
  b: readonly [number, number];
  /** What hangs there; "catalog" = the yellow rack: the whole design catalog. */
  items: readonly RackItem[] | "catalog";
  /**
   * Where the walk stops for this rack (forward time on the walk) and where
   * the view then looks (video-frame yaw): tapping the rack's button walks
   * there by itself (autoWalk.ts). Picked on the video frames.
   */
  stop?: { t: number; yawDeg: number };
}

export const SHOWROOM_RACKS: readonly ShowroomRack[] = [
  { id: "nike", title: "NIKE", a: [-10.75, 0.37], b: [-8.55, 0.56], items: [{ product: "T-Shirt", brand: "NIKE" }] },
  { id: "khundadze", title: "Khundadze", a: [-8.26, 0.59], b: [-6.27, 0.76], items: [{ product: "T-Shirt", brand: "Khundadze" }] },
  {
    id: "hummer-giordano",
    title: "GILDAN HUMMER · GIORDANO",
    a: [-5.47, 0.82],
    b: [-3.58, 0.99],
    items: [
      { product: "T-Shirt", brand: "GILDAN HUMMER" },
      { product: "T-Shirt", brand: "GIORDANO" },
    ],
  },
  {
    id: "washed-oversize",
    title: "Washed · Oversize",
    a: [-2.97, 1.04],
    b: [-1.19, 1.21],
    items: [
      { product: "T-Shirt", brand: "JEL T-Shirt" },
      { product: "T-Shirt", brand: "Oversize" },
    ],
  },
  {
    id: "hoodies",
    title: "ჰუდები · Zipper · Bomber",
    a: [-6.84, -0.69],
    b: [-6.4, -5.68],
    items: [
      { product: "Hoodie", brand: "GILDAN Hoodie" },
      { product: "Hoodie", brand: "Premium Washed Hoodie" },
      { product: "Hoodie", brand: "JEL Zipper" },
      { product: "Hoodie", brand: "JEL Standard Zipper" },
      { product: "Hoodie", brand: "GILDAN Bomber" },
    ],
  },
  { id: "catalog", title: "მთელი კატალოგი", a: [-5.56, -1.59], b: [-5.31, -4.47], items: "catalog" },
  { id: "sport", title: "ფეხბურთის ფორმები", a: [-3.51, -1.41], b: [-3.3, -3.9], items: [{ product: "Sport", brand: "Sport Set" }] },
  {
    id: "gildan-polo-th-sols",
    title: "GILDAN · Polo · TH · Sol's",
    a: [-1.96, -0.27],
    b: [-1.68, -3.46],
    items: [
      { product: "T-Shirt", brand: "GILDAN" },
      { product: "T-Shirt", brand: "Polo" },
      { product: "T-Shirt", brand: "TH" },
      { product: "T-Shirt", brand: "Sol's" },
    ],
  },
];

/** Camera floor position at forward time t (walk frame), or null without posM. */
export function positionAt(t: number, track: WalkTrack = WALK_TRACK): { x: number; z: number } | null {
  const p = track.posM;
  if (!p || p.length < 4) return null;
  const n = p.length / 2;
  const f = Math.max(0, Math.min(n - 1, t / track.stepSec));
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  return { x: p[2 * i] + (p[2 * i + 2] - p[2 * i]) * k, z: p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * k };
}

/** Nearest point of the rack to `p`, kept off the very ends (markers sit on the rack, not past it). */
export function nearestOnRack(p: { x: number; z: number }, r: ShowroomRack): { x: number; z: number; dist: number } {
  const ax = r.a[0];
  const az = r.a[1];
  const dx = r.b[0] - ax;
  const dz = r.b[1] - az;
  const len2 = dx * dx + dz * dz || 1;
  const u = Math.max(0.15, Math.min(0.85, ((p.x - ax) * dx + (p.z - az) * dz) / len2));
  const x = ax + dx * u;
  const z = az + dz * u;
  return { x, z, dist: Math.hypot(x - p.x, z - p.z) };
}

/** Yaw (video frame, 0 = toward −z, + = right) from p toward q. */
export function bearingDeg(p: { x: number; z: number }, q: { x: number; z: number }): number {
  return (Math.atan2(q.x - p.x, -(q.z - p.z)) * 180) / Math.PI;
}

/** The rack closest to p within maxM (distance to the rack), else null. */
export function nearestRack(p: { x: number; z: number }, maxM: number, racks: readonly ShowroomRack[] = SHOWROOM_RACKS): ShowroomRack | null {
  let best: ShowroomRack | null = null;
  let bestD = maxM;
  for (const r of racks) {
    const d = nearestOnRack(p, r).dist;
    if (d <= bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
