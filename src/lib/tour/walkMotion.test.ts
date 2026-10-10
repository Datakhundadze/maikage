import { describe, it, expect } from "vitest";
import { applyLook, easeVelocity, keysToStick, MAX_DT, normalizeStick, targetVelocity } from "@/lib/tour/walkMotion";
import type { Vec2 } from "@/lib/tour/walkBounds";

const deg = (d: number) => (d * Math.PI) / 180;

describe("targetVelocity", () => {
  it("forward at yaw 0 is −z; strafe right is +x", () => {
    const f = targetVelocity({ forward: 1, strafe: 0 }, 0, 1.2);
    expect(f[0]).toBeCloseTo(0, 9);
    expect(f[1]).toBeCloseTo(-1.2, 9);
    const r = targetVelocity({ forward: 0, strafe: 1 }, 0, 1.2);
    expect(r[0]).toBeCloseTo(1.2, 9);
    expect(r[1]).toBeCloseTo(0, 9);
  });
  it("follows the camera yaw (90° left → forward is −x)", () => {
    const f = targetVelocity({ forward: 1, strafe: 0 }, deg(90), 1);
    expect(f[0]).toBeCloseTo(-1, 9);
    expect(f[1]).toBeCloseTo(0, 9);
  });
  it("diagonals are not faster", () => {
    const v = targetVelocity({ forward: 1, strafe: 1 }, 0, 1.2);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1.2, 9);
    expect(Math.hypot(...Object.values(normalizeStick({ forward: 0.3, strafe: 0.4 })))).toBeCloseTo(0.5, 9);
  });
});

describe("easeVelocity", () => {
  it("eases in to top speed in about accelTime, and stops", () => {
    let v: Vec2 = [0, 0];
    const target: Vec2 = [0, -1.2];
    const dt = 1 / 60;
    let t = 0;
    while (Math.hypot(v[0], v[1]) < 1.2 * 0.95) {
      v = easeVelocity(v, target, dt, 0.25);
      t += dt;
    }
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.3);
    for (let i = 0; i < 120; i++) v = easeVelocity(v, [0, 0], dt, 0.25);
    expect(v).toEqual([0, 0]);
  });
  it("is frame-rate independent and caps long frames", () => {
    let a: Vec2 = [0, 0];
    for (let i = 0; i < 6; i++) a = easeVelocity(a, [1, 0], 1 / 60, 0.25);
    const b = easeVelocity([0, 0], [1, 0], 6 / 60, 0.25);
    expect(a[0]).toBeCloseTo(b[0], 9);
    // a 2 s hitch integrates as MAX_DT only
    expect(easeVelocity([0, 0], [1, 0], 2, 0.25)[0]).toBeCloseTo(easeVelocity([0, 0], [1, 0], MAX_DT, 0.25)[0], 9);
  });
});

describe("applyLook", () => {
  it("drag right turns right, drag up looks up, pitch is limited", () => {
    const r = applyLook(0, 0, 100, 0, 0.005, deg(60));
    expect(r.yaw).toBeLessThan(0);
    const u = applyLook(0, 0, 0, -100, 0.005, deg(60));
    expect(u.pitch).toBeGreaterThan(0);
    expect(applyLook(0, 0, 0, -10000, 0.005, deg(60)).pitch).toBeCloseTo(deg(60), 9);
    expect(applyLook(0, 0, 0, 10000, 0.005, deg(60)).pitch).toBeCloseTo(-deg(60), 9);
  });
});

describe("keysToStick", () => {
  it("maps WASD and arrows", () => {
    expect(keysToStick(new Set(["KeyW"]))).toEqual({ forward: 1, strafe: 0 });
    expect(keysToStick(new Set(["ArrowDown", "ArrowLeft"]))).toEqual({ forward: -1, strafe: -1 });
    expect(keysToStick(new Set(["KeyW", "KeyS"]))).toEqual({ forward: 0, strafe: 0 });
    expect(keysToStick(new Set(["KeyD"]))).toEqual({ forward: 0, strafe: 1 });
  });
});
