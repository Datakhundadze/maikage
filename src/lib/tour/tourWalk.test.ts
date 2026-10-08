import { describe, it, expect } from "vitest";
import { WALK, easeInOutCubic, floorRingSquash, lerpYaw, phase } from "@/lib/tour/tourWalk";

describe("walk timeline", () => {
  it("fits in about 1.2 s and the zoom overlaps the start of the fade", () => {
    const fadeStart = WALK.rotateMs;
    const total = fadeStart + WALK.fadeMs + WALK.settleMs;
    expect(total).toBeLessThanOrEqual(1200);
    expect(WALK.zoomStartMs).toBeLessThan(fadeStart);
    expect(WALK.zoomStartMs + WALK.zoomMs).toBeGreaterThan(fadeStart);
  });
  it("phase and easing stay in [0, 1]", () => {
    expect(phase(-50, 0, 100)).toBe(0);
    expect(phase(50, 0, 100)).toBe(0.5);
    expect(phase(500, 0, 100)).toBe(1);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("lerpYaw", () => {
  it("takes the shorter way round", () => {
    const from = (350 * Math.PI) / 180;
    const to = (10 * Math.PI) / 180;
    expect((lerpYaw(from, to, 0.5) * 180) / Math.PI).toBeCloseTo(360, 6); // through 0°, not 180°
    expect(lerpYaw(1, 2, 1)).toBeCloseTo(2, 9);
  });
});

describe("floorRingSquash", () => {
  it("is sin(depression angle), clamped", () => {
    expect(floorRingSquash(-30)).toBeCloseTo(0.5, 6);
    expect(floorRingSquash(-22)).toBeCloseTo(Math.sin((22 * Math.PI) / 180), 6);
    expect(floorRingSquash(-2)).toBe(0.28);
    expect(floorRingSquash(-80)).toBe(0.8);
  });
});
