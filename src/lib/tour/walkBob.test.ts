import { describe, it, expect } from "vitest";
import { BOB_REST, bobOffset, stepBob, type BobConfig, type BobState, type Foot } from "@/lib/tour/walkBob";
import { SCENE } from "@/lib/tour/sceneConfig";

const CFG: BobConfig = { stepLength: 0.7, verticalAmp: 0.03, lateralAmp: 0.015, rollDeg: 0.4, settleTime: 0.2 };
const SPEED = 1.2;
const DT = 1 / 60;

/** Walk at `speed` for `seconds`, collecting footfalls and the largest offsets. */
function walk(state: BobState, speed: number, seconds: number, dt = DT) {
  const feet: Foot[] = [];
  let maxY = 0;
  let maxLat = 0;
  let maxRoll = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const r = stepBob(state, speed * dt, dt, SPEED, CFG);
    state = r.state;
    feet.push(...r.footfalls);
    const o = bobOffset(state, CFG);
    maxY = Math.max(maxY, Math.abs(o.y));
    maxLat = Math.max(maxLat, Math.abs(o.lateral));
    maxRoll = Math.max(maxRoll, Math.abs(o.roll));
  }
  return { state, feet, maxY, maxLat, maxRoll };
}

describe("head bob", () => {
  it("is exactly zero at rest", () => {
    expect(bobOffset(BOB_REST, CFG)).toEqual({ y: 0, lateral: 0, roll: 0 });
    const still = walk(BOB_REST, 0, 2);
    expect(still.state.amp).toBe(0);
    expect(still.feet).toHaveLength(0);
    expect(bobOffset(still.state, CFG)).toEqual({ y: 0, lateral: 0, roll: 0 });
  });

  it("reaches the configured amplitudes at full speed", () => {
    const w = walk(BOB_REST, SPEED, 4);
    expect(w.state.amp).toBe(1);
    expect(w.maxY).toBeGreaterThan(0.029);
    expect(w.maxY).toBeLessThanOrEqual(0.03 + 1e-12);
    expect(w.maxLat).toBeGreaterThan(0.0149);
    expect(w.maxLat).toBeLessThanOrEqual(0.015 + 1e-12);
    expect((w.maxRoll * 180) / Math.PI).toBeLessThan(0.5);
  });

  it("scales with speed", () => {
    const slow = walk(BOB_REST, SPEED / 2, 4);
    expect(slow.state.amp).toBeCloseTo(0.5, 9);
    expect(slow.maxY).toBeLessThanOrEqual(0.015 + 1e-12);
  });

  it("returns exactly to zero within settleTime after stopping", () => {
    const moving = walk(BOB_REST, SPEED, 3).state;
    expect(bobOffset(moving, CFG).y).not.toBe(0);
    const stopped = walk(moving, 0, CFG.settleTime + DT);
    expect(stopped.state.amp).toBe(0);
    expect(bobOffset(stopped.state, CFG)).toEqual({ y: 0, lateral: 0, roll: 0 });
    // and it stays there
    expect(bobOffset(walk(stopped.state, 0, 1).state, CFG)).toEqual({ y: 0, lateral: 0, roll: 0 });
  });

  it("stops when the walker is blocked (no distance moved, keys still held)", () => {
    const moving = walk(BOB_REST, SPEED, 2).state;
    // pressed against a wall: the clamp returns the same position every frame
    const blocked = walk(moving, 0, 0.5);
    expect(blocked.state.amp).toBe(0);
    expect(blocked.feet).toHaveLength(0);
  });

  it("lands one footfall per stepLength travelled, alternating feet, at the low point", () => {
    for (const [dist, dt] of [
      [3, DT],
      [10, 0.1],
      [7.7, 1 / 144],
    ] as const) {
      const w = walk(BOB_REST, SPEED, dist / SPEED, dt);
      expect(w.feet).toHaveLength(Math.floor(w.state.distance / CFG.stepLength + 1e-9));
      expect(w.feet.length).toBe(Math.floor(dist / CFG.stepLength + 1e-6));
      w.feet.forEach((f, i) => expect(f).toBe(i % 2 === 0 ? "left" : "right"));
    }
    // one full bob cycle (both feet) per two steps; footfall = lowest point
    const at = (d: number): BobState => ({ distance: d, amp: 1, steps: 0 });
    expect(bobOffset(at(0.7), CFG).y).toBeCloseTo(-0.03, 12);
    expect(bobOffset(at(1.4), CFG).y).toBeCloseTo(-0.03, 12);
    expect(bobOffset(at(0.35), CFG).y).toBeCloseTo(0.03, 12);
    expect(bobOffset(at(0.35), CFG).lateral).toBeCloseTo(0.015, 12);
    expect(bobOffset(at(1.05), CFG).lateral).toBeCloseTo(-0.015, 12);
  });

  it("scene config keeps the tunables in range", () => {
    expect(SCENE.bob.stepLength).toBeCloseTo(0.7, 5);
    expect(SCENE.bob.verticalAmp).toBeCloseTo(0.03, 5);
    expect(SCENE.bob.lateralAmp).toBeCloseTo(0.015, 5);
    expect(SCENE.bob.rollDeg).toBeGreaterThan(0);
    expect(SCENE.bob.rollDeg).toBeLessThan(0.5);
    expect(SCENE.bob.settleTime).toBeLessThanOrEqual(0.2);
    expect(SCENE.footsteps.volume).toBeGreaterThan(0);
    expect(SCENE.footsteps.volume).toBeLessThanOrEqual(0.3);
  });
});
