// Movement logic for the 360° tour, free of DOM and viewer code so it can be
// unit-tested: angles, the joystick's dead zone and turn rate, the
// one-step-per-push latch, and which link a push goes to.
//
// The stick (on-screen joystick or keys) gives x (right +) and y (forward +)
// inside the unit circle:
//   x → turning, up to maxTurnDegPerSec, eased in so it starts softly;
//   y → past ±stepAt one step to the linked node closest to the view
//       direction (forward) or to its opposite (back), if one lies within
//       ±linkConeDeg of it. Then nothing more until the stick comes back
//       below rearmBelow — one step per push.

export interface StickAxes {
  /** −1 (left) … 1 (right) */
  x: number;
  /** −1 (back) … 1 (forward) */
  y: number;
}

export const STEERING = {
  deadZone: 0.12,
  maxTurnDegPerSec: 90,
  /** Time constant of the turn-rate easing (ms). */
  turnEaseMs: 140,
  /** Forward / back deflection that triggers a step. */
  stepAt: 0.6,
  /** The stick has to come back below this before the next step. */
  rearmBelow: 0.3,
  /** A link counts as "ahead" within this many degrees of the view. */
  linkConeDeg: 50,
} as const;

export type StepIntent = "forward" | "back";

/** Angle in (−180, 180]. */
export function normDeg(a: number): number {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** Signed smallest difference a − b, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  return normDeg(a - b);
}

/** 0 inside the dead zone, then rescaled so the output still reaches ±1. */
export function applyDeadZone(v: number, deadZone: number = STEERING.deadZone): number {
  const a = Math.abs(v);
  if (a <= deadZone) return 0;
  return Math.sign(v) * Math.min(1, (a - deadZone) / (1 - deadZone));
}

/** Target turn rate (°/s, + = right) for a stick x. Gentle near the centre. */
export function turnRateFromStick(x: number, cfg: { deadZone: number; maxTurnDegPerSec: number } = STEERING): number {
  const v = applyDeadZone(x, cfg.deadZone);
  return Math.sign(v) * Math.pow(Math.abs(v), 1.6) * cfg.maxTurnDegPerSec;
}

/** Exponential approach of `current` to `target` over dt (frame-rate independent). */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number = STEERING.turnEaseMs): number {
  if (tauMs <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

export interface StepLatch {
  armed: boolean;
}

/**
 * Feed the stick's y every frame. Returns the step to take now (at most one
 * per push) and the updated latch.
 */
export function stepFromStick(
  y: number,
  latch: StepLatch,
  cfg: { stepAt: number; rearmBelow: number } = STEERING,
): { intent: StepIntent | null; latch: StepLatch } {
  if (!latch.armed) {
    return { intent: null, latch: { armed: Math.abs(y) < cfg.rearmBelow } };
  }
  if (y >= cfg.stepAt) return { intent: "forward", latch: { armed: false } };
  if (y <= -cfg.stepAt) return { intent: "back", latch: { armed: false } };
  return { intent: null, latch };
}

/**
 * The link to step to: closest to the view yaw (forward) or to its opposite
 * (back), and no further than `coneDeg` from it. null when none qualifies.
 */
export function pickLink<L extends { yawDeg: number }>(
  links: readonly L[],
  viewYawDeg: number,
  intent: StepIntent,
  coneDeg: number = STEERING.linkConeDeg,
): L | null {
  const aim = intent === "forward" ? viewYawDeg : viewYawDeg + 180;
  let best: L | null = null;
  let bestOff = Infinity;
  for (const link of links) {
    const off = Math.abs(angleDiff(link.yawDeg, aim));
    if (off <= coneDeg && off < bestOff) {
      best = link;
      bestOff = off;
    }
  }
  return best;
}

const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);
const UP = new Set(["ArrowUp", "KeyW"]);
const DOWN = new Set(["ArrowDown", "KeyS"]);
/** Keys the tour uses (KeyboardEvent.code). */
export const TOUR_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN]);

/** Held keys → the same axes the joystick reports (full deflection). */
export function keysToStick(codes: ReadonlySet<string>): StickAxes {
  const has = (set: Set<string>) => [...set].some((c) => codes.has(c));
  return {
    x: (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0),
    y: (has(UP) ? 1 : 0) - (has(DOWN) ? 1 : 0),
  };
}

/** Combine two inputs (joystick + keys): per axis, the larger deflection wins. */
export function mergeSticks(a: StickAxes, b: StickAxes): StickAxes {
  const pick = (p: number, q: number) => (Math.abs(p) >= Math.abs(q) ? p : q);
  return { x: pick(a.x, b.x), y: pick(a.y, b.y) };
}

/** World yaw → yaw inside the photo (0 = image centre), and back. */
export function worldToPhotoYaw(worldYawDeg: number, northOffsetDeg: number): number {
  return normDeg(worldYawDeg + northOffsetDeg);
}
export function photoToWorldYaw(photoYawDeg: number, northOffsetDeg: number): number {
  return normDeg(photoYawDeg - northOffsetDeg);
}

/** Rounded to one decimal (tuning snippets). */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
