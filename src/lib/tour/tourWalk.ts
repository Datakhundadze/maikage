// Timing and small helpers for the tour's "walk" transition (TourViewer).
//
// FORWARD (ms from the tap)
//   0 ── TURN ──┤ face the ring (only if it is off-centre)
//      ├────── ZOOM ──────┤ push in on this photo by the link's walkZoom
//                         ├──── FADE ────┤ snapshot of the zoomed view fades
//                                          out over the next photo, which is
//                                          already at its default zoom
// BACK: snapshot of this photo fades out over the previous photo, which
// starts zoomed in by the same walkZoom and eases out to default zoom.
// ~1.1 s either way. With prefers-reduced-motion only the fade runs.

export const WALK = {
  turnMs: 350,
  zoomStartMs: 120,
  zoomMs: 520,
  fadeMs: 450,
  /** back: the previous photo's zoom-out runs a little longer than the fade */
  backZoomMs: 600,
  /** snapshot scale over the fade: forward keeps pushing in, back pulls out */
  fadeScaleForward: 1.06,
  fadeScaleBack: 0.95,
  /** skip the turn when the ring is already this close to centre (degrees) */
  turnThresholdDeg: 3,
  defaultWalkZoom: 1.4,
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
 * FOV (degrees) that magnifies the view by `m`: on-screen size scales with
 * 1 / tan(fov / 2), so the magnified FOV is 2·atan(tan(fov / 2) / m).
 */
export function magnifiedFovDeg(fovDeg: number, m: number): number {
  const half = (fovDeg * Math.PI) / 360;
  return (360 / Math.PI) * Math.atan(Math.tan(half) / Math.max(m, 1e-6));
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
