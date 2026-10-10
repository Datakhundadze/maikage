import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { SCENE } from "@/lib/tour/sceneConfig";
import { closestOnPolygon, pointInPolygon, type Vec2 } from "@/lib/tour/walkBounds";

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

describe("scene config", () => {
  it("starts inside the walkable area, clear of its edges", () => {
    const start: Vec2 = [SCENE.start.x, SCENE.start.z];
    expect(pointInPolygon(start, SCENE.walkable)).toBe(true);
    expect(closestOnPolygon(start, SCENE.walkable).distance).toBeGreaterThan(0.3);
  });

  it("walkable polygon is simple (no self-intersections)", () => {
    const p = SCENE.walkable;
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        if (Math.abs(i - j) <= 1 || (i === 0 && j === p.length - 1)) continue;
        expect(segmentsCross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])).toBe(false);
      }
    }
  });

  it("walks at about 1.2 m/s with a short ease and limits pitch to about ±60°", () => {
    expect(SCENE.walkSpeed).toBeCloseTo(1.2, 5);
    expect(SCENE.accelTime).toBeGreaterThan(0);
    expect(SCENE.accelTime).toBeLessThan(0.6);
    expect(SCENE.pitchLimitDeg).toBe(60);
    expect(Math.abs(SCENE.start.pitchDeg)).toBeLessThanOrEqual(SCENE.pitchLimitDeg);
  });

  it("points at a real SPZ v3 file in public/", () => {
    const file = path.join(process.cwd(), "public", SCENE.url);
    expect(existsSync(file)).toBe(true);
    const head = gunzipSync(readFileSync(file)).subarray(0, 16);
    expect(head.toString("latin1", 0, 4)).toBe("NGSP");
    expect(head.readUInt32LE(4)).toBe(3);
    expect(head.readUInt32LE(8)).toBeGreaterThan(100000);
  });
});
