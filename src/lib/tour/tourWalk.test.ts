import { describe, it, expect } from "vitest";
import { WALK, easeInOutCubic, floorRingSquash, lerpYaw, magnifiedFovDeg, phase } from "@/lib/tour/tourWalk";

describe("walk timeline", () => {
  it("forward and back each fit in about 1.2 s", () => {
    const forward = Math.max(WALK.turnMs, WALK.zoomStartMs + WALK.zoomMs) + WALK.fadeMs;
    expect(forward).toBeLessThanOrEqual(1200);
    expect(Math.max(WALK.fadeMs, WALK.backZoomMs)).toBeLessThanOrEqual(1200);
  });
  it("the forward snapshot keeps pushing in; the back one pulls out", () => {
    expect(WALK.fadeScaleForward).toBeGreaterThan(1);
    expect(WALK.fadeScaleBack).toBeLessThan(1);
  });
  it("phase and easing stay in [0, 1]", () => {
    expect(phase(-50, 0, 100)).toBe(0);
    expect(phase(50, 0, 100)).toBe(0.5);
    expect(phase(500, 0, 100)).toBe(1);
    expect(phase(10, 0, 0)).toBe(1);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("magnifiedFovDeg", () => {
  it("magnifies on-screen size by m (tangent of the half-FOV)", () => {
    const fov = 46;
    const m = 1.63;
    const f2 = magnifiedFovDeg(fov, m);
    const t = (d: number) => Math.tan((d * Math.PI) / 360);
    expect(t(fov) / t(f2)).toBeCloseTo(m, 9);
    expect(magnifiedFovDeg(fov, 1)).toBeCloseTo(fov, 9);
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
