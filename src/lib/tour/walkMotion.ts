// First-person walking: input → velocity on the floor plane, with ease-in/out.
//
// Input is a 2D "stick" in the walker's own frame: forward (−1…1) and strafe
// (−1 left … 1 right), from the keyboard or the on-screen joystick. Its length
// is capped at 1, so diagonals are not faster. The velocity eases toward the
// target with a time constant so starting and stopping are not abrupt, and
// small frame-time spikes cannot launch the walker (dt is capped).

import type { Vec2 } from "@/lib/tour/walkBounds";

export interface StickInput {
  forward: number;
  strafe: number;
}

/** Longest frame step integrated at once, seconds. */
export const MAX_DT = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stick vector limited to unit length. */
export function normalizeStick({ forward, strafe }: StickInput): StickInput {
  const len = Math.hypot(forward, strafe);
  return len > 1 ? { forward: forward / len, strafe: strafe / len } : { forward, strafe };
}

/**
 * World-space target velocity (x, z) for the stick at camera yaw (radians,
 * three.js: yaw 0 looks toward −z, positive yaw turns left).
 */
export function targetVelocity(input: StickInput, yaw: number, speed: number): Vec2 {
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

/** Keyboard state → stick. */
export function keysToStick(keys: ReadonlySet<string>): StickInput {
  const has = (...codes: string[]) => codes.some((c) => keys.has(c));
  const forward = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0);
  const strafe = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
  return { forward, strafe };
}
