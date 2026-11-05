import { describe, expect, it } from "vitest";
import { SUB_PRODUCTS } from "@/lib/catalog";
import { planRoute } from "./autoWalk";
import { SHOWROOM_RACKS } from "./showroomRacks";
import { WALK_TRACK } from "./walkTrack";

describe("showroom racks", () => {
  it("every rack item is a brand the catalog has (a product without brands: brand = product)", () => {
    for (const r of SHOWROOM_RACKS) {
      if (r.items === "catalog") continue;
      for (const it of r.items) {
        const subs = SUB_PRODUCTS[it.product];
        if (subs.length === 0) expect(it.brand).toBe(it.product);
        else expect(subs).toContain(it.brand);
      }
    }
  });

  it("exactly one rack opens the whole catalog; no football kits", () => {
    expect(SHOWROOM_RACKS.filter((r) => r.items === "catalog")).toHaveLength(1);
    for (const r of SHOWROOM_RACKS) if (r.items !== "catalog") for (const it of r.items) expect(it.product).not.toBe("Sport");
  });

  it("ids are unique", () => {
    expect(new Set(SHOWROOM_RACKS.map((r) => r.id)).size).toBe(SHOWROOM_RACKS.length);
  });

  it("every stop is on the shown walk (not past the loop point, not in a skipped stretch) and reachable from the start", () => {
    for (const r of SHOWROOM_RACKS) {
      const { t, yawDeg } = r.stop;
      expect(t).toBeGreaterThanOrEqual(WALK_TRACK.start);
      expect(t).toBeLessThan(WALK_TRACK.loop.from);
      for (const [a, b] of WALK_TRACK.skips ?? []) expect(t <= a || t >= b).toBe(true);
      expect(Math.abs(yawDeg)).toBeLessThanOrEqual(180);
      expect(planRoute(WALK_TRACK.start, t)).not.toBeNull();
    }
  });
});
