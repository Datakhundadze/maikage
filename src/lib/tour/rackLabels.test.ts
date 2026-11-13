import { describe, expect, it } from "vitest";
import { angleDiff } from "./tourMath";
import { labelView, RACK_AHEAD_M, rackLabels } from "./rackLabels";

describe("rack labels", () => {
  const labels = rackLabels();

  it("one label per rack, inside the shop", () => {
    expect(labels).toHaveLength(19);
    for (const l of labels) {
      expect(Number.isFinite(l.x) && Number.isFinite(l.z)).toBe(true);
      expect(Math.hypot(l.x, l.z)).toBeLessThan(25);
    }
  });

  it("seen from its own stop, a label is straight where the stop looks, RACK_AHEAD_M away", () => {
    for (const l of labels) {
      const v = labelView(l, l.rack.stop.t);
      expect(Math.abs(angleDiff(v.yawDeg, l.rack.stop.yawDeg))).toBeLessThan(0.5);
      expect(v.distM).toBeCloseTo(RACK_AHEAD_M, 3);
      expect(v.pitchDeg).toBeLessThan(0);
    }
  });
});
