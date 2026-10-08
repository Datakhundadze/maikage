// Timing and small helpers for the tour's "walk" transition (TourViewer).
//
// TIMELINE (ms from the click)
//   0 ──── ROTATE ────┤ turn toward the floor ring (eyes level, clamped)
//        ├──────── ZOOM ────────┤ push forward (FOV shrinks)
//                   ├──── FADE ────┤ cross-fade to the next photo
//                                  ├─ SETTLE ─┤ new photo eases to default zoom
// Total ≈ 1.1 s. With prefers-reduced-motion only the fade runs.

export const WALK = {
  rotateMs: 380,
  zoomStartMs: 180,
  zoomMs: 500,
  /** the fade starts as the turn ends, overlapping the second half of the zoom */
  fadeMs: 450,
  settleMs: 250,
  /** forward push: the FOV shrinks to this fraction (never below minFov) */
  zoomFactor: 0.62,
} as const;

/** Smooth start and end; t in [0, 1]. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Progress of a phase that starts at `startMs` and lasts `durationMs`. */
export function phase(elapsedMs: number, startMs: number, durationMs: number): number {
  if (durationMs <= 0) return elapsedMs >= startMs ? 1 : 0;
  return Math.min(Math.max((elapsedMs - startMs) / durationMs, 0), 1);
}

/** Yaw interpolation along the shorter way round (radians). */
export function lerpYaw(from: number, to: number, k: number): number {
  const TWO_PI = 2 * Math.PI;
  let d = (((to - from) % TWO_PI) + TWO_PI) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  return from + d * k;
}

/**
 * Vertical squash of a ring lying on the floor, seen from eye height while
 * looking at it `pitchDeg` below the horizon: a flat circle viewed at angle θ
 * projects to an ellipse with height/width = sin θ. Clamped so a ring near
 * the horizon is still visible and one underfoot still looks like a ring.
 */
export function floorRingSquash(pitchDeg: number): number {
  return Math.min(Math.max(Math.sin((Math.abs(pitchDeg) * Math.PI) / 180), 0.28), 0.8);
}
