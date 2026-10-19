// The /showroom walk-through video: one 360° video (Insta360 X4, heading
// locked) of a loop around the shop, played forward or backward by the
// joystick. Pure logic here (no DOM, no three.js) so it can be unit-tested;
// the viewer is components/tour/VideoWalk.tsx.
//
// FILES (Supabase Storage, public bucket "showroom", walk/; the site host
// serves files only up to ~25 MB, these are ~45 MB)
//   walk-fwd.mp4  the walk, 3840×1920 equirectangular, H.264 High, 30 fps,
//                 4.3 Mbit/s two-pass, faststart
//   walk-rev.mp4  the same frames in reverse order: its time r shows forward
//                 time `revEnd − r` (measured frame by frame by PSNR), so
//                 walking backward is plain playback too (seeking backward
//                 frame by frame stutters on phones)
//   (the track itself is bundled: walkTrackData.ts)
//
// TIMES are seconds on the forward video ("forward time").
//   start         where a visit begins (standing at the entrance, facing in)
//   loop.from/to  the walk returns near its start: passing `from` going
//                 forward continues at `to` (and the other way round going
//                 backward), with a short cross-fade over the jump
//   headingDeg    yaw of the direction of travel IN THE VIDEO FRAME, one
//                 sample per stepSec, smoothed. Yaw 0 = centre of the video
//                 frame, + = right. (Measured in the frame, not in the world,
//                 so a slow drift of the camera's heading — ~4° over this
//                 loop — doesn't put the view off the path.)
// HOW THE TRACK WAS MADE (2026-10-19 shoot, camera on a stick above the
// head): frames every 0.2 s, SIFT matches between frames 0.4 s apart (above
// −35° pitch; below is the person holding the camera, covered on screen by
// the nadir disc), essential matrix on the sphere → direction of travel;
// circular median of 5 + Gaussian σ 0.5 s. Loop points: the frame pair with
// the most matches and least parallax between the end and the start.
// Source: export_video.MP4, 3840×1920, 161.8 s, two loops; the first one,
// 5.0–86.0 s, is used.

import { WALK_TRACK_DATA } from "./walkTrackData";
import { angleDiff, normDeg } from "./tourMath";

export interface WalkTrack {
  duration: number;
  /** Forward time shown at the start of walk-rev.mp4 (see above). */
  revEnd: number;
  fps: number;
  stepSec: number;
  start: number;
  loop: { from: number; to: number };
  headingDeg: number[];
}

export const WALK_TRACK: WalkTrack = WALK_TRACK_DATA;

export const WALK_VIDEO = {
  base: "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/showroom/walk/walk",
  /**
   * Nadir cover: the camera was held up on a stick, so the person holding it
   * fills the bottom of the picture (below ~−42°). A dark disc widthDeg
   * across with soft edges hides that, with the maika.ge logo
   * (logoWidthDeg) in the middle.
   */
  nadirLogo: { url: "/tour/nadir-logo.webp", widthDeg: 100, logoWidthDeg: 30 },
} as const;

export const WALK_FEEL = {
  /** Stick |y| below this does not walk. */
  walkAt: 0.2,
  /** Playback rate at walkAt and at full deflection (keys = full). 1 = the
   *  pace it was filmed at (a slow walk). */
  minRate: 0.8,
  maxRate: 2.2,
  /** Stick |y| that already gives maxRate (a thumb rarely reaches the rim). */
  fullAt: 0.85,
  /** Time constant of the rate easing (ms): start / stop softly. */
  rateEaseMs: 160,
  /** Below this rate while stopping, pause. */
  stopRate: 0.3,
  /** Stick turning: dead zone and top speed (°/s). */
  turnDeadZone: 0.12,
  turnMaxDegPerSec: 130,
  /** Walking forward the view turns toward the path, looking this far ahead (s). */
  lookAheadSec: 0.6,
  /** …at most this fast (°/s), easing out the last bit with this time constant (ms). */
  followMaxDegPerSec: 80,
  followEaseMs: 1000,
  /** …and only once the visitor hasn't turned or dragged for this long (ms),
   *  so a look to the side isn't pulled straight back. */
  followDelayMs: 1200,
  /** While walking the view's pitch eases toward this. */
  walkPitchDeg: -2,
  pitchEaseMs: 1200,
  /** Seconds between footsteps at playback rate 1 (= steps.strideM / steps.walkSpeedMps). */
  footstepSec: 0.56,
  /** Head bob per step while walking (on top of the camera's own sway), at rate 1. */
  bobPitchDeg: 0.35,
  bobRollDeg: 0.25,
  /** While walking, re-park the idle video at the same moment this often (ms). */
  parkEveryMs: 4000,
  /** Cross-fade over the loop jump (ms). */
  loopFadeMs: 450,
  /** Colour lift in the shader (on the sRGB picture): saturation and contrast
   *  around mid-grey, 1 = as filmed. */
  saturation: 1.22,
  contrast: 1.07,
  /**
   * Footprints on the floor showing where the walk goes next. Metres: the
   * camera was ~2.1 m up (on a stick above the head); the walk covers ~0.75 m per second
   * of video. Prints sit at fixed places along the path (every strideM,
   * alternating left / right footOffsetM from the middle), so they come
   * toward the visitor and pass underfoot as the walk goes on; shown from
   * startM (clear of the nadir logo) to startM + lengthM ahead.
   */
  steps: { cameraHeightM: 2.1, walkSpeedMps: 0.75, startM: 0.9, lengthM: 4.0, strideM: 0.42, footOffsetM: 0.11, footLenM: 0.3, footWidthM: 0.12 },
} as const;

export type WalkDir = "fwd" | "rev";

/** Smoothed world heading of travel at forward time t (°), interpolated on the unit circle. */
export function headingAt(t: number, track: WalkTrack = WALK_TRACK): number {
  const h = track.headingDeg;
  const x = Math.min(h.length - 1, Math.max(0, t / track.stepSec));
  const i = Math.floor(x);
  const j = Math.min(h.length - 1, i + 1);
  const f = x - i;
  return normDeg(h[i] + angleDiff(h[j], h[i]) * f);
}

/** Stick pushed up = walk the way you look ("ahead"), pulled down = step back. */
export type WalkIntent = "ahead" | "back";
/** Which way the visitor faces relative to the walk's forward direction. */
export type Facing = "along" | "against";

/** Walking intent and playback rate for a stick y (up +), or null = stand. */
export function walkFromStick(
  y: number,
  cfg: { walkAt: number; fullAt: number; minRate: number; maxRate: number } = WALK_FEEL,
): { intent: WalkIntent; rate: number } | null {
  const a = Math.abs(y);
  if (a < cfg.walkAt) return null;
  const f = Math.min(1, (a - cfg.walkAt) / (cfg.fullAt - cfg.walkAt));
  return { intent: y > 0 ? "ahead" : "back", rate: cfg.minRate + (cfg.maxRate - cfg.minRate) * f };
}

/** Facing along the walk when the view is within 90° of its heading at t. */
export function facingFromView(yawDeg: number, t: number, track: WalkTrack = WALK_TRACK): Facing {
  return Math.abs(angleDiff(yawDeg, headingAt(t, track))) <= 90 ? "along" : "against";
}

/**
 * Which video plays: walking ahead while facing along the walk (or stepping
 * back while facing against it) plays it forward; the other two play the
 * reversed video. So turning round and pushing up walks back the way you
 * came, anywhere on the loop.
 */
export function planWalk(intent: WalkIntent, facing: Facing): WalkDir {
  return (intent === "ahead") === (facing === "along") ? "fwd" : "rev";
}

/** Time on the video that plays in `dir` showing forward time t. */
export function videoTime(t: number, dir: WalkDir, track: WalkTrack = WALK_TRACK): number {
  return dir === "fwd" ? t : track.revEnd - t;
}

/** Forward time shown at time v of the video that plays in `dir`. */
export function forwardTime(v: number, dir: WalkDir, track: WalkTrack = WALK_TRACK): number {
  return dir === "fwd" ? v : track.revEnd - v;
}

/**
 * The loop jump: forward time to continue at when moving in `dir` has passed
 * the loop point, else null.
 */
export function loopJump(t: number, dir: WalkDir, track: WalkTrack = WALK_TRACK): number | null {
  const { from, to } = track.loop;
  if (dir === "fwd" && t >= from) return to + (t - from);
  if (dir === "rev" && t <= to) return from - (to - t);
  return null;
}

/**
 * Where the view should look while walking: along the walk (or against it,
 * as the visitor faces), a little ahead when walking face-first; stepping
 * back, at the current spot.
 */
export function followTarget(
  t: number,
  dir: WalkDir,
  facing: Facing,
  cfg: { lookAheadSec: number } = WALK_FEEL,
  track: WalkTrack = WALK_TRACK,
): number {
  const faceFirst = (dir === "fwd") === (facing === "along");
  const tt = faceFirst ? (dir === "fwd" ? Math.min(track.duration, t + cfg.lookAheadSec) : Math.max(0, t - cfg.lookAheadSec)) : t;
  return normDeg(headingAt(tt, track) + (facing === "along" ? 0 : 180));
}

/**
 * One frame of the view turning toward `targetDeg`: eases with followEaseMs,
 * never faster than followMaxDegPerSec. Returns the new yaw.
 */
export function followStep(
  yawDeg: number,
  targetDeg: number,
  dtMs: number,
  cfg: { followMaxDegPerSec: number; followEaseMs: number } = WALK_FEEL,
): number {
  const off = angleDiff(targetDeg, yawDeg);
  const eased = off * (1 - Math.exp(-dtMs / cfg.followEaseMs));
  const max = (cfg.followMaxDegPerSec * dtMs) / 1000;
  return normDeg(yawDeg + Math.max(-max, Math.min(max, eased)));
}

/** Vertical field of view (°) giving ~targetHfov across, capped to [minV, maxV]. */
export function vfovFor(width: number, height: number, targetHfov = 100, minV = 35, maxV = 100): number {
  const aspect = width > 0 && height > 0 ? width / height : 1.5;
  const v = (2 * Math.atan(Math.tan(((targetHfov / 2) * Math.PI) / 180) / aspect) * 180) / Math.PI;
  return Math.min(maxV, Math.max(minV, v));
}

export interface Footprint {
  /** Floor position relative to the camera (m), three.js axes: x right of world yaw 0, z = −forward at world yaw 0. */
  x: number;
  z: number;
  /** World heading the foot points to (°) = direction of motion there. */
  hDeg: number;
  /** −1 left foot, 1 right foot. */
  side: -1 | 1;
  /** Distance along the path from the visitor (m). */
  r: number;
}

/**
 * Footprints along the path in the direction of motion (`dir`): fixed spots
 * every strideM along the walk (so they stay put on the floor while the
 * visitor moves), from startM to startM + lengthM ahead.
 */
export function footprints(
  t: number,
  dir: WalkDir,
  cfg: { walkSpeedMps: number; startM: number; lengthM: number; strideM: number; footOffsetM: number } = WALK_FEEL.steps,
  track: WalkTrack = WALK_TRACK,
): Footprint[] {
  // path polyline from the visitor, every ds metres
  const ds = 0.04;
  const maxR = cfg.startM + cfg.lengthM;
  const dtPer = ds / cfg.walkSpeedMps;
  const xs: number[] = [];
  const zs: number[] = [];
  const hs: number[] = [];
  let x = 0;
  let z = 0;
  let tt = t;
  for (let d = 0; d <= maxR + ds; d += ds) {
    const h = dir === "fwd" ? headingAt(tt, track) : normDeg(headingAt(tt, track) + 180);
    xs.push(x);
    zs.push(z);
    hs.push(h);
    const rad = (h * Math.PI) / 180;
    x += Math.sin(rad) * ds;
    z -= Math.cos(rad) * ds;
    tt = dir === "fwd" ? Math.min(track.duration, tt + dtPer) : Math.max(0, tt - dtPer);
  }
  // prints at path coordinate u ≡ 0 (mod stride); u grows in the direction of motion
  const u = (dir === "fwd" ? 1 : -1) * cfg.walkSpeedMps * t;
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  const out: Footprint[] = [];
  for (let r = cfg.startM + mod(-(u + cfg.startM), cfg.strideM); r <= maxR + 1e-9; r += cfg.strideM) {
    const k = Math.min(xs.length - 2, Math.floor(r / ds));
    const f = r / ds - k;
    const h = hs[k] + angleDiff(hs[k + 1], hs[k]) * f;
    const px = xs[k] + (xs[k + 1] - xs[k]) * f;
    const pz = zs[k] + (zs[k + 1] - zs[k]) * f;
    const n = Math.round((u + r) / cfg.strideM);
    const side: -1 | 1 = mod(n, 2) === 0 ? -1 : 1;
    const rad = (h * Math.PI) / 180;
    // right of the direction of motion = (cos h, 0, sin h)
    out.push({ x: px + Math.cos(rad) * side * cfg.footOffsetM, z: pz + Math.sin(rad) * side * cfg.footOffsetM, hDeg: normDeg(h), side, r });
  }
  return out;
}
