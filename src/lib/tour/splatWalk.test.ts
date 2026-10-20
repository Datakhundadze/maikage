import { describe, expect, it } from "vitest";
import { forwardOf, isFree, moveWithCollision, nearestFree, SPLAT_FEEL, stickAxis, type WalkGrid } from "./splatWalk";
import { SHOP_WALK_GRID } from "./splatWalkGrid";

// 5 × 5 cells of 1 unit from (0,0); a wall down column 2 except row 0
const grid: WalkGrid = {
  cell: 1,
  x0: 0,
  z0: 0,
  rows: ["11111", "11011", "11011", "11011", "11111"],
};

describe("splat walk grid", () => {
  it("knows free and blocked cells, and outside is blocked", () => {
    expect(isFree(grid, 0.5, 0.5)).toBe(true);
    expect(isFree(grid, 2.5, 1.5)).toBe(false);
    expect(isFree(grid, -0.1, 0.5)).toBe(false);
    expect(isFree(grid, 0.5, 5.1)).toBe(false);
  });

  it("does not walk through the wall", () => {
    const p = moveWithCollision(grid, { x: 1.5, z: 2.5 }, 2, 0);
    expect(p.x).toBeLessThan(2);
    expect(p.z).toBeCloseTo(2.5);
  });

  it("slides along the wall when walking into it at an angle", () => {
    const p = moveWithCollision(grid, { x: 1.5, z: 2.5 }, 1, -1);
    expect(p.x).toBeLessThan(2);
    expect(p.z).toBeLessThan(2.5);
  });

  it("walks freely in the open", () => {
    const p = moveWithCollision(grid, { x: 0.5, z: 0.5 }, 3.5, 0);
    expect(p).toEqual({ x: 4, z: 0.5 });
  });

  it("finds the nearest free cell", () => {
    expect(nearestFree(grid, 2.5, 2.5).x).not.toBe(2.5);
    expect(isFree(grid, nearestFree(grid, 2.5, 2.5).x, nearestFree(grid, 2.5, 2.5).z)).toBe(true);
  });
});

describe("splat walk feel", () => {
  it("yaw 0 looks toward −z and 90 toward +x", () => {
    expect(forwardOf(0).z).toBeCloseTo(-1);
    expect(forwardOf(90).x).toBeCloseTo(1);
  });

  it("stick dead zone", () => {
    expect(stickAxis(0.1, 0.12)).toBe(0);
    expect(stickAxis(1, 0.12)).toBe(1);
    expect(stickAxis(-1, 0.12)).toBe(-1);
  });

  it("the shop grid has a free start point with room to walk", () => {
    const s = nearestFree(SHOP_WALK_GRID, SPLAT_FEEL.start.x, SPLAT_FEEL.start.z);
    expect(isFree(SHOP_WALK_GRID, s.x, s.z)).toBe(true);
    const free = SHOP_WALK_GRID.rows.join("").split("").filter((c) => c === "1").length;
    expect(free * SHOP_WALK_GRID.cell ** 2).toBeGreaterThan(20); // square units of floor
  });
});
