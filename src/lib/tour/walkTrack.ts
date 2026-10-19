// The /showroom walk-through video: one 360° video (Insta360 X4, heading
// locked) of a loop around the shop, played forward or backward by the
// joystick. Pure logic here (no DOM, no three.js) so it can be unit-tested;
// the viewer is components/tour/VideoWalk.tsx.
//
// FILES (Supabase Storage, public bucket "showroom", walk/; the site host
// serves files only up to ~25 MB): the walk is cut in parts (WalkPart), each
// a pair `${base}-fwd.mp4` / `${base}-rev.mp4`, 3840×1920 equirectangular,
// H.264 High, 30 fps, 4.3 Mbit/s two-pass, faststart; the -rev file holds
// the same frames reversed (its time r shows forward time from + revEnd − r,
// measured frame by frame by PSNR), so walking backward is plain playback
// too (seeking backward frame by frame stutters on phones).
//   walk-*.mp4    0 – 81 s   (source 5 – 86 s: the first loop)
//   walk-b-*.mp4  81 – 156.4 s (source 86 – 161.4 s: the second loop)
//   (the track itself is bundled: walkTrackData.ts)
//
// JUNCTIONS (links): spots the walk passes twice. Walking face-first
// through one, if the visitor looks clearly more toward one of the other
// pass's two directions than down the way ahead, the walk continues on the
// other pass (junctionChoice); prints show the other ways a few metres
// before (junctionsAhead). Found by comparing frames far apart in time but
// close on the walked map: rotation-only fit of SIFT matches, the residual
// is the parallax (< 0.9° = the camera stood within a few cm).
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
// Source: export_video.MP4, 3840×1920, 161.8 s, two loops, 5.0–161.4 s used.

import { WALK_TRACK_DATA } from "./walkTrackData";
import { angleDiff, normDeg } from "./tourMath";

/**
 * One file pair of the walk (the host takes files up to ~50 MB, the walk is
 * cut in parts). Times are forward times on the whole walk; the part's
 * videos play from `from` to `to`: `${base}-fwd.mp4` at local time
 * t − from, `${base}-rev.mp4` (the same frames reversed) at local time
 * revEnd − (t − from).
 */
export interface WalkPart {
  from: number;
  to: number;
  base: string;
  revEnd: number;
}

/**
 * A spot the walk passes twice (two different times, the camera within a
 * few centimetres): walking through one of them the visitor can carry on
 * along the other pass. yawDeg: how much the video frame is turned at `b`
 * relative to `a` (a direction at yaw θ in the frame at a is at θ + yawDeg
 * in the frame at b).
 */
export interface WalkLink {
  a: number;
  b: number;
  yawDeg: number;
}

export interface WalkTrack {
  duration: number;
  parts: WalkPart[];
  links?: WalkLink[];
  fps: number;
  stepSec: number;
  start: number;
  loop: { from: number; to: number };
  headingDeg: number[];
  /**
   * Distance walked from the start of the video (m), one value per stepSec,
   * measured from how fast the floor moves past the camera (so standing
   * still in the video is 0 m/s). Missing in test tracks: then 1 m/s.
   */
  distM?: number[];
}

export const WALK_TRACK: WalkTrack = WALK_TRACK_DATA;

export const WALK_VIDEO = {
  /**
   * Nadir cover: the camera was held up on a stick, so the person holding it
   * fills the bottom of the picture (below ~−42°). A dark disc widthDeg
   * across with soft edges hides that, with the maika.ge logo
   * (logoWidthDeg) in the middle.
   */
  nadirLogo: { url: "/tour/nadir-logo.webp", widthDeg: 96, logoWidthDeg: 30 },
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
  followDelayMs: 1800,
  /** While walking the view's pitch eases toward this. */
  walkPitchDeg: 3,
  pitchEaseMs: 1200,
  /** Head bob per step while walking, on top of the camera's own sway —
   *  kept very small (big screens magnify it). Steps (sound + bob) follow
   *  the distance actually walked in the video, one per steps.strideM. */
  bobPitchDeg: 0.12,
  bobRollDeg: 0.08,
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
   * camera was ~2.1 m up (on a stick above the head); distances along the
   * walk come from the track's distM (floor flow × camera height). Prints sit at fixed places along the path (every strideM,
   * alternating left / right footOffsetM from the middle), so they come
   * toward the visitor and pass underfoot as the walk goes on; shown from
   * startM (clear of the nadir logo) to startM + lengthM ahead.
   */
  steps: { cameraHeightM: 2.1, startM: 2.0, lengthM: 4.6, strideM: 0.7, footOffsetM: 0.12, footLenM: 0.3, footWidthM: 0.12 },
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

/** The part that plays forward time t when moving in `dir` (at a boundary: the one the walk goes on into). */
export function partIndexAt(t: number, dir: WalkDir, track: WalkTrack = WALK_TRACK): number {
  const ps = track.parts;
  if (dir === "fwd") {
    for (let i = ps.length - 1; i >= 0; i--) if (t >= ps[i].from) return i;
    return 0;
  }
  for (let i = 0; i < ps.length; i++) if (t <= ps[i].to) return i;
  return ps.length - 1;
}

/** Time on part p's video that plays in `dir`, showing forward time t. */
export function localTime(t: number, p: number, dir: WalkDir, track: WalkTrack = WALK_TRACK): number {
  const part = track.parts[p];
  return dir === "fwd" ? t - part.from : part.revEnd - (t - part.from);
}

/** Forward time shown at time v of part p's video that plays in `dir`. */
export function globalTime(v: number, p: number, dir: WalkDir, track: WalkTrack = WALK_TRACK): number {
  const part = track.parts[p];
  return dir === "fwd" ? part.from + v : part.from + part.revEnd - v;
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

/** Distance walked (m) at forward time t. */
export function distanceAt(t: number, track: WalkTrack = WALK_TRACK): number {
  const d = track.distM;
  if (!d) return Math.max(0, t);
  const x = Math.min(d.length - 1, Math.max(0, t / track.stepSec));
  const i = Math.floor(x);
  const j = Math.min(d.length - 1, i + 1);
  return d[i] + (d[j] - d[i]) * (x - i);
}

/** Forward time at which the walk has covered `dist` metres (first time, if it stood still there). */
export function timeAtDistance(dist: number, track: WalkTrack = WALK_TRACK): number {
  const d = track.distM;
  if (!d) return Math.min(track.duration, Math.max(0, dist));
  if (dist <= d[0]) return 0;
  if (dist >= d[d.length - 1]) return track.duration;
  let lo = 0;
  let hi = d.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] < dist) lo = mid;
    else hi = mid;
  }
  const span = d[hi] - d[lo];
  return (lo + (span > 0 ? (dist - d[lo]) / span : 0)) * track.stepSec;
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
  cfg: { startM: number; lengthM: number; strideM: number; footOffsetM: number } = WALK_FEEL.steps,
  track: WalkTrack = WALK_TRACK,
): Footprint[] {
  // path polyline from the visitor, every ds metres, following the distance
  // the video actually covers (heading looked up at the time that distance
  // is reached), forward or backward
  const ds = 0.04;
  const maxR = cfg.startM + cfg.lengthM;
  const d0 = distanceAt(t, track);
  const xs: number[] = [];
  const zs: number[] = [];
  const hs: number[] = [];
  let x = 0;
  let z = 0;
  for (let d = 0; d <= maxR + ds; d += ds) {
    const tt = timeAtDistance(dir === "fwd" ? d0 + d : d0 - d, track);
    const h = dir === "fwd" ? headingAt(tt, track) : normDeg(headingAt(tt, track) + 180);
    xs.push(x);
    zs.push(z);
    hs.push(h);
    const rad = (h * Math.PI) / 180;
    x += Math.sin(rad) * ds;
    z -= Math.cos(rad) * ds;
  }
  // prints at path coordinate u ≡ 0 (mod stride); u grows in the direction of motion
  const u = dir === "fwd" ? d0 : -d0;
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

/** Each link seen from one end: at `at`, the other pass is at `other`, its frame turned by `shift`. */
function linkEnds(track: WalkTrack): { at: number; other: number; shift: number }[] {
  const out: { at: number; other: number; shift: number }[] = [];
  for (const l of track.links ?? []) {
    out.push({ at: l.a, other: l.b, shift: l.yawDeg });
    out.push({ at: l.b, other: l.a, shift: -l.yawDeg });
  }
  return out;
}

export interface JunctionChoice {
  /** Forward time to continue at, the direction to play there, and how much the view's yaw changes (new frame). */
  t: number;
  dir: WalkDir;
  yawShift: number;
}

/**
 * Walking face-first from tPrev to t in `dir`: if that passed a junction and
 * one of the other pass's two directions points clearly closer to where the
 * visitor looks (viewYaw) than the way ahead, the walk continues there.
 */
export function junctionChoice(
  tPrev: number,
  t: number,
  dir: WalkDir,
  viewYaw: number,
  cfg: { minGainDeg: number; maxOffDeg: number } = { minGainDeg: 35, maxOffDeg: 75 },
  track: WalkTrack = WALK_TRACK,
): JunctionChoice | null {
  let best: JunctionChoice | null = null;
  let bestOff = Infinity;
  for (const e of linkEnds(track)) {
    const crossed = dir === "fwd" ? tPrev < e.at && e.at <= t : t <= e.at && e.at < tPrev;
    if (!crossed) continue;
    const ahead = normDeg(headingAt(e.at, track) + (dir === "fwd" ? 0 : 180));
    const offAhead = Math.abs(angleDiff(viewYaw, ahead));
    for (const d of ["fwd", "rev"] as WalkDir[]) {
      // the branch's heading, brought into the current frame
      const h = normDeg(headingAt(e.other, track) + (d === "fwd" ? 0 : 180) - e.shift);
      const off = Math.abs(angleDiff(viewYaw, h));
      if (off <= cfg.maxOffDeg && offAhead - off >= cfg.minGainDeg && off < bestOff) {
        bestOff = off;
        best = { t: e.other, dir: d, yawShift: e.shift };
      }
    }
  }
  return best;
}

export interface JunctionAhead {
  /** Where the junction is on the current pass, how far ahead (m), and the other pass. */
  at: number;
  distM: number;
  other: number;
  shift: number;
}

/** Junctions within maxDistM ahead in the direction of motion. */
export function junctionsAhead(t: number, dir: WalkDir, maxDistM: number, track: WalkTrack = WALK_TRACK): JunctionAhead[] {
  const d0 = distanceAt(t, track);
  const out: JunctionAhead[] = [];
  for (const e of linkEnds(track)) {
    if (dir === "fwd" ? e.at <= t : e.at >= t) continue;
    const dist = Math.abs(distanceAt(e.at, track) - d0);
    if (dist <= maxDistM) out.push({ at: e.at, distM: dist, other: e.other, shift: e.shift });
  }
  return out.sort((x, y) => x.distM - y.distM);
}

/** Floor position (m, three.js axes, camera at the origin) and heading of the path `dist` metres along the motion. */
export function pathPointAt(t: number, dir: WalkDir, dist: number, track: WalkTrack = WALK_TRACK): { x: number; z: number; hDeg: number } {
  const ds = 0.04;
  const d0 = distanceAt(t, track);
  let x = 0;
  let z = 0;
  let h = 0;
  for (let d = 0; d < dist; d += ds) {
    const tt = timeAtDistance(dir === "fwd" ? d0 + d : d0 - d, track);
    h = dir === "fwd" ? headingAt(tt, track) : normDeg(headingAt(tt, track) + 180);
    const step = Math.min(ds, dist - d);
    x += Math.sin((h * Math.PI) / 180) * step;
    z -= Math.cos((h * Math.PI) / 180) * step;
  }
  return { x, z, hDeg: h };
}
