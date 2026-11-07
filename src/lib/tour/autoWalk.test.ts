import { describe, expect, it } from "vitest";
import { planRoute, reached, routeJumps, routeLength } from "./autoWalk";
import { WALK_TRACK, type WalkTrack } from "./walkTrack";

// a 20 s walk at 1 m/s; at t=2 the camera passes the spot of t=18 again
const T: WalkTrack = {
  duration: 20,
  parts: [{ from: 0, to: 20, base: "a", revEnd: 20 }],
  fps: 30,
  stepSec: 1,
  start: 0,
  loop: { from: 20, to: 0, revFrom: -1, revTo: 0 },
  headingDeg: new Array(21).fill(0),
  links: [{ a: 2, b: 18, yawDeg: 3 }],
};

describe("planRoute", () => {
  it("straight ahead: one forward walk", () => {
    expect(planRoute(1, 5, T)).toEqual([{ kind: "walk", dir: "fwd", until: 5 }]);
  });
  it("behind: one backward walk", () => {
    expect(planRoute(5, 1, T)).toEqual([{ kind: "walk", dir: "rev", until: 1 }]);
  });
  it("far along the walk but near through a crossing: hop across", () => {
    const r = planRoute(1, 17, T)!;
    // 1 → 2 forward, hop to 18, back to 17 (2 m + hop) instead of 16 m forward
    expect(r).toEqual([
      { kind: "walk", dir: "fwd", until: 2 },
      { kind: "hop", t: 18, dir: "rev", yawShift: 3 },
      { kind: "walk", dir: "rev", until: 17 },
    ]);
    expect(routeLength(r, 1, T)).toEqual({ m: 2, hops: 1 });
  });
  it("the way back uses the crossing the other way round", () => {
    const r = planRoute(17, 1, T)!;
    expect(r[1]).toEqual({ kind: "hop", t: 2, dir: "rev", yawShift: -3 });
  });
  it("already there: nothing to do", () => {
    expect(planRoute(4, 4, T)).toEqual([]);
  });
  it("on the real track every place is reachable from the start, at a sensible length", () => {
    for (let t = 5; t < WALK_TRACK.loop.from; t += 7.3) {
      const r = planRoute(WALK_TRACK.start, t);
      expect(r).not.toBeNull();
      const { m } = routeLength(r!, WALK_TRACK.start);
      // never longer than walking the whole take
      expect(m).toBeLessThan(WALK_TRACK.distM![WALK_TRACK.distM!.length - 1]);
    }
  });
});

describe("reached", () => {
  it("forward and backward", () => {
    expect(reached(4.96, "fwd", 5)).toBe(true);
    expect(reached(4.8, "fwd", 5)).toBe(false);
    expect(reached(5.04, "rev", 5)).toBe(true);
    expect(reached(5.3, "rev", 5)).toBe(false);
  });
});

describe("routeJumps", () => {
  it("a straight walk inside one part: nothing to prepare", () => {
    expect(routeJumps(1, "fwd", [{ kind: "walk", dir: "fwd", until: 5 }], T)).toEqual([]);
  });
  it("turning round at the start and a step across", () => {
    const r = planRoute(5, 1, T)!;
    expect(routeJumps(5, "fwd", r, T)).toEqual([{ t: 5, dir: "rev" }]);
    const h = planRoute(1, 17, T)!;
    expect(routeJumps(1, "fwd", h, T)).toEqual([{ t: 18, dir: "rev" }]);
  });
  it("on the real track: a long forward walk crosses the part boundaries into the next files", () => {
    const ps = WALK_TRACK.parts;
    const j = routeJumps(10, "fwd", [{ kind: "walk", dir: "fwd", until: ps[2].from + 5 }]);
    expect(j.map((x) => x.t)).toEqual([ps[1].from, ps[2].from]);
  });
});
