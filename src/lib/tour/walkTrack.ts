// The /showroom walk-through video: one 360° video (Insta360 X4, heading
// locked) of a loop around the shop, played forward or backward by the
// joystick. Pure logic here (no DOM, no three.js) so it can be unit-tested;
// the viewer is components/tour/VideoWalk.tsx.
//
// FILES (public/tour/walk/)
//   walk-fwd.mp4  the walk, 2560×1280 equirectangular, H.264, 30 fps,
//                 2.7 Mbit/s two-pass: each file must stay under the
//                 host's per-file limit (36 MB files were not served; ~24 MB)
//   walk-rev.mp4  the same frames in reverse order: its time r shows forward
//                 time `revEnd − r` (measured frame by frame, PSNR ≈ 38 dB at
//                 the match vs ≈ 28 one frame off), so walking backward is
//                 plain playback too (seeking backward frame by frame
//                 stutters on phones)
//   (the track itself is bundled: walkTrackData.ts)
//
// TIMES are seconds on the forward video ("forward time").
//   start         where a visit begins (standing at the entrance, facing in)
//   loop.from/to  the walk returns near its start: passing `from` going
//                 forward continues at `to` (and the other way round going
//                 backward), with a short cross-fade over the jump
//   headingDeg    world yaw of the direction of travel, one sample per
//                 stepSec, smoothed. World yaw 0 = centre of the video
//                 frame, + = right. The camera's heading is locked, so this is
//                 the same direction all the way through.
// HOW THE TRACK WAS MADE (2026-10-18): frames every 0.2 s, SIFT matches
// between frames 0.4 s apart (above −14° pitch, below that is the person
// holding the camera), essential matrix on the sphere → rotation (the
// camera's heading drifts < 2° over the loop) and direction of travel;
// circular median of 5 + Gaussian σ 0.5 s. Loop points: the frame pair with
// the most matches and least parallax between the end and the start.

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
  base: "/tour/walk/walk",
  /** Nadir cover (the camera was hand-held): maika.ge logo disc, degrees across. */
  nadirLogo: { url: "/tour/nadir-logo.webp", widthDeg: 34 },
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
  /** Seconds between footsteps at playback rate 1. */
  footstepSec: 0.56,
  /** While walking, re-park the idle video at the same moment this often (ms). */
  parkEveryMs: 4000,
  /** Cross-fade over the loop jump (ms). */
  loopFadeMs: 450,
  /** Colour lift in the shader (on the sRGB picture): saturation and contrast
   *  around mid-grey, 1 = as filmed. */
  saturation: 1.22,
  contrast: 1.07,
  /**
   * Guide lines on the floor (like a car's parking camera) showing where the
   * walk goes next. Metres: the camera was ~1.6 m up (face height); the walk
   * covers ~0.75 m per second of video. Lines start startM ahead (clear of
   * the nadir logo) and run lengthM along the path, halfWidthM either side.
   */
  guide: { cameraHeightM: 1.6, walkSpeedMps: 0.75, startM: 0.8, lengthM: 3.2, sampleM: 0.12, halfWidthM: 0.32, lineWidthM: 0.06 },
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

/** Walking direction and playback rate for a stick y (forward +), or null = stand. */
export function walkFromStick(
  y: number,
  cfg: { walkAt: number; fullAt: number; minRate: number; maxRate: number } = WALK_FEEL,
): { dir: WalkDir; rate: number } | null {
  const a = Math.abs(y);
  if (a < cfg.walkAt) return null;
  const f = Math.min(1, (a - cfg.walkAt) / (cfg.fullAt - cfg.walkAt));
  return { dir: y > 0 ? "fwd" : "rev", rate: cfg.minRate + (cfg.maxRate - cfg.minRate) * f };
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
 * Where the view should look while walking: the heading of travel a little
 * ahead (forward) — walking backward the visitor keeps facing the way the
 * path goes, like stepping back.
 */
export function followTarget(t: number, dir: WalkDir, cfg: { lookAheadSec: number } = WALK_FEEL, track: WalkTrack = WALK_TRACK): number {
  return headingAt(dir === "fwd" ? Math.min(track.duration, t + cfg.lookAheadSec) : t, track);
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

export interface GuidePoint {
  /** Floor position relative to the camera (m): x right of world yaw 0, z = −forward at world yaw 0 (three.js axes). */
  x: number;
  z: number;
  /** World heading of the path there (°). */
  hDeg: number;
}

/**
 * The path ahead in the direction of travel, as floor points from startM to
 * startM + lengthM (every sampleM), integrated from the heading track at
 * walkSpeedMps. Walking backward the path is the track run backward, so the
 * lines point behind the visitor.
 */
export function guidePath(
  t: number,
  dir: WalkDir,
  cfg: { walkSpeedMps: number; startM: number; lengthM: number; sampleM: number } = WALK_FEEL.guide,
  track: WalkTrack = WALK_TRACK,
): GuidePoint[] {
  const pts: GuidePoint[] = [];
  const ds = 0.04;
  const dtPer = ds / cfg.walkSpeedMps;
  let x = 0;
  let z = 0;
  let tt = t;
  let next = cfg.startM;
  for (let d = 0; d <= cfg.startM + cfg.lengthM + 1e-9; d += ds) {
    const h = dir === "fwd" ? headingAt(tt, track) : normDeg(headingAt(tt, track) + 180);
    if (d >= next - 1e-9) {
      pts.push({ x, z, hDeg: h });
      next += cfg.sampleM;
    }
    const r = (h * Math.PI) / 180;
    x += Math.sin(r) * ds;
    z -= Math.cos(r) * ds;
    tt = dir === "fwd" ? Math.min(track.duration, tt + dtPer) : Math.max(0, tt - dtPer);
  }
  return pts;
}
