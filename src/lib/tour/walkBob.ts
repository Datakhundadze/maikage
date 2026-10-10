// Head bob for the first-person walk, driven by distance actually travelled.
//
// The walker's logical position (bounds clamp, velocity) is never touched:
// the bob is only an offset added to the camera after the step is resolved.
// Feeding it the distance moved this frame (after clampStep) means it stops
// by itself when the walker is pressed against a wall.
//
// GAIT: one full cycle per two steps. With phase φ = π · distance / stepLength
//   vertical  = −verticalAmp · cos 2φ   lowest at every footfall (φ = kπ)
//   lateral   =  lateralAmp  · sin φ    sways over the foot that just landed
//   roll      =  rollDeg     · sin φ    in phase with the sway
// all three scaled by `amp` (0…1), which follows speed / walkSpeed and moves
// at most 1 / settleTime per second, so it reaches exactly 0 within
// settleTime of stopping and the camera is back at eye height.

export interface BobConfig {
  /** Distance per step, metres (one bob cycle = two steps). */
  stepLength: number;
  /** Peak vertical offset at full speed, metres. */
  verticalAmp: number;
  /** Peak sideways sway at full speed, metres. */
  lateralAmp: number;
  /** Peak roll at full speed, degrees (keep under 0.5). */
  rollDeg: number;
  /** Seconds for the bob to fade from full to zero after stopping. */
  settleTime: number;
}

export interface BobState {
  /** Distance walked since the viewer opened, metres (only drives phase). */
  distance: number;
  /** Current bob strength, 0…1. */
  amp: number;
  /** Footfalls so far: floor(distance / stepLength). */
  steps: number;
}

export type Foot = "left" | "right";

export interface BobOffset {
  /** Vertical offset, metres (+ up). */
  y: number;
  /** Sideways offset along the camera's right vector, metres (+ right). */
  lateral: number;
  /** Roll, radians (+ = head tilts right). */
  roll: number;
}

export const BOB_REST: BobState = { distance: 0, amp: 0, steps: 0 };

/** Below this speed (m/s) the walker counts as standing still. */
const STILL_SPEED = 0.02;

/**
 * Advance the bob by one frame. `travelled` is the distance the walker really
 * moved this frame (after the bounds clamp), `dt` the frame time in seconds.
 * Returns the new state and the footfalls crossed during the frame (the low
 * points of the vertical bob), alternating left/right.
 */
export function stepBob(
  state: BobState,
  travelled: number,
  dt: number,
  walkSpeed: number,
  cfg: BobConfig,
): { state: BobState; footfalls: Foot[] } {
  const moved = Math.max(0, travelled);
  const speed = dt > 0 ? moved / dt : 0;
  const target = speed < STILL_SPEED ? 0 : Math.min(1, speed / walkSpeed);
  const maxChange = cfg.settleTime > 0 ? dt / cfg.settleTime : 1;
  const amp = state.amp + Math.max(-maxChange, Math.min(maxChange, target - state.amp));

  const distance = state.distance + moved;
  const steps = Math.floor(distance / cfg.stepLength);
  const footfalls: Foot[] = [];
  for (let k = state.steps + 1; k <= steps; k++) footfalls.push(k % 2 === 1 ? "left" : "right");
  return { state: { distance, amp: Math.min(1, Math.max(0, amp)), steps }, footfalls };
}

/** Camera offset for the current bob state; exactly zero when amp is 0. */
export function bobOffset(state: BobState, cfg: BobConfig): BobOffset {
  if (state.amp === 0) return { y: 0, lateral: 0, roll: 0 };
  const phi = (Math.PI * state.distance) / cfg.stepLength;
  const sway = Math.sin(phi);
  return {
    y: -cfg.verticalAmp * state.amp * Math.cos(2 * phi),
    lateral: cfg.lateralAmp * state.amp * sway,
    roll: ((cfg.rollDeg * Math.PI) / 180) * state.amp * sway,
  };
}
