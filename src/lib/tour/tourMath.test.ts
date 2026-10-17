import { describe, expect, it } from "vitest";
import {
  angleDiff,
  applyDeadZone,
  easeToward,
  keysToStick,
  mergeSticks,
  normDeg,
  photoToWorldYaw,
  pickLink,
  STEERING,
  stepFromStick,
  turnRateFromStick,
  worldToPhotoYaw,
  type StepIntent,
  type StepLatch,
} from "./tourMath";
import { getNode } from "./tourConfig";

describe("angles", () => {
  it("normalises into (−180, 180]", () => {
    expect(normDeg(0)).toBe(0);
    expect(normDeg(180)).toBe(180);
    expect(normDeg(-180)).toBe(180);
    expect(normDeg(270)).toBe(-90);
    expect(normDeg(-450)).toBe(-90);
    expect(normDeg(725)).toBe(5);
  });

  it("takes the short way round", () => {
    expect(angleDiff(170, -170)).toBe(-20);
    expect(angleDiff(-170, 170)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
  });

  it("converts between world and photo yaw", () => {
    expect(worldToPhotoYaw(0, -98.1)).toBeCloseTo(-98.1);
    expect(photoToWorldYaw(172.5, -98.1)).toBeCloseTo(-89.4);
    for (const w of [-170, -45, 0, 33, 179]) expect(photoToWorldYaw(worldToPhotoYaw(w, 61), 61)).toBeCloseTo(w);
  });
});

describe("joystick turning", () => {
  it("ignores the dead zone (~12 %) and still reaches full deflection", () => {
    expect(applyDeadZone(0.1)).toBe(0);
    expect(applyDeadZone(-0.12)).toBe(0);
    expect(applyDeadZone(0.13)).toBeGreaterThan(0);
    expect(applyDeadZone(1)).toBe(1);
    expect(applyDeadZone(-1)).toBe(-1);
  });

  it("turns at most ~90°/s, right for + and left for −", () => {
    expect(turnRateFromStick(0.05)).toBe(0);
    expect(turnRateFromStick(1)).toBeCloseTo(STEERING.maxTurnDegPerSec);
    expect(turnRateFromStick(-1)).toBeCloseTo(-STEERING.maxTurnDegPerSec);
    expect(turnRateFromStick(0.5)).toBeGreaterThan(0);
    expect(turnRateFromStick(0.5)).toBeLessThan(STEERING.maxTurnDegPerSec / 2); // soft near the centre
  });

  it("eases the turn rate in, independent of the frame rate", () => {
    const at60 = Array.from({ length: 6 }).reduce<number>((v) => easeToward(v, 90, 1000 / 60), 0);
    const at30 = Array.from({ length: 3 }).reduce<number>((v) => easeToward(v, 90, 1000 / 30), 0);
    expect(at60).toBeGreaterThan(0);
    expect(at60).toBeLessThan(90);
    expect(at60).toBeCloseTo(at30, 5);
  });
});

describe("one step per push", () => {
  const run = (ys: number[]) => {
    let latch: StepLatch = { armed: true };
    const steps: (StepIntent | null)[] = [];
    for (const y of ys) {
      const r = stepFromStick(y, latch);
      latch = r.latch;
      steps.push(r.intent);
    }
    return steps.filter(Boolean);
  };

  it("steps once when pushed past 60 % and held", () => {
    expect(run([0, 0.3, 0.59, 0.61, 0.9, 1, 1, 0.8])).toEqual(["forward"]);
  });

  it("needs a release before the next step", () => {
    expect(run([0.9, 0.5, 0.9])).toEqual(["forward"]); // didn't come back below 30 %
    expect(run([0.9, 0.1, 0.9])).toEqual(["forward", "forward"]);
    expect(run([0.9, 0, -0.9])).toEqual(["forward", "back"]);
  });

  it("does nothing below the threshold", () => {
    expect(run([0.2, 0.5, -0.55, 0.59])).toEqual([]);
  });
});

describe("link selection", () => {
  const links = [
    { to: "a", yawDeg: 0 },
    { to: "b", yawDeg: 90 },
    { to: "c", yawDeg: -150 },
  ];

  it("forward picks the link closest to the view within ±50°", () => {
    expect(pickLink(links, 10, "forward")?.to).toBe("a");
    expect(pickLink(links, 60, "forward")?.to).toBe("b"); // 30° from b, 60° from a
    expect(pickLink(links, -45, "forward")?.to).toBe("a");
    expect(pickLink(links, -51, "forward")).toBeNull(); // a is 51° away, c 99°
  });

  it("back picks the link closest to the opposite direction", () => {
    expect(pickLink(links, 180, "back")?.to).toBe("a");
    expect(pickLink(links, 30, "back")?.to).toBe("c"); // behind = −150
    expect(pickLink(links, 90, "back")).toBeNull(); // behind = −90: a 90°, c 60° away
  });

  it("wraps around ±180°", () => {
    expect(pickLink([{ yawDeg: 179 }], -179, "forward")).not.toBeNull();
    expect(pickLink([{ yawDeg: -175 }], 5, "back")).not.toBeNull();
  });

  it("walks the real chain: facing a node's next link steps there", () => {
    const s3 = getNode("s3");
    const toS4 = s3.links.find((l) => l.to === "s4")!;
    expect(pickLink(s3.links, toS4.yawDeg, "forward")?.to).toBe("s4");
    // pulling back while facing s4 goes back toward s2
    expect(pickLink(s3.links, toS4.yawDeg, "back")?.to).toBe("s2");
    // looking at a wall with no link near: nothing
    expect(pickLink(getNode("s1").links, 120, "forward")).toBeNull();
  });
});

describe("keyboard", () => {
  it("maps arrows and WASD to the stick", () => {
    expect(keysToStick(new Set(["ArrowUp"]))).toEqual({ x: 0, y: 1 });
    expect(keysToStick(new Set(["KeyS", "KeyA"]))).toEqual({ x: -1, y: -1 });
    expect(keysToStick(new Set(["ArrowLeft", "ArrowRight"]))).toEqual({ x: 0, y: 0 });
    expect(keysToStick(new Set(["KeyQ"]))).toEqual({ x: 0, y: 0 });
  });

  it("merges joystick and keys by the larger deflection", () => {
    expect(mergeSticks({ x: 0.3, y: 0 }, { x: -1, y: 0 })).toEqual({ x: -1, y: 0 });
    expect(mergeSticks({ x: 0.3, y: 0.8 }, { x: 0, y: 0 })).toEqual({ x: 0.3, y: 0.8 });
  });
});
