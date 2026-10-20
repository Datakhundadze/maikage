import { describe, expect, it } from "vitest";
import {
  followStep,
  followTarget,
  globalTime,
  junctionChoice,
  branchToPrime,
  junctionsAhead,
  localTime,
  partIndexAt,
  pathPointAt,
  facingFromView,
  footprints,
  distanceAt,
  timeAtDistance,
  planWalk,
  headingAt,
  loopJump,
  vfovFor,
  walkFromStick,
  WALK_FEEL,
  WALK_TRACK,
  type WalkTrack,
} from "./walkTrack";
import { angleDiff } from "./tourMath";

const T: WalkTrack = {
  duration: 10,
  parts: [
    { from: 0, to: 6, base: "a", revEnd: 6 },
    { from: 6, to: 10, base: "b", revEnd: 4 },
  ],
  fps: 30, stepSec: 1, start: 1, loop: { from: 9, to: 2 }, headingDeg: [0, 0, 90, 180, -170, -170, 0, 0, 0, 0, 0] };

describe("walk track data", () => {
  it("has one heading per step over the whole video", () => {
    expect(WALK_TRACK.headingDeg.length).toBe(Math.round(WALK_TRACK.duration / WALK_TRACK.stepSec) + 1);
    for (const h of WALK_TRACK.headingDeg) expect(Math.abs(h)).toBeLessThanOrEqual(180);
  });
  it("starts inside the video and loops forward from late to early", () => {
    const { start, loop, duration } = WALK_TRACK;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(loop.to).toBeGreaterThanOrEqual(0);
    expect(loop.from).toBeLessThan(duration);
    expect(loop.from - loop.to).toBeGreaterThan(30);
  });
  it("walks into the shop at the start (heading near world 0)", () => {
    expect(Math.abs(headingAt(WALK_TRACK.start + 1))).toBeLessThan(25);
  });
  it("heading changes smoothly (no jumps over 60° between samples, the U-turns are quick)", () => {
    const h = WALK_TRACK.headingDeg;
    // up to the loop point (after it the video is never shown)
    const end = Math.round(WALK_TRACK.loop.from / WALK_TRACK.stepSec);
    for (let i = 1; i <= end; i++) expect(Math.abs(angleDiff(h[i], h[i - 1]))).toBeLessThan(60);
  });
});

describe("headingAt", () => {
  it("interpolates along the short way round", () => {
    expect(headingAt(1.5, T)).toBeCloseTo(45);
    expect(headingAt(3.5, T)).toBeCloseTo(-175); // 180 → −170 across ±180
  });
  it("clamps outside the track", () => {
    expect(headingAt(-3, T)).toBe(0);
    expect(headingAt(99, T)).toBe(0);
  });
});

describe("walkFromStick", () => {
  it("stands inside the dead zone", () => {
    expect(walkFromStick(0)).toBeNull();
    expect(walkFromStick(WALK_FEEL.walkAt - 0.01)).toBeNull();
    expect(walkFromStick(-WALK_FEEL.walkAt + 0.01)).toBeNull();
  });
  it("walks faster the further the stick goes", () => {
    const slow = walkFromStick(0.4)!;
    const fast = walkFromStick(1)!;
    expect(slow.intent).toBe("ahead");
    expect(fast.rate).toBeCloseTo(WALK_FEEL.maxRate);
    expect(slow.rate).toBeLessThan(fast.rate);
    expect(walkFromStick(WALK_FEEL.walkAt)!.rate).toBeCloseTo(WALK_FEEL.minRate);
  });
  it("pulls back = step back", () => {
    expect(walkFromStick(-1)!.intent).toBe("back");
  });
});

describe("parts and forward / reversed video time", () => {
  it("each real reversed video ends within a few frames of its forward one (a file may run a frame past `to`)", () => {
    for (const p of WALK_TRACK.parts) expect(Math.abs(p.revEnd - (p.to - p.from))).toBeLessThan(0.15);
  });
  it("the parts cover the walk end to end", () => {
    const ps = WALK_TRACK.parts;
    expect(ps[0].from).toBe(0);
    for (let i = 1; i < ps.length; i++) expect(ps[i].from).toBe(ps[i - 1].to);
    expect(ps[ps.length - 1].to).toBeGreaterThanOrEqual(WALK_TRACK.duration - 0.2);
  });
  it("finds the part, going on into the next one at a boundary", () => {
    expect(partIndexAt(3, "fwd", T)).toBe(0);
    expect(partIndexAt(6, "fwd", T)).toBe(1);
    expect(partIndexAt(6, "rev", T)).toBe(0);
    expect(partIndexAt(7, "rev", T)).toBe(1);
  });
  it("maps both ways in every part", () => {
    expect(localTime(3, 0, "fwd", T)).toBe(3);
    expect(localTime(3, 0, "rev", T)).toBe(3);
    expect(localTime(7, 1, "fwd", T)).toBe(1);
    expect(localTime(7, 1, "rev", T)).toBe(3);
    for (const [t, p] of [[0.5, 0], [5.9, 0], [6.5, 1], [9.9, 1]] as const)
      for (const d of ["fwd", "rev"] as const) expect(globalTime(localTime(t, p, d, T), p, d, T)).toBeCloseTo(t);
  });
});

describe("loopJump", () => {
  it("going forward past the loop end continues after its start", () => {
    expect(loopJump(8.9, "fwd", T)).toBeNull();
    expect(loopJump(9.2, "fwd", T)).toBeCloseTo(2.2);
  });
  it("going backward past the loop start continues before its end", () => {
    expect(loopJump(2.1, "rev", T)).toBeNull();
    expect(loopJump(1.8, "rev", T)).toBeCloseTo(8.8);
  });
  it("backward from the very start goes round the loop the other way", () => {
    const j = loopJump(WALK_TRACK.loop.to, "rev");
    expect(j).not.toBeNull();
    expect(j!).toBeGreaterThan(WALK_TRACK.loop.to);
    expect(j!).toBeLessThanOrEqual(WALK_TRACK.loop.from);
  });
  it("a jump never lands on another jump", () => {
    for (let t = 0; t <= WALK_TRACK.duration; t += 0.5) {
      for (const d of ["fwd", "rev"] as const) {
        const j = loopJump(t, d);
        if (j !== null && t < WALK_TRACK.duration - 1 && t > 1) expect(loopJump(j, d)).toBeNull();
      }
    }
  });
});

describe("following the path", () => {
  it("looks ahead walking face-first, at the spot stepping back", () => {
    expect(followTarget(1, "fwd", "along", { lookAheadSec: 1 }, T)).toBeCloseTo(90);
    expect(followTarget(1, "rev", "along", { lookAheadSec: 1 }, T)).toBeCloseTo(0);
  });
  it("facing against the walk looks back along it", () => {
    // walking back the way the walk came (reversed video), face-first: heading at t−1 + 180
    expect(followTarget(3, "rev", "against", { lookAheadSec: 1 }, T)).toBeCloseTo(-90);
    // stepping back while facing against: heading at t + 180
    expect(followTarget(0.5, "fwd", "against", { lookAheadSec: 1 }, T)).toBeCloseTo(180);
  });
  it("turns toward the target, never faster than the cap", () => {
    const cfg = { followMaxDegPerSec: 100, followEaseMs: 500 };
    const y = followStep(0, 170, 100, cfg);
    expect(y).toBeCloseTo(10); // capped: 100 °/s × 0.1 s
    expect(followStep(0, -170, 100, cfg)).toBeCloseTo(-10);
    // close to the target it eases instead
    const near = followStep(0, 2, 100, cfg);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(2);
  });
  it("a U-turn completes within five seconds", () => {
    let yaw = 90;
    for (let i = 0; i < 100; i++) yaw = followStep(yaw, -90, 50);
    expect(Math.abs(angleDiff(yaw, -90))).toBeLessThan(5);
  });
});

describe("vfovFor", () => {
  it("portrait phones get the tall cap, wide screens about 100° across", () => {
    expect(vfovFor(390, 700)).toBe(100);
    const v = vfovFor(1600, 800);
    const h = (2 * Math.atan(Math.tan((v / 2) * (Math.PI / 180)) * 2) * 180) / Math.PI;
    expect(h).toBeCloseTo(100, 0);
  });
});

describe("turning round", () => {
  it("knows which way the visitor faces", () => {
    expect(facingFromView(10, 0.5, T)).toBe("along"); // walk heads 0° there
    expect(facingFromView(170, 0.5, T)).toBe("against");
    // just walked along: a sideways view (110°) still counts as along; just walked against: 70° still against
    expect(facingFromView(110, 0.5, T, "along")).toBe("along");
    expect(facingFromView(70, 0.5, T, "against")).toBe("against");
    expect(facingFromView(150, 0.5, T, "along")).toBe("against");
  });
  it("ahead plays the video the way you face; back the other way", () => {
    expect(planWalk("ahead", "along")).toBe("fwd");
    expect(planWalk("ahead", "against")).toBe("rev");
    expect(planWalk("back", "along")).toBe("rev");
    expect(planWalk("back", "against")).toBe("fwd");
  });
  it("turned round at the start, pushing up goes round the loop the other way", () => {
    const t = WALK_TRACK.start + 0.5;
    const facing = facingFromView(headingAt(t) + 180, t);
    const dir = planWalk("ahead", facing);
    expect(dir).toBe("rev");
    expect(loopJump(WALK_TRACK.loop.to - 0.1, dir)).not.toBeNull();
  });
});

describe("footprints", () => {
  const cfg = { startM: 0.5, lengthM: 2, strideM: 0.5, footOffsetM: 0.1 };
  it("lie ahead along a straight walk, alternating feet", () => {
    const fp = footprints(0, "fwd", cfg, T); // heading 0 for the first second
    expect(fp.length).toBe(5); // 0.5, 1.0 … 2.5 m
    expect(fp[0].z).toBeCloseTo(-0.5, 1);
    expect(fp[0].side).not.toBe(fp[1].side);
    expect(Math.abs(fp[0].x)).toBeCloseTo(0.1, 2);
  });
  it("stay put on the floor while walking (come closer by the distance walked)", () => {
    const a = footprints(0.1, "fwd", cfg, T);
    const b = footprints(0.3, "fwd", cfg, T); // 0.2 m further
    const pa = a.find((p) => p.r > 1)!;
    const pb = b.find((p) => Math.abs(p.r - (pa.r - 0.2)) < 1e-6)!;
    expect(pb).toBeDefined();
    expect(pb.side).toBe(pa.side);
  });
  it("walking the reversed video, prints point behind (the way you move)", () => {
    const fp = footprints(0.5, "rev", cfg, T);
    expect(fp[0].z).toBeGreaterThan(0.3);
  });
  it("cover the configured stretch on the real track", () => {
    const g = WALK_FEEL.steps;
    const fp = footprints(WALK_TRACK.start, "fwd");
    expect(fp.length).toBeGreaterThanOrEqual(Math.floor(g.lengthM / g.strideM));
    for (const p of fp) {
      expect(p.r).toBeGreaterThanOrEqual(g.startM - 1e-9);
      expect(p.r).toBeLessThanOrEqual(g.startM + g.lengthM + 1e-9);
    }
  });
  it("distance and time map onto each other on the real track", () => {
    for (const t of [2, 10.5, 40, 70]) expect(timeAtDistance(distanceAt(t))).toBeCloseTo(t, 1);
    const d = WALK_TRACK.distM!;
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    // a plausible walking pace overall (m/s)
    const pace = d[d.length - 1] / WALK_TRACK.duration;
    expect(pace).toBeGreaterThan(0.4);
    expect(pace).toBeLessThan(1.2);
  });
});

describe("junctions", () => {
  // track with a link: at t=2 (heading 90 there) the walk passes the spot of t=8 (heading 0)
  const J: WalkTrack = { ...T, links: [{ a: 2, b: 8, yawDeg: 0 }] };
  it("looking down the other pass at the junction goes that way", () => {
    // walking forward through t=2, the way ahead is 90°; the visitor looks at 0° = the other pass forward
    const c = junctionChoice(1.9, 2.1, "fwd", 0, undefined, J);
    expect(c).toEqual({ t: 8, dir: "fwd", yawShift: 0 });
  });
  it("…or along the other pass backward", () => {
    const c = junctionChoice(1.9, 2.1, "fwd", 180, undefined, J);
    expect(c).toEqual({ t: 8, dir: "rev", yawShift: 0 });
  });
  it("looking ahead (or not clearly elsewhere) carries on", () => {
    expect(junctionChoice(1.9, 2.1, "fwd", 90, undefined, J)).toBeNull();
    expect(junctionChoice(1.9, 2.1, "fwd", 60, undefined, J)).toBeNull();
  });
  it("only when the junction is passed in this frame, both ways round", () => {
    expect(junctionChoice(2.1, 2.3, "fwd", 0, undefined, J)).toBeNull();
    expect(junctionChoice(8.1, 7.9, "rev", 90, undefined, J)).toEqual({ t: 2, dir: "fwd", yawShift: -0 });
  });
  it("brings the other pass's heading into the current frame", () => {
    const K: WalkTrack = { ...T, links: [{ a: 2, b: 8, yawDeg: 20 }] };
    // the other pass forward heads 0° in its own frame = −20° here
    expect(junctionChoice(1.9, 2.1, "fwd", -20, undefined, K)).toEqual({ t: 8, dir: "fwd", yawShift: 20 });
  });
  it("gets ready the branch the view leans toward before the junction", () => {
    // 1 m before the junction, the view turned 60° left of the way ahead (90°), toward the other pass forward (0°)
    expect(branchToPrime(1, "fwd", 30, 3, J)).toEqual({ t: 8, dir: "fwd", yawShift: 0 });
    expect(branchToPrime(1, "fwd", 150, 3, J)).toEqual({ t: 8, dir: "rev", yawShift: 0 });
    // straight ahead: nothing to get ready; junction too far: nothing either
    expect(branchToPrime(1, "fwd", 90, 3, J)).toBeNull();
    expect(branchToPrime(1, "fwd", 30, 0.5, J)).toBeNull();
  });
  it("lists junctions ahead with their distance", () => {
    const a = junctionsAhead(1, "fwd", 5, J);
    expect(a.map((x) => x.at)).toEqual([2]);
    expect(a[0].distM).toBeCloseTo(1);
    expect(junctionsAhead(1, "rev", 5, J)).toEqual([]);
  });
  it("the real links join different times of the walk", () => {
    for (const l of WALK_TRACK.links ?? []) {
      expect(Math.abs(l.b - l.a)).toBeGreaterThan(5);
      expect(Math.abs(l.yawDeg)).toBeLessThan(10);
    }
    expect((WALK_TRACK.links ?? []).length).toBeGreaterThan(5);
  });
  it("pathPointAt walks along the heading", () => {
    const p = pathPointAt(0, "fwd", 0.5, T);
    expect(p.z).toBeCloseTo(-0.5, 2);
    expect(p.x).toBeCloseTo(0, 2);
  });
});
