import { SHOWROOM_RACKS, type ShowroomRack } from "./showroomRacks";
import { WALK_TRACK, type WalkTrack } from "./walkTrack";

/**
 * Brand names floating over the racks in the 360° walk (David 2026-11-09:
 * "every rack should have its brand name written over it, see-through").
 *
 * The walk's video frame is world-locked (yaw 0 = the same wall all along),
 * and the track knows where the camera stood (posM, metres, seen from above;
 * three.js axes: x = sin(yaw), z = −cos(yaw)). A rack stands where its stop
 * looks, a little past the stop: stop position + RACK_AHEAD_M along the stop's
 * yaw. From any point of the walk the label is then drawn in the direction of
 * that spot, at a height above the rack.
 */
export const RACK_AHEAD_M = 1.6;
/** Camera height (held up on a stick over the head) and label height (above the rack top), m. */
export const CAM_HEIGHT_M = 2.15;
export const LABEL_HEIGHT_M = 1.8;

export interface RackLabel {
  rack: ShowroomRack;
  x: number;
  z: number;
}

/** Camera floor position (m) at walk time t, from the track's posM (linear between samples). */
export function posAt(t: number, track: WalkTrack = WALK_TRACK): { x: number; z: number } {
  const p = track.posM;
  if (!p || p.length < 4) return { x: 0, z: 0 };
  const n = p.length / 2;
  const f = Math.min(n - 1, Math.max(0, t / track.stepSec));
  const i = Math.min(n - 2, Math.floor(f));
  const u = f - i;
  return { x: p[2 * i] + (p[2 * i + 2] - p[2 * i]) * u, z: p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * u };
}

export function rackLabels(racks: readonly ShowroomRack[] = SHOWROOM_RACKS, track: WalkTrack = WALK_TRACK): RackLabel[] {
  return racks.map((rack) => {
    const c = posAt(rack.stop.t, track);
    const a = (rack.stop.yawDeg * Math.PI) / 180;
    return { rack, x: c.x + Math.sin(a) * RACK_AHEAD_M, z: c.z - Math.cos(a) * RACK_AHEAD_M };
  });
}

/** Where a label is seen from walk time t: view yaw / pitch (°) and distance (m). */
export function labelView(label: RackLabel, t: number, track: WalkTrack = WALK_TRACK): { yawDeg: number; pitchDeg: number; distM: number } {
  const c = posAt(t, track);
  const dx = label.x - c.x;
  const dz = label.z - c.z;
  const distM = Math.hypot(dx, dz);
  const yawDeg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const pitchDeg = (Math.atan2(LABEL_HEIGHT_M - CAM_HEIGHT_M, Math.max(0.3, distM)) * 180) / Math.PI;
  return { yawDeg, pitchDeg, distM };
}
