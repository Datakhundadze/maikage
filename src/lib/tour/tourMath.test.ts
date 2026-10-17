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
  turnRateFromStick,
  walkIntent,
  autoTurnMs,
  bobAt,
  FOOTFALLS,
  worldToPhotoYaw,
} from "./tourMath";
import { getNode, TOUR } from "./tourConfig";

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

describe("hold to walk", () => {
  it("walks while held past 50 %, either way", () => {
    expect(walkIntent(0)).toBeNull();
    expect(walkIntent(0.49)).toBeNull();
    expect(walkIntent(0.5)).toBe("forward");
    expect(walkIntent(1)).toBe("forward");
    expect(walkIntent(-0.7)).toBe("back");
  });

  it("keeps walking along the real chain s1 → s6 without turning by hand", () => {
    // each step lands facing its link's direction; the next push picks from there
    let node = getNode("s1");
    let view: number = TOUR.startYawDeg;
    const path = [node.id];
    for (let i = 0; i < 10; i++) {
      const link = pickLink(node.links, view, "forward");
      if (!link) break;
      view = link.yawDeg;
      node = getNode(link.to);
      path.push(node.id);
    }
    expect(path).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
  });

  it("walks back s6 → s1 after turning round once", () => {
    let node = getNode("s6");
    let view = node.links[0].yawDeg; // facing s5
    const path = [node.id];
    for (let i = 0; i < 10; i++) {
      const link = pickLink(node.links, view, "forward");
      if (!link) break;
      view = link.yawDeg;
      node = getNode(link.to);
      path.push(node.id);
    }
    expect(path).toEqual(["s6", "s5", "s4", "s3", "s2", "s1"]);
  });
});

describe("walking backward", () => {
  it("held back from s6 goes all the way to s1 (arrives facing away from the travel)", () => {
    let node = getNode("s6");
    let view = node.links[0].yawDeg + 180; // arrived at s6 facing away from s5
    const path = [node.id];
    for (let i = 0; i < 10; i++) {
      const link = pickLink(node.links, view, "back");
      if (!link) break;
      view = normDeg(link.yawDeg + 180);
      node = getNode(link.to);
      path.push(node.id);
    }
    expect(path).toEqual(["s6", "s5", "s4", "s3", "s2", "s1"]);
  });
});

describe("auto-turn before a step", () => {
  it("doesn't turn for a link straight ahead", () => {
    expect(autoTurnMs(0)).toBe(0);
    expect(autoTurnMs(STEERING.autoTurnMinDeg)).toBe(0);
    expect(autoTurnMs(-8)).toBe(0);
  });

  it("turns faster for small offsets, capped for large ones", () => {
    expect(autoTurnMs(15)).toBe(STEERING.autoTurnMinMs);
    expect(autoTurnMs(62)).toBeGreaterThan(STEERING.autoTurnMinMs);
    expect(autoTurnMs(62)).toBeLessThan(STEERING.autoTurnMaxMs);
    expect(autoTurnMs(100)).toBe(STEERING.autoTurnMaxMs);
    expect(autoTurnMs(-62)).toBe(autoTurnMs(62));
    expect(autoTurnMs(358)).toBe(0); // = −2°
  });
});

describe("head bob", () => {
  const cfg = TOUR.walk;
  it("starts and lands still", () => {
    for (const t of [-0.1, 0, 1, 1.2]) expect(bobAt(t, cfg)).toEqual({ dyPx: 0, rollDeg: 0, scale: 1 });
    const near = bobAt(0.01, cfg);
    expect(Math.abs(near.dyPx)).toBeLessThan(0.05);
  });

  it("dips at the two footfalls and sways from one foot to the other", () => {
    const [f1, f2] = FOOTFALLS.map((t) => bobAt(t, cfg));
    expect(f1.dyPx).toBeGreaterThan(cfg.bobPx * 0.6);
    expect(f2.dyPx).toBeGreaterThan(cfg.bobPx * 0.6);
    expect(Math.sign(f1.rollDeg)).toBe(-Math.sign(f2.rollDeg));
    expect(bobAt(0.5, cfg).dyPx).toBeCloseTo(0, 6); // between the steps
    for (let t = 0.01; t < 1; t += 0.01) {
      const b = bobAt(t, cfg);
      expect(b.dyPx).toBeGreaterThanOrEqual(0);
      expect(b.dyPx).toBeLessThanOrEqual(cfg.bobPx);
      expect(Math.abs(b.rollDeg)).toBeLessThanOrEqual(cfg.bobRollDeg);
      expect(b.scale).toBeGreaterThanOrEqual(1);
      expect(b.scale).toBeLessThanOrEqual(cfg.bobScale);
    }
  });
});

describe("link selection", () => {
  const links = [
    { to: "a", yawDeg: 0 },
    { to: "b", yawDeg: 90 },
    { to: "c", yawDeg: -150 },
  ];

  it("forward picks the link closest to the view within ±100°", () => {
    expect(pickLink(links, 10, "forward")?.to).toBe("a");
    expect(pickLink(links, 60, "forward")?.to).toBe("b"); // 30° from b, 60° from a
    expect(pickLink(links, -45, "forward")?.to).toBe("a");
    expect(pickLink(links, -51, "forward")?.to).toBe("a"); // a 51°, c 99°
    expect(pickLink([{ to: "a", yawDeg: 0 }], 101, "forward")).toBeNull();
  });

  it("back picks the link closest to the opposite direction", () => {
    expect(pickLink(links, 180, "back")?.to).toBe("a");
    expect(pickLink(links, 30, "back")?.to).toBe("c"); // behind = −150
    expect(pickLink(links, 90, "back")?.to).toBe("c"); // behind = −90: c 60°, a 90°
    expect(pickLink([{ to: "a", yawDeg: 0 }], 0, "back")).toBeNull(); // a is 180° from behind
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
    expect(pickLink(getNode("s1").links, 150, "forward")).toBeNull();
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
