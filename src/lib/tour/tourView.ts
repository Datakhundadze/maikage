// View limits for partial panoramas: no black outside the photo, ever.
//
// A partial panorama (iPhone Pano) covers only part of the sphere; everything
// else renders black. These pure helpers turn the panorama's crop data into a
// COVERAGE box (yaw/pitch extents) and keep the camera inside it:
//
//   clampToCoverage  — nearest camera position whose whole viewport is photo
//   maxVFovDeg       — widest zoom at which such a position exists at all
//
// THE CORNER RULE. A rectilinear viewport tilted up (or down) reaches further
// sideways at its top (bottom) corners than at its middle: the corners sit at
// yaw ±atan(tan(h/2) / (cos|p| − tan(v/2)·sin|p|)), which is more than h/2 for
// any pitch p ≠ 0. Clamping yaw with h/2 alone shows black wedges in the
// corners once the user looks up or down, so the yaw limit uses the corner
// extent at the clamped pitch. Pitch extremes are always at the middle of the
// top/bottom edge (p ± v/2), so pitch clamps with v/2.
//
// Units: positions in RADIANS (Photo Sphere Viewer's Position), FOVs in
// DEGREES (Photo Sphere Viewer's state.vFov / state.hFov / minFov / maxFov).

import type { PanoData } from "@photo-sphere-viewer/core";

export interface TourCoverage {
  /** signed yaw, radians, yaw 0 = centre of the full equirectangular frame */
  yawMin: number;
  yawMax: number;
  /** radians, 0 = horizon, positive up */
  pitchMin: number;
  pitchMax: number;
}

export interface TourPosition {
  yaw: number;
  pitch: number;
}

/** Kept between the viewport and the photo edge so no texture seam shows. */
export const EDGE_MARGIN = (0.5 * Math.PI) / 180;

/** Widest vertical FOV ever allowed; beyond this the perspective distorts. */
export const MAX_VFOV_CAP_DEG = 90;

const TWO_PI = 2 * Math.PI;
const EPS = 1e-6;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** Yaw in (−π, π]. Photo Sphere Viewer reports [0, 2π). */
export function signedYaw(yaw: number): number {
  const y = ((yaw % TWO_PI) + TWO_PI) % TWO_PI;
  return y > Math.PI ? y - TWO_PI : y;
}

/**
 * Coverage of a panorama from its crop data, or null when it is a full sphere
 * (nothing to clamp). Same angle mapping as Photo Sphere Viewer's own
 * visible-range plugin.
 */
export function coverageFromPanoData(p: PanoData | null | undefined): TourCoverage | null {
  if (!p || !p.fullWidth) return null;
  const fullHeight = p.fullHeight ?? p.fullWidth / 2;
  const croppedWidth = p.croppedWidth ?? p.fullWidth;
  const croppedHeight = p.croppedHeight ?? fullHeight;
  if (croppedWidth >= p.fullWidth && croppedHeight >= fullHeight) return null;
  const yawAt = (x: number) => TWO_PI * (x / p.fullWidth) - Math.PI;
  const pitchAt = (y: number) => Math.PI * (1 - y / fullHeight) - Math.PI / 2;
  return {
    yawMin: yawAt(p.croppedX),
    yawMax: yawAt(p.croppedX + croppedWidth),
    pitchMin: pitchAt(p.croppedY + croppedHeight),
    pitchMax: pitchAt(p.croppedY),
  };
}

const coversFullYaw = (c: TourCoverage) => c.yawMax - c.yawMin >= TWO_PI - EPS;
const coversFullPitch = (c: TourCoverage) => c.pitchMax - c.pitchMin >= Math.PI - EPS;

/** Half the yaw span of the viewport at pitch p (reached at its corners). */
export function cornerHalfYaw(hFov: number, vFov: number, pitch: number): number {
  const ap = Math.abs(pitch);
  const den = Math.cos(ap) - Math.tan(vFov / 2) * Math.sin(ap);
  return den > EPS ? Math.atan(Math.tan(hFov / 2) / den) : Math.PI;
}

/** Allowed pitch interval for a vertical FOV (radians), or null if none. */
function pitchInterval(c: TourCoverage, vFov: number, margin: number): [number, number] | null {
  if (coversFullPitch(c)) return [-Math.PI / 2, Math.PI / 2];
  const lo = c.pitchMin + vFov / 2 + margin;
  const hi = c.pitchMax - vFov / 2 - margin;
  return lo <= hi + EPS ? [lo, Math.max(lo, hi)] : null;
}

/**
 * Nearest position to `pos` at which the whole viewport (vFovDeg × hFovDeg)
 * lies inside the coverage. Returns yaw in [0, 2π) like Photo Sphere Viewer.
 * When the viewport is wider/taller than the coverage, centres on it instead
 * (maxVFovDeg exists to keep that from happening).
 */
export function clampToCoverage(
  pos: TourPosition,
  vFovDeg: number,
  hFovDeg: number,
  c: TourCoverage,
  margin = EDGE_MARGIN,
): TourPosition {
  const v = toRad(vFovDeg);
  const h = toRad(hFovDeg);

  const pRange = pitchInterval(c, v, margin);
  const pitch = pRange ? clamp(pos.pitch, pRange[0], pRange[1]) : (c.pitchMin + c.pitchMax) / 2;

  let yaw = signedYaw(pos.yaw);
  if (!coversFullYaw(c)) {
    const half = cornerHalfYaw(h, v, pitch);
    const lo = c.yawMin + half + margin;
    const hi = c.yawMax - half - margin;
    yaw = lo <= hi ? clamp(yaw, lo, hi) : (c.yawMin + c.yawMax) / 2;
  }
  return { yaw: ((yaw % TWO_PI) + TWO_PI) % TWO_PI, pitch };
}

/** Whether some camera position shows only photo at this vertical FOV. */
function fitsAt(c: TourCoverage, vFov: number, aspect: number, margin: number): boolean {
  const pRange = pitchInterval(c, vFov, margin);
  if (!pRange) return false;
  if (coversFullYaw(c)) return true;
  // The yaw extent grows with |pitch|, so test the allowed pitch nearest 0.
  const pitch = clamp(0, pRange[0], pRange[1]);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return 2 * (cornerHalfYaw(hFov, vFov, pitch) + margin) <= c.yawMax - c.yawMin + EPS;
}

/**
 * Widest vertical FOV (degrees) at which the viewport can still sit entirely
 * inside the coverage, for a viewport of the given aspect (width / height).
 * Capped at MAX_VFOV_CAP_DEG. Found by bisection — fitsAt is monotonic in FOV.
 */
export function maxVFovDeg(
  c: TourCoverage | null,
  aspect: number,
  margin = EDGE_MARGIN,
  capDeg = MAX_VFOV_CAP_DEG,
): number {
  const cap = toRad(capDeg);
  if (!c || fitsAt(c, cap, aspect, margin)) return capDeg;
  let lo = toRad(1);
  let hi = cap;
  if (!fitsAt(c, lo, aspect, margin)) return 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fitsAt(c, mid, aspect, margin)) lo = mid;
    else hi = mid;
  }
  return toDeg(lo);
}
