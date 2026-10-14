import { describe, it, expect } from "vitest";
import { SCENE, type Rack } from "@/lib/tour/sceneConfig";
import { buildWalkArea, cropUvs, rackFootprint, rackFrame, rackPanelQuads, wallPanelQuad } from "@/lib/tour/roomGeometry";

const rack = (rotYDeg: number): Rack => ({
  id: "rack_B",
  labelKa: "ტესტი",
  models: [],
  x: 5,
  z: 4,
  rotYDeg,
  length: 2,
  depth: 0.4,
  height: 1.8,
  panels: [{ image: "03-rack-sols-white.webp", crop: [0, 0, 1, 1], offset: 0.5, width: 1, bottom: 0, top: 1.8 }],
});

describe("rack frame", () => {
  it("rotYDeg turns the front: 0 → +z, 90 → +x, −90 → −x, 180 → −z", () => {
    const n = (deg: number) => rackFrame({ rotYDeg: deg }).normal.map((v) => Math.round(v * 1e6) / 1e6 + 0);
    expect(n(0)).toEqual([0, 1]);
    expect(n(90)).toEqual([1, 0]);
    expect(n(-90)).toEqual([-1, 0]);
    expect(n(180)).toEqual([0, -1]);
  });

  it("the axis is the viewer's right when facing the front", () => {
    // facing a rack whose front faces −x, the viewer looks +x; their right is +z
    const { axis } = rackFrame({ rotYDeg: -90 });
    expect(axis[0]).toBeCloseTo(0, 6);
    expect(axis[1]).toBeCloseTo(1, 6);
  });
});

describe("rack panels", () => {
  it("front and back show the image unmirrored, a few mm apart", () => {
    const r = rack(0);
    const { front, back } = rackPanelQuads(r, r.panels[0]);
    // front faces +z: the image's left edge is at smaller x
    expect(front.corners[0][0]).toBeCloseTo(5, 6); // offset 0.5 − width/2
    expect(front.corners[1][0]).toBeCloseTo(6, 6);
    // from behind, the image's left edge is at larger x
    expect(back.corners[0][0]).toBeCloseTo(6, 6);
    expect(back.corners[1][0]).toBeCloseTo(5, 6);
    expect(front.corners[0][2] - back.corners[0][2]).toBeGreaterThan(0);
    expect(front.corners[0][2] - back.corners[0][2]).toBeLessThan(0.01);
    expect(front.uvs).toEqual(back.uvs);
  });

  it("footprint is length × depth, grown by the margin", () => {
    const fp = rackFootprint(rack(90), 0.35);
    const xs = fp.map((p) => p[0]);
    const zs = fp.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.4 + 0.7, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2 + 0.7, 6);
  });
});

describe("walls", () => {
  it("crop UVs flip v for three.js (v = 1 at the top of the image)", () => {
    expect(cropUvs([0.1, 0.2, 0.9, 1])).toEqual([
      [0.1, 0.8],
      [0.9, 0.8],
      [0.1, 0],
      [0.9, 0],
    ]);
  });

  it("wall panels sit just in front of their wall", () => {
    for (const p of SCENE.walls) {
      const q = wallPanelQuad(p, SCENE.room);
      for (const [x, , z] of q.corners) {
        if (p.wall === "clock") expect(x).toBeCloseTo(0.01, 6);
        if (p.wall === "back") expect(x).toBeCloseTo(SCENE.room.length - 0.01, 6);
        if (p.wall === "street") expect(z).toBeCloseTo(0.01, 6);
        if (p.wall === "counter") expect(z).toBeCloseTo(SCENE.room.width - 0.01, 6);
      }
    }
  });

  it("the walk area has one hole per rack", () => {
    const a = buildWalkArea(SCENE);
    expect(a.holes).toHaveLength(SCENE.racks.length);
    expect(a.outer[0]).toEqual([SCENE.bounds.wallMargin, SCENE.bounds.wallMargin]);
  });
});
