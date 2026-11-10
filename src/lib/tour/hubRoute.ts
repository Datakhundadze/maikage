// Routes without a jump on the way (David 2026-11-10: "walk only along
// concrete paths, with no breaks"). The older planner (autoWalk.planRoute)
// stepped from one filmed pass to another in the middle of the walk; on a real
// line every such step was a new download — it stalled or looked rough.
//
// Here a route is: at most ONE change of video, made while the visitor stands
// still (a soft dissolve), then one unbroken walk to the rack. The change goes
// to another moment of the take filmed at (almost) the same spot — or, when no
// short walk starts from here, to the operators' desk, which the take passes
// four times within a few cm; from the desk a direct stretch leads to every rack.

import type { RouteStep } from "./autoWalk";
import { posAt } from "./rackLabels";
import { WALK_TRACK, type WalkDir, type WalkTrack } from "./walkTrack";

/** Moments the take stands at the operators' desk (within 4 cm of each other), and the video frame's yaw drift there (°). */
export const DESK_MOMENTS: readonly { t: number; yawOffDeg: number }[] = [
  { t: 8, yawOffDeg: 0 },
  { t: 71, yawOffDeg: 1.4 },
  { t: 150.2, yawOffDeg: 2.2 },
  { t: 216.2, yawOffDeg: 1.6 },
];
export const DESK_TS: readonly number[] = DESK_MOMENTS.map((d) => d.t);

/** The desk moment the walk stands at (within `tol` s), or null. */
export function deskMomentAt(t: number, tol = 0.8): { t: number; yawOffDeg: number } | null {
  return DESK_MOMENTS.find((d) => Math.abs(d.t - t) < tol) ?? null;
}

export const HUB_CFG = {
  /** Another moment counts as "the same spot" within this many metres. */
  sameSpotM: 1.0,
  /** Costs, in seconds of video. */
  revPenalty: 1.3,
  /** per metre the new moment's camera stood away from here (the dissolve shows the shift) */
  shiftPerM: 15,
  /** any change of video */
  swap: 3,
  /** a change to the desk from somewhere else (the picture changes place) */
  toDesk: 18,
} as const;

function walkCost(a: number, b: number, track: WalkTrack, cfg = HUB_CFG): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const [s0, s1] of track.skips ?? []) if (s0 < hi && s1 > lo) return Infinity; // never across a cut-out stretch
  // never across a file boundary either: the whole walk plays from one file
  for (let i = 0; i + 1 < track.parts.length; i++) {
    const e = track.parts[i].to;
    if (e > lo + 0.02 && e < hi - 0.02) return Infinity;
  }
  return b >= a ? b - a : (a - b) * cfg.revPenalty;
}

/** Other moments of the take filmed within `r` m of where the camera stood at `from` (closest of each pass). */
export function sameSpotMoments(from: number, track: WalkTrack = WALK_TRACK, r = HUB_CFG.sameSpotM): { t: number; d: number }[] {
  const here = posAt(from, track);
  const end = Math.min(track.duration, track.loop.from);
  const out: { t: number; d: number }[] = [];
  let best: { t: number; d: number } | null = null;
  for (let t = track.start; t <= end + 1e-6; t += 0.2) {
    const p = posAt(t, track);
    const d = Math.hypot(p.x - here.x, p.z - here.z);
    if (d <= r) {
      if (!best || d < best.d) best = { t: Math.round(t * 10) / 10, d };
    } else if (best) {
      out.push(best);
      best = null;
    }
  }
  if (best) out.push(best);
  // the pass we stand on is `from` itself
  return out.filter((m) => Math.abs(m.t - from) > 3);
}

function yawShiftBetween(a: number, b: number, track: WalkTrack): number {
  for (const l of track.links ?? []) {
    if (Math.abs(l.a - a) < 1.5 && Math.abs(l.b - b) < 1.5) return l.yawDeg;
    if (Math.abs(l.b - a) < 1.5 && Math.abs(l.a - b) < 1.5) return -l.yawDeg;
  }
  const da = deskMomentAt(a, 1.5);
  const db = deskMomentAt(b, 1.5);
  return da && db ? db.yawOffDeg - da.yawOffDeg : 0;
}

/**
 * The route from forward time `from` to the cheapest of `tos`: an optional
 * change of video first (standing), then one walk. Null when nothing reaches.
 */
export function planHubRoute(from: number, tos: readonly number[], track: WalkTrack = WALK_TRACK, cfg = HUB_CFG): RouteStep[] | null {
  const starts: { t: number; cost: number }[] = [{ t: from, cost: 0 }];
  for (const m of sameSpotMoments(from, track, cfg.sameSpotM)) starts.push({ t: m.t, cost: cfg.swap + m.d * cfg.shiftPerM });
  const atDesk = deskMomentAt(from) !== null;
  for (const d of DESK_TS) if (Math.abs(d - from) > 0.05) starts.push({ t: d, cost: cfg.swap + (atDesk ? 0 : cfg.toDesk) });
  let best: { s: number; to: number; cost: number } | null = null;
  for (const s of starts)
    for (const to of tos) {
      const c = s.cost + walkCost(s.t, to, track, cfg);
      if (c < Infinity && (!best || c < best.cost)) best = { s: s.t, to, cost: c };
    }
  if (!best) return null;
  const dir: WalkDir = best.to >= best.s ? "fwd" : "rev";
  const steps: RouteStep[] = [];
  if (Math.abs(best.s - from) > 0.05) steps.push({ kind: "hop", t: best.s, dir, yawShift: yawShiftBetween(from, best.s, track) });
  if (Math.abs(best.to - best.s) > 0.05) steps.push({ kind: "walk", dir, until: best.to });
  return steps;
}
