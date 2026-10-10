// First-person walking: input → velocity on the floor plane and turn rate,
// each with ease-in/out.
//
// Input is in the walker's own frame: forward (−1…1), strafe (−1 left … 1
// right) and turn (−1 left … 1 right). The on-screen joystick steers like a
// car ("follow" steering): its Y axis walks forward/back along the heading,
// its X axis turns, and it never strafes. The keyboard walks with W/S and
// ↑/↓, turns with A/D and ←/→, and strafes with Q/E.
//
// The forward/strafe vector is capped at length 1, so diagonals are not
// faster. Velocity and turn rate ease toward their targets with time
// constants so starting and stopping are not abrupt, and frame-time spikes
// cannot launch the walker (dt is capped).

import type { Vec2 } from "@/lib/tour/walkBounds";

export interface MoveInput {
  forward: number;
  strafe: number;
}

export interface StickInput extends MoveInput {
  turn: number;
}

/** Joystick knob position, each axis −1…1: x right, y up (away from you). */
export interface StickAxes {
  x: number;
  y: number;
}

export interface SteeringConfig {
  /** Turn rate at full sideways deflection (and for A/D, ←/→), °/s. */
  maxTurnRateDeg: number;
  /** Joystick dead zone on each axis, fraction of the radius. */
  deadZone: number;
  /** Seconds for the turn rate to ease in/out (~95 % of a change). */
  turnSmoothTime: number;
}

export const NO_INPUT: StickInput = { forward: 0, strafe: 0, turn: 0 };

/** Longest frame step integrated at once, seconds. */
export const MAX_DT = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stick vector limited to unit length. */
export function normalizeStick({ forward, strafe }: MoveInput): MoveInput {
  const len = Math.hypot(forward, strafe);
  return len > 1 ? { forward: forward / len, strafe: strafe / len } : { forward, strafe };
}

/**
 * World-space target velocity (x, z) for the stick at camera yaw (radians,
 * three.js: yaw 0 looks toward −z, positive yaw turns left).
 */
export function targetVelocity(input: MoveInput, yaw: number, speed: number): Vec2 {
  const { forward, strafe } = normalizeStick(input);
  // forward = (−sin yaw, −cos yaw); right = (cos yaw, −sin yaw)
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return [(fx * forward + rx * strafe) * speed, (fz * forward + rz * strafe) * speed];
}

/**
 * Velocity after `dt` seconds of easing from `current` toward `target`.
 * `accelTime` is the time to cover ~95 % of a change (exponential approach),
 * frame-rate independent.
 */
export function easeVelocity(current: Vec2, target: Vec2, dt: number, accelTime: number): Vec2 {
  const step = clamp(dt, 0, MAX_DT);
  if (accelTime <= 0) return target;
  const k = 1 - Math.exp((-3 * step) / accelTime);
  const v: Vec2 = [current[0] + (target[0] - current[0]) * k, current[1] + (target[1] - current[1]) * k];
  // settle to an exact stop instead of creeping forever
  if (target[0] === 0 && target[1] === 0 && Math.hypot(v[0], v[1]) < 1e-3) return [0, 0];
  return v;
}

/** Look update from a pointer drag (pixels), with the pitch limit. */
export function applyLook(
  yaw: number,
  pitch: number,
  dxPx: number,
  dyPx: number,
  radiansPerPx: number,
  pitchLimit: number,
): { yaw: number; pitch: number } {
  // first-person look: drag right → turn right (yaw decreases),
  // drag up (dy < 0) → look up
  const nextYaw = yaw - dxPx * radiansPerPx;
  const nextPitch = clamp(pitch - dyPx * radiansPerPx, -pitchLimit, pitchLimit);
  return { yaw: nextYaw, pitch: nextPitch };
}

/** Keyboard state → input: W/S ↑/↓ walk, A/D ←/→ turn, Q/E strafe. */
export function keysToStick(keys: ReadonlySet<string>): StickInput {
  const has = (...codes: string[]) => codes.some((c) => keys.has(c));
  const forward = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0);
  const turn = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
  const strafe = (has("KeyE") ? 1 : 0) - (has("KeyQ") ? 1 : 0);
  return { forward, strafe, turn };
}

/**
 * One joystick axis through the dead zone: 0 inside it, then rescaled so the
 * response starts at 0 at its edge and reaches ±1 at full deflection.
 */
export function applyDeadZone(v: number, deadZone: number): number {
  const a = Math.min(1, Math.abs(v));
  if (a <= deadZone) return 0;
  return (Math.sign(v) * (a - deadZone)) / (1 - deadZone);
}

/**
 * Joystick → input ("follow" steering): Y walks along the heading, X turns.
 * Each axis has its own dead zone, so a straight push forward doesn't drift
 * into a turn and a pure sideways push turns in place. Never strafes.
 */
export function joystickToInput({ x, y }: StickAxes, deadZone: number): StickInput {
  return { forward: applyDeadZone(y, deadZone), strafe: 0, turn: applyDeadZone(x, deadZone) };
}

/**
 * Target yaw rate (rad/s) for a turn input. Turning right lowers yaw (three.js
 * yaw grows to the left). Independent of walking direction, so stick left
 * always turns the view left, also while backing up.
 */
export function targetTurnRate(turn: number, maxTurnRateDeg: number): number {
  return (-clamp(turn, -1, 1) * maxTurnRateDeg * Math.PI) / 180;
}

/** Turn rate after `dt` seconds of easing toward `target` (same curve as velocity). */
export function easeTurnRate(current: number, target: number, dt: number, smoothTime: number): number {
  const step = clamp(dt, 0, MAX_DT);
  if (smoothTime <= 0) return target;
  const r = current + (target - current) * (1 - Math.exp((-3 * step) / smoothTime));
  // settle to an exact stop (≈ 0.03 °/s)
  if (target === 0 && Math.abs(r) < 5e-4) return 0;
  return r;
}
