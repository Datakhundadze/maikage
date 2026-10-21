// The racks of the shop, for the rack markers in /showroom (VideoWalk +
// RackSheet). Each rack is a straight segment on the floor in the walk's own
// frame (WALK_TRACK.posM: metres, video-frame yaw), what hangs there, and
// whether it opens a set of products or the whole catalog.
//
// HOW THE RACKS WERE PLACED (2026-10-21): David numbered the racks on a top-
// down plan of the shop (made from the Scaniverse scan, 2026-10-20) and named
// them. The walk's floor path (distM + headingDeg, junction links pulled
// together) was fitted onto the scan's free floor (rotation 107°, scale 0.85,
// best overlap of the path with the floor), and the rack ends taken across.
// Checked against video frames: bearings within ~10–20°. Good enough to point
// at a rack; the "nearby" chip uses distance, which is more forgiving.

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
}

export const SHOWROOM_RACKS: readonly ShowroomRack[] = [
  { id: "nike", title: "NIKE", a: [-12.63, 3.96], b: [-10.15, 3.2], items: [{ product: "T-Shirt", brand: "NIKE" }] },
  { id: "khundadze", title: "Khundadze", a: [-9.82, 3.1], b: [-7.57, 2.41], items: [{ product: "T-Shirt", brand: "Khundadze" }] },
  {
    id: "hummer-giordano",
    title: "GILDAN HUMMER · GIORDANO",
    a: [-6.67, 2.13],
    b: [-4.53, 1.48],
    items: [
      { product: "T-Shirt", brand: "GILDAN HUMMER" },
      { product: "T-Shirt", brand: "GIORDANO" },
    ],
  },
  {
    id: "washed-oversize",
    title: "Washed · Oversize",
    a: [-3.85, 1.27],
    b: [-1.83, 0.66],
    items: [
      { product: "T-Shirt", brand: "JEL T-Shirt" },
      { product: "T-Shirt", brand: "Oversize" },
    ],
  },
  {
    id: "hoodies",
    title: "ჰუდები · Zipper · Bomber",
    a: [-8.83, 1.08],
    b: [-10.55, -4.55],
    items: [
      { product: "Hoodie", brand: "GILDAN Hoodie" },
      { product: "Hoodie", brand: "Premium Washed Hoodie" },
      { product: "Hoodie", brand: "JEL Zipper" },
      { product: "Hoodie", brand: "JEL Standard Zipper" },
      { product: "Hoodie", brand: "GILDAN Bomber" },
    ],
  },
  { id: "catalog", title: "მთელი კატალოგი", a: [-7.83, -0.46], b: [-8.83, -3.72], items: "catalog" },
  { id: "sport", title: "ფეხბურთის ფორმები", a: [-5.52, -1.17], b: [-6.38, -3.98], items: [{ product: "Sport", brand: "Sport Set" }] },
  {
    id: "gildan-polo-th-sols",
    title: "GILDAN · Polo · TH · Sol's",
    a: [-3.32, -0.61],
    b: [-4.42, -4.21],
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
