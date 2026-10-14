import { describe, it, expect } from "vitest";
import {
  clampStep,
  closestOnArea,
  ensureInside,
  pointInArea,
  pointInPolygon,
  type Vec2,
  type WalkArea,
} from "@/lib/tour/walkBounds";
import { SCENE } from "@/lib/tour/sceneConfig";
import { buildWalkArea } from "@/lib/tour/roomGeometry";

const ROOM = buildWalkArea(SCENE);

const square: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
// concave "L": a 4×4 square with the top-right 2×2 quarter removed
const ell: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];

// deterministic pseudo-random numbers
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("pointInPolygon", () => {
  it("handles convex and concave shapes", () => {
    expect(pointInPolygon([1, 1], square)).toBe(true);
    expect(pointInPolygon([5, 1], square)).toBe(false);
    expect(pointInPolygon([1, 3], ell)).toBe(true);
    expect(pointInPolygon([3, 3], ell)).toBe(false); // the cut-out quarter
  });
});

describe("clampStep", () => {
  it("leaves steps that stay inside untouched", () => {
    expect(clampStep([1, 1], [1.5, 1.2], square)).toEqual([1.5, 1.2]);
  });

  it("slides along a wall instead of stopping dead", () => {
    // walking diagonally into the x = 4 wall keeps the z component
    const r = clampStep([3.9, 1], [4.3, 1.4], square);
    expect(pointInPolygon(r, square)).toBe(true);
    expect(r[0]).toBeCloseTo(4, 2);
    expect(r[1]).toBeCloseTo(1.4, 2);
  });

  it("never lets the walker into the concave cut-out", () => {
    const r = clampStep([1.9, 3], [2.6, 3], ell);
    expect(pointInPolygon(r, ell)).toBe(true);
    expect(r[0]).toBeLessThanOrEqual(2);
  });

  it("random walks with big steps never leave the polygon", () => {
    const rand = rng(42);
    for (const poly of [square, ell]) {
      let p: Vec2 = [1, 1];
      for (let i = 0; i < 4000; i++) {
        const a = rand() * Math.PI * 2;
        const step = 0.02 + rand() * 0.6; // up to 0.6 m in one frame
        const to: Vec2 = [p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step];
        p = clampStep(p, to, poly);
        expect(pointInPolygon(p, poly)).toBe(true);
      }
    }
  });

  it("walking straight at a boundary for a long time stops at it", () => {
    let p: Vec2 = [SCENE.start.x, SCENE.start.z];
    // walk toward −x (the clock wall) for 30 s at 1.2 m/s, 60 fps
    for (let i = 0; i < 1800; i++) p = clampStep(p, [p[0] - 0.02, p[1]], ROOM);
    expect(pointInArea(p, ROOM)).toBe(true);
    expect(p[0]).toBeCloseTo(SCENE.bounds.wallMargin, 1);
    expect(closestOnArea(p, ROOM).distance).toBeLessThan(0.05);
  });
});

describe("walk area with holes (racks)", () => {
  // 6×6 room, a 2×2 rack in the middle, and two overlapping racks on the right
  const area: WalkArea = {
    outer: [[0, 0], [6, 0], [6, 6], [0, 6]],
    holes: [
      [[2, 2], [4, 2], [4, 4], [2, 4]],
      [[4.5, 1], [5.5, 1], [5.5, 3], [4.5, 3]],
      [[4.8, 2.5], [5.8, 2.5], [5.8, 5], [4.8, 5]],
    ],
  };

  it("a point in a hole is not walkable", () => {
    expect(pointInArea([3, 3], area)).toBe(false);
    expect(pointInArea([5.2, 2.7], area)).toBe(false); // in both overlapping holes
    expect(pointInArea([1, 1], area)).toBe(true);
  });

  it("slides along a rack instead of entering it", () => {
    const r = clampStep([1.95, 3], [2.2, 3.3], area);
    expect(pointInArea(r, area)).toBe(true);
    expect(r[0]).toBeCloseTo(2, 2);
    expect(r[1]).toBeCloseTo(3.3, 2);
  });

  it("random walks with big steps never enter a rack or leave the room", () => {
    const rand = rng(7);
    for (const a of [area, ROOM]) {
      let p: Vec2 = a === area ? [1, 1] : [SCENE.start.x, SCENE.start.z];
      for (let i = 0; i < 6000; i++) {
        const ang = rand() * Math.PI * 2;
        const step = 0.02 + rand() * 0.15; // up to 0.17 m (a 0.1 s frame at full speed is 0.12 m)
        p = clampStep(p, [p[0] + Math.cos(ang) * step, p[1] + Math.sin(ang) * step], a);
        expect(pointInArea(p, a)).toBe(true);
      }
    }
  });

  it("walking into a rack for a long time stops at its margin", () => {
    let p: Vec2 = [1, 3];
    for (let i = 0; i < 600; i++) p = clampStep(p, [p[0] + 0.02, p[1]], area);
    expect(p[0]).toBeLessThanOrEqual(2);
    expect(p[0]).toBeGreaterThan(1.95);
  });

  it("moves a blocked start to the nearest walkable point", () => {
    const q = ensureInside([2.1, 3], area);
    expect(pointInArea(q, area)).toBe(true);
    expect(Math.hypot(q[0] - 2.1, q[1] - 3)).toBeLessThan(0.25);
  });
});

describe("ensureInside", () => {
  it("moves an outside point inside", () => {
    expect(pointInPolygon(ensureInside([10, 10], square), square)).toBe(true);
    expect(ensureInside([1, 1], square)).toEqual([1, 1]);
  });
});
