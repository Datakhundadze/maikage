import { describe, it, expect } from "vitest";
import {
  applyDeadZone,
  applyLook,
  easeTurnRate,
  easeVelocity,
  joystickToInput,
  keysToStick,
  MAX_DT,
  normalizeStick,
  targetTurnRate,
  targetVelocity,
} from "@/lib/tour/walkMotion";
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
  it("W/S and ↑/↓ walk, A/D and ←/→ turn, Q/E strafe", () => {
    expect(keysToStick(new Set(["KeyW"]))).toEqual({ forward: 1, strafe: 0, turn: 0 });
    expect(keysToStick(new Set(["ArrowDown", "ArrowLeft"]))).toEqual({ forward: -1, strafe: 0, turn: -1 });
    expect(keysToStick(new Set(["KeyW", "KeyS"]))).toEqual({ forward: 0, strafe: 0, turn: 0 });
    expect(keysToStick(new Set(["KeyD"]))).toEqual({ forward: 0, strafe: 0, turn: 1 });
    expect(keysToStick(new Set(["ArrowRight"]))).toEqual({ forward: 0, strafe: 0, turn: 1 });
    expect(keysToStick(new Set(["KeyQ"]))).toEqual({ forward: 0, strafe: -1, turn: 0 });
    expect(keysToStick(new Set(["KeyE", "KeyW"]))).toEqual({ forward: 1, strafe: 1, turn: 0 });
  });
});

describe("joystick mapping (follow steering)", () => {
  const DZ = 0.12;

  it("dead zone on each axis: small deflections do nothing, response starts at 0 at its edge", () => {
    expect(joystickToInput({ x: 0.1, y: -0.11 }, DZ)).toEqual({ forward: 0, strafe: 0, turn: 0 });
    expect(applyDeadZone(DZ, DZ)).toBe(0);
    expect(applyDeadZone(-DZ, DZ)).toBe(0);
    expect(applyDeadZone(DZ + 0.01, DZ)).toBeCloseTo(0.01 / (1 - DZ), 12);
    expect(applyDeadZone(-1, DZ)).toBe(-1);
    expect(applyDeadZone(0.56, DZ)).toBeCloseTo(0.5, 12);
  });

  it("pure forward gives zero turn, even with a little sideways wobble", () => {
    for (const x of [0, 0.05, -0.1, 0.119]) {
      const i = joystickToInput({ x, y: 1 }, DZ);
      expect(i.turn).toBe(0);
      expect(i.forward).toBe(1);
      expect(Math.abs(targetTurnRate(i.turn, 90))).toBe(0);
    }
  });

  it("pure sideways gives zero translation (turns in place, never strafes)", () => {
    for (const [x, y] of [
      [1, 0],
      [-1, 0],
      [0.7, 0.1],
      [-0.4, -0.11],
    ]) {
      const i = joystickToInput({ x, y }, DZ);
      expect(i.forward).toBe(0);
      expect(i.strafe).toBe(0);
      expect(i.turn).not.toBe(0);
      expect(Math.hypot(...targetVelocity(i, deg(37), 1.2))).toBe(0);
    }
  });

  it("full deflection gives the max turn rate; stick right turns right (yaw decreases)", () => {
    expect(targetTurnRate(joystickToInput({ x: 1, y: 0 }, DZ).turn, 90)).toBeCloseTo(-deg(90), 12);
    expect(targetTurnRate(joystickToInput({ x: -1, y: 0 }, DZ).turn, 90)).toBeCloseTo(deg(90), 12);
    // half way (after the dead zone) → half rate, proportional
    expect(targetTurnRate(joystickToInput({ x: 0.56, y: 0 }, DZ).turn, 90)).toBeCloseTo(-deg(45), 12);
  });

  it("stick left turns the view left also when walking backward", () => {
    const back = joystickToInput({ x: -0.8, y: -0.6 }, DZ);
    expect(back.forward).toBeLessThan(0);
    expect(targetTurnRate(back.turn, 90)).toBeGreaterThan(0);
    const fwd = joystickToInput({ x: -0.8, y: 0.6 }, DZ);
    expect(Math.sign(targetTurnRate(fwd.turn, 90))).toBe(Math.sign(targetTurnRate(back.turn, 90)));
  });

  it("diagonal forward-right walks and turns at once", () => {
    const i = joystickToInput({ x: Math.SQRT1_2, y: Math.SQRT1_2 }, DZ);
    expect(i.forward).toBeGreaterThan(0.6);
    expect(i.turn).toBeCloseTo(i.forward, 12);
    expect(i.strafe).toBe(0);
  });
});

describe("easeTurnRate", () => {
  it("eases in and out within about turnSmoothTime and stops exactly", () => {
    const dt = 1 / 60;
    const max = deg(90);
    let r = 0;
    let t = 0;
    while (Math.abs(r) < max * 0.95) {
      r = easeTurnRate(r, -max, dt, 0.12);
      t += dt;
    }
    expect(t).toBeGreaterThan(0.09);
    expect(t).toBeLessThan(0.15);
    for (let i = 0; i < 60; i++) r = easeTurnRate(r, 0, dt, 0.12);
    expect(r).toBe(0);
  });

  it("holding full right for 1 s turns about 90°", () => {
    const dt = 1 / 60;
    let r = 0;
    let yaw = 0;
    for (let i = 0; i < 60; i++) {
      r = easeTurnRate(r, targetTurnRate(1, 90), dt, 0.12);
      yaw += r * dt;
    }
    // released: the short ease-out adds back roughly what the ease-in lost
    for (let i = 0; i < 60; i++) {
      r = easeTurnRate(r, 0, dt, 0.12);
      yaw += r * dt;
    }
    expect(yaw / deg(1)).toBeGreaterThan(-93);
    expect(yaw / deg(1)).toBeLessThan(-87);
  });
});
