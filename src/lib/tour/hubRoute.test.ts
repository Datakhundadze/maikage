import { describe, expect, it } from "vitest";
import { DESK_TS, deskMomentAt, planHubRoute } from "./hubRoute";
import { posAt } from "./rackLabels";
import { SHOWROOM_RACKS } from "./showroomRacks";
import { WALK_TRACK } from "./walkTrack";

const walkSec = (from: number, steps: NonNullable<ReturnType<typeof planHubRoute>>) => {
  let t = from;
  let s = 0;
  for (const st of steps) {
    if (st.kind === "hop") t = st.t;
    else {
      s += Math.abs(st.until - t);
      t = st.until;
    }
  }
  return { sec: s, end: t };
};

describe("hub routes", () => {
  it("the desk moments are one spot", () => {
    const a = posAt(DESK_TS[0]);
    for (const t of DESK_TS) {
      const p = posAt(t);
      expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeLessThan(0.1);
    }
  });

  it("every route: at most one change of video, and only as the first step; then one walk", () => {
    const places = [WALK_TRACK.start, ...DESK_TS, ...SHOWROOM_RACKS.map((r) => r.stop.t)];
    for (const from of places)
      for (const r of SHOWROOM_RACKS) {
        const steps = planHubRoute(from, [r.stop.t])!;
        expect(steps).not.toBeNull();
        expect(steps.length).toBeLessThanOrEqual(2);
        expect(steps.filter((s) => s.kind === "hop").length).toBeLessThanOrEqual(1);
        if (steps.length === 2) expect(steps[0].kind).toBe("hop");
        expect(walkSec(from, steps).end).toBeCloseTo(r.stop.t, 1);
      }
  });

  it("from the desk every rack is a walk of under 52 s of video, inside one file, never across the cut-out stretch", () => {
    for (const r of SHOWROOM_RACKS) {
      const steps = planHubRoute(8, [r.stop.t])!;
      const { sec } = walkSec(8, steps);
      expect(sec).toBeLessThan(52);
      let t = 8;
      for (const st of steps) {
        if (st.kind === "hop") t = st.t;
        else {
          for (const [a, b] of WALK_TRACK.skips ?? []) expect(Math.min(t, st.until) >= b || Math.max(t, st.until) <= a).toBe(true);
          for (const p of WALK_TRACK.parts.slice(0, -1)) expect(Math.min(t, st.until) >= p.to - 0.02 || Math.max(t, st.until) <= p.to + 0.02).toBe(true);
          t = st.until;
        }
      }
    }
  });

  it("back to the operators ends at a desk moment", () => {
    for (const r of SHOWROOM_RACKS) {
      const steps = planHubRoute(r.stop.t, DESK_TS)!;
      expect(deskMomentAt(walkSec(r.stop.t, steps).end)).not.toBeNull();
    }
  });

  it("the entrance walks straight to the desk", () => {
    expect(planHubRoute(WALK_TRACK.start, DESK_TS)).toEqual([{ kind: "walk", dir: "fwd", until: 8 }]);
  });
});
