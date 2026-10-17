// Movement logic for the 360° tour, free of DOM and viewer code so it can be
// unit-tested: angles, the joystick's dead zone and turn rate, which link a
// push walks to, the auto-turn before a step, and the head bob of a step.
//
// The stick (on-screen joystick or keys) gives x (right +) and y (forward +)
// inside the unit circle:
//   x → turning, up to maxTurnDegPerSec, eased in so it starts softly;
//   y → while held past ±walkAt the visitor keeps walking: each step goes to
//       the linked node closest to the view direction (forward) or to its
//       opposite (back) within ±linkConeDeg, turning toward it first if it
//       is more than autoTurnMinDeg off. A step lands facing the direction of
//       travel, so the next one simply continues along the aisle.

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
  /** Forward / back deflection that keeps the visitor walking. */
  walkAt: 0.5,
  /** A link counts as "this way" within this many degrees of the view. */
  linkConeDeg: 100,
  /** Turn toward the link first when it is further off than this. */
  autoTurnMinDeg: 10,
  /** Speed of that turn, and its shortest / longest duration. */
  autoTurnDegPerSec: 160,
  autoTurnMinMs: 150,
  autoTurnMaxMs: 600,
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

/**
 * Walking intent for the stick's y, read every frame while no step is
 * running: held forward / back past walkAt keeps producing steps.
 */
export function walkIntent(y: number, cfg: { walkAt: number } = STEERING): StepIntent | null {
  if (y >= cfg.walkAt) return "forward";
  if (y <= -cfg.walkAt) return "back";
  return null;
}

/** Duration (ms) of the turn toward a link `offDeg` away; 0 = no turn needed. */
export function autoTurnMs(
  offDeg: number,
  cfg: { autoTurnMinDeg: number; autoTurnDegPerSec: number; autoTurnMinMs: number; autoTurnMaxMs: number } = STEERING,
): number {
  const off = Math.abs(normDeg(offDeg));
  if (off <= cfg.autoTurnMinDeg) return 0;
  return Math.round(Math.min(cfg.autoTurnMaxMs, Math.max(cfg.autoTurnMinMs, (off / cfg.autoTurnDegPerSec) * 1000)));
}

/**
 * Head bob of one step, t = 0…1 over the whole step. Two footfalls (at t =
 * 0.25 and 0.75, where the head is lowest), a sway from one foot to the
 * other, faded in and out so the step starts and lands still.
 *   dyPx  — vertical offset of the picture, + = down
 *   rollDeg — tilt, + = clockwise
 *   scale — slight enlargement so the moved picture never shows an edge
 */
export function bobAt(
  t: number,
  cfg: { bobPx: number; bobRollDeg: number; bobScale: number },
): { dyPx: number; rollDeg: number; scale: number } {
  if (!(t > 0 && t < 1)) return { dyPx: 0, rollDeg: 0, scale: 1 };
  const env = Math.sin(Math.PI * t);
  const s = Math.sin(2 * Math.PI * t);
  return {
    dyPx: cfg.bobPx * s * s * env,
    rollDeg: cfg.bobRollDeg * s * env,
    scale: 1 + (cfg.bobScale - 1) * env,
  };
}

/** Footfall moments within a step (fractions of the step), lowest head points of bobAt. */
export const FOOTFALLS = [0.25, 0.75] as const;

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
