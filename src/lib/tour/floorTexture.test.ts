import { describe, it, expect } from "vitest";
import { generateFloorTexture, hexToRgb } from "@/lib/tour/floorTexture";
import { SCENE } from "@/lib/tour/sceneConfig";

const opts = {
  size: 256,
  tiles: 4,
  color: SCENE.floor.color,
  groutColor: SCENE.floor.groutColor,
  groutFraction: SCENE.floor.groutWidth / SCENE.floor.tileSize,
  noise: SCENE.floor.noise,
};

const px = (d: Uint8Array, size: number, x: number, y: number) => {
  const i = (y * size + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
};
const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("floor tile texture", () => {
  it("is light beige on average, close to the configured tile colour", () => {
    const d = generateFloorTexture(opts);
    const mean = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += d[i + c];
    const n = d.length / 4;
    const target = hexToRgb(SCENE.floor.color);
    for (let c = 0; c < 3; c++) expect(Math.abs(mean[c] / n - target[c])).toBeLessThan(6);
    expect(SCENE.floor.tileSize).toBeCloseTo(0.6, 5);
  });

  it("has darker grout lines on the tile edges, including the texture border (seamless)", () => {
    const d = generateFloorTexture(opts);
    const tile = opts.size / opts.tiles;
    const mid = Math.floor(tile / 2);
    // along a row through a tile's middle: edges are darker than centres
    const edge = (lum(px(d, opts.size, 0, mid)) + lum(px(d, opts.size, opts.size - 1, mid))) / 2;
    const centre = lum(px(d, opts.size, mid, mid));
    expect(centre - edge).toBeGreaterThan(8);
    // the first and last columns are both grout, so the repeat joins cleanly
    let diff = 0;
    for (let y = 0; y < opts.size; y++) diff += Math.abs(lum(px(d, opts.size, 0, y)) - lum(px(d, opts.size, opts.size - 1, y)));
    expect(diff / opts.size).toBeLessThan(2 * opts.noise + 2);
  });

  it("is deterministic and opaque", () => {
    const a = generateFloorTexture(opts);
    const b = generateFloorTexture(opts);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    let opaque = true;
    for (let i = 3; i < a.length; i += 4) if (a[i] !== 255) opaque = false;
    expect(opaque).toBe(true);
  });
});
