// Walking to a place by itself (/showroom): the visitor taps a rack, the walk
// plays the filmed passes there — forward where it can, backward (the reversed
// copy, view turned round) where it must — and steps across from one pass to
// another only at the filmed crossings (links: the camera within a few cm, so
// the swap is clean). Pure logic, unit-tested; VideoWalk.tsx runs the steps.

import { distanceAt, WALK_TRACK, type WalkDir, type WalkTrack } from "./walkTrack";

/** One step of a route: play in `dir` until forward time `until`, or step across to another pass. */
export type RouteStep =
  | { kind: "walk"; dir: WalkDir; until: number }
  | { kind: "hop"; t: number; dir: WalkDir; yawShift: number };

export const AUTO_CFG = {
  /** Playing a pass backward looks a little less natural (people walk backward): cost × this. */
  revPenalty: 1.3,
  /** A step across costs like walking this far (m): fewer, cleaner swaps. */
  hopCostM: 1.5,
} as const;

interface Edge {
  to: number;
  cost: number;
  step: RouteStep;
}

function inSkip(t: number, track: WalkTrack): boolean {
  return (track.skips ?? []).some(([a, b]) => t > a + 0.05 && t < b - 0.05);
}

/**
 * Shortest route from forward time `from` to forward time `to` along the
 * filmed passes and their crossings (Dijkstra over the crossing points), or
 * null when there is none. Consecutive walks in the same direction are merged.
 */
export function planRoute(from: number, to: number, track: WalkTrack = WALK_TRACK, cfg = AUTO_CFG): RouteStep[] | null {
  const end = Math.min(track.duration, track.loop.from); // past the loop point the video is never shown going forward
  const clampT = (t: number) => Math.max(0, Math.min(end, t));
  from = clampT(from);
  to = clampT(to);
  const links = (track.links ?? []).filter((l) => l.a <= end && l.b <= end && !inSkip(l.a, track) && !inSkip(l.b, track));
  const keys = [...new Set([0, end, from, to, ...links.flatMap((l) => [l.a, l.b])].map((t) => Math.round(t * 1000) / 1000))].sort(
    (a, b) => a - b,
  );
  const idx = new Map(keys.map((t, i) => [t, i]));
  const key = (t: number) => idx.get(Math.round(t * 1000) / 1000)!;
  const edges: Edge[][] = keys.map(() => []);
  for (let i = 0; i + 1 < keys.length; i++) {
    const d = Math.abs(distanceAt(keys[i + 1], track) - distanceAt(keys[i], track)) + 0.01;
    edges[i].push({ to: i + 1, cost: d, step: { kind: "walk", dir: "fwd", until: keys[i + 1] } });
    edges[i + 1].push({ to: i, cost: d * cfg.revPenalty, step: { kind: "walk", dir: "rev", until: keys[i] } });
  }
  for (const l of links) {
    const ia = key(l.a);
    const ib = key(l.b);
    // the direction after the hop is decided by the walk that follows: "fwd" placeholder, fixed below
    edges[ia].push({ to: ib, cost: cfg.hopCostM, step: { kind: "hop", t: l.b, dir: "fwd", yawShift: l.yawDeg } });
    edges[ib].push({ to: ia, cost: cfg.hopCostM, step: { kind: "hop", t: l.a, dir: "fwd", yawShift: -l.yawDeg } });
  }
  const n = keys.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<{ from: number; step: RouteStep } | null>(n).fill(null);
  const done = new Array<boolean>(n).fill(false);
  const s = key(from);
  const g = key(to);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    if (u === g) break;
    done[u] = true;
    for (const e of edges[u]) {
      // never two hops in a row (a hop lands on a crossing: walk on from there)
      if (e.step.kind === "hop" && prev[u]?.step.kind === "hop") continue;
      const c = dist[u] + e.cost;
      if (c < dist[e.to]) {
        dist[e.to] = c;
        prev[e.to] = { from: u, step: e.step };
      }
    }
  }
  if (dist[g] === Infinity) return null;
  const steps: RouteStep[] = [];
  for (let v = g; v !== s; v = prev[v]!.from) steps.push(prev[v]!.step);
  steps.reverse();
  // a hop plays on in the direction of the walk after it; merge walks
  const out: RouteStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.kind === "hop") {
      const next = steps.slice(i + 1).find((x) => x.kind === "walk");
      out.push({ ...st, dir: next && next.kind === "walk" ? next.dir : "fwd" });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === "walk" && last.dir === st.dir) last.until = st.until;
    else out.push({ ...st });
  }
  return out;
}

/** Has the walk in `dir` reached forward time `until` (playing from `t`)? */
export function reached(t: number, dir: WalkDir, until: number, tol = 0.05): boolean {
  return dir === "fwd" ? t >= until - tol : t <= until + tol;
}

/** Route length in metres (walks) and number of hops — for tests and the debug line. */
export function routeLength(steps: RouteStep[], from: number, track: WalkTrack = WALK_TRACK): { m: number; hops: number } {
  let t = from;
  let m = 0;
  let hops = 0;
  for (const s of steps) {
    if (s.kind === "hop") {
      hops++;
      t = s.t;
    } else {
      m += Math.abs(distanceAt(s.until, track) - distanceAt(t, track));
      t = s.until;
    }
  }
  return { m, hops };
}
