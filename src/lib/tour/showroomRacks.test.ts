import { describe, expect, it } from "vitest";
import { SUB_PRODUCTS } from "@/lib/catalog";
import { bearingDeg, nearestOnRack, nearestRack, positionAt, SHOWROOM_RACKS, type ShowroomRack } from "./showroomRacks";
import { WALK_TRACK } from "./walkTrack";

describe("showroom racks", () => {
  it("every rack item is a brand the catalog has", () => {
    for (const r of SHOWROOM_RACKS) {
      if (r.items === "catalog") continue;
      for (const it of r.items) expect(SUB_PRODUCTS[it.product]).toContain(it.brand);
    }
  });

  it("exactly one rack opens the whole catalog", () => {
    expect(SHOWROOM_RACKS.filter((r) => r.items === "catalog")).toHaveLength(1);
  });

  it("the walk has a position for every step and passes near every rack", () => {
    expect(WALK_TRACK.posM!.length).toBe(WALK_TRACK.headingDeg.length * 2);
    for (const r of SHOWROOM_RACKS) {
      let best = Infinity;
      for (let t = 0; t <= WALK_TRACK.duration; t += 0.2) best = Math.min(best, nearestOnRack(positionAt(t)!, r).dist);
      expect(best).toBeLessThan(2.0);
    }
  });

  it("positions interpolate between steps", () => {
    const a = positionAt(10)!;
    const b = positionAt(10.2)!;
    const m = positionAt(10.1)!;
    expect(m.x).toBeCloseTo((a.x + b.x) / 2, 5);
  });

  it("nearest point stays on the rack, off its ends", () => {
    const r: ShowroomRack = { id: "t", title: "t", a: [0, 0], b: [10, 0], items: "catalog" };
    expect(nearestOnRack({ x: 5, z: 2 }, r)).toEqual({ x: 5, z: 0, dist: 2 });
    expect(nearestOnRack({ x: -5, z: 0 }, r).x).toBeCloseTo(1.5);
    expect(nearestRack({ x: 5, z: 3 }, 2, [r])).toBeNull();
    expect(nearestRack({ x: 5, z: 1 }, 2, [r])).toBe(r);
  });

  it("bearing: 0 toward −z, 90 toward +x", () => {
    expect(bearingDeg({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(bearingDeg({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(90);
  });
});
