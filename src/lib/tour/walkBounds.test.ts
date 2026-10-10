import { describe, it, expect } from "vitest";
import { clampStep, closestOnPolygon, ensureInside, pointInPolygon, type Vec2 } from "@/lib/tour/walkBounds";
import { SCENE } from "@/lib/tour/sceneConfig";

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
    for (const poly of [square, ell, SCENE.walkable]) {
      let p = ensureInside([SCENE.start.x, SCENE.start.z], poly);
      if (poly !== SCENE.walkable) p = [1, 1];
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
    // walk toward −x (the counter side) for 30 s at 1.2 m/s, 60 fps
    for (let i = 0; i < 1800; i++) p = clampStep(p, [p[0] - 0.02, p[1]], SCENE.walkable);
    expect(pointInPolygon(p, SCENE.walkable)).toBe(true);
    expect(closestOnPolygon(p, SCENE.walkable).distance).toBeLessThan(0.05);
  });
});

describe("ensureInside", () => {
  it("moves an outside point inside", () => {
    expect(pointInPolygon(ensureInside([10, 10], square), square)).toBe(true);
    expect(ensureInside([1, 1], square)).toEqual([1, 1]);
  });
});
