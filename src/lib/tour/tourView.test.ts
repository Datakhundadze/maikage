import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  EDGE_MARGIN,
  clampToCoverage,
  coverageFromPanoData,
  maxVFovDeg,
  signedYaw,
  type TourCoverage,
  type TourPosition,
} from "@/lib/tour/tourView";
import { TOUR_NODES, partialPanoData, type TourNode } from "@/lib/tour/tourConfig";

const rad = (d: number) => (d * Math.PI) / 180;
const hFovOf = (vDeg: number, aspect: number) => (2 * Math.atan(Math.tan(rad(vDeg) / 2) * aspect) * 180) / Math.PI;

// Coverage the viewer gets for an image of this size and horizontal FOV.
function coverageFor(width: number, height: number, hFovDeg: number): TourCoverage {
  const img = { width, height } as HTMLImageElement;
  const c = coverageFromPanoData(partialPanoData(hFovDeg)(img));
  if (!c) throw new Error("expected a partial coverage");
  return c;
}

// Brute force: walk the viewport's outline (a rectilinear frame) and convert
// every point to yaw/pitch. Independent of the closed-form corner rule.
function outsidePoints(pos: TourPosition, vDeg: number, aspect: number, c: TourCoverage): number {
  const ty = Math.tan(rad(vDeg) / 2);
  const tx = ty * aspect;
  const yaw = signedYaw(pos.yaw);
  const f = [Math.sin(yaw) * Math.cos(pos.pitch), Math.sin(pos.pitch), Math.cos(yaw) * Math.cos(pos.pitch)];
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [-Math.sin(yaw) * Math.sin(pos.pitch), Math.cos(pos.pitch), -Math.cos(yaw) * Math.sin(pos.pitch)];
  let bad = 0;
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const s = -1 + (2 * i) / N;
    for (const [x, y] of [[s * tx, ty], [s * tx, -ty], [tx, s * ty], [-tx, s * ty]]) {
      const d = [0, 1, 2].map((k) => f[k] + x * r[k] + y * u[k]);
      const py = Math.atan2(d[0], d[2]);
      const pp = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      const tol = 1e-9;
      if (py < c.yawMin - tol || py > c.yawMax + tol || pp < c.pitchMin - tol || pp > c.pitchMax + tol) bad++;
    }
  }
  return bad;
}

/** Pixel size of a baseline/progressive JPEG, read from its SOF segment. */
function jpegSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error(`no SOF in ${file}`);
}

/** Coverage of a configured node, computed from its actual image file. */
function nodeCoverage(node: TourNode): TourCoverage | null {
  const { width, height } = jpegSize(path.join(process.cwd(), "public", node.panoramaUrl));
  if (node.horizontalFovDeg == null) return null;
  return coverageFor(width, height, node.horizontalFovDeg);
}

const NODES = TOUR_NODES.map((n) => {
  const c = nodeCoverage(n);
  if (!c) throw new Error(`${n.id}: expected a partial panorama`);
  return { name: n.id, c };
});
const SCREENS = [
  { name: "desktop 1280×800", aspect: 1280 / 744 },
  { name: "phone 390×844", aspect: 390 / 788 },
];

describe("coverageFromPanoData", () => {
  it("maps a 170° iPhone pano to ±85° yaw and the aspect-derived pitch", () => {
    const c = coverageFor(2000, 1351, 170);
    expect((c.yawMin * 180) / Math.PI).toBeCloseTo(-85, 0);
    expect((c.yawMax * 180) / Math.PI).toBeCloseTo(85, 0);
    expect((c.pitchMax * 180) / Math.PI).toBeCloseTo((170 * 1351) / 2000 / 2, 0);
    // croppedY is rounded to whole pixels, so symmetric to ~0.1°
    expect(c.pitchMin).toBeCloseTo(-c.pitchMax, 2);
  });
  it("returns null for a full sphere", () => {
    expect(coverageFromPanoData({ fullWidth: 4000, fullHeight: 2000, croppedWidth: 4000, croppedHeight: 2000, croppedX: 0, croppedY: 0 })).toBeNull();
    expect(coverageFromPanoData(undefined)).toBeNull();
  });
});

describe("no black outside the photo", () => {
  for (const node of NODES) {
    for (const screen of SCREENS) {
      it(`${node.name} on ${screen.name}: every clamped view at every allowed zoom is inside the photo`, () => {
        const maxV = maxVFovDeg(node.c, screen.aspect);
        const minV = Math.min(30, maxV);
        let checked = 0;
        for (let k = 0; k <= 8; k++) {
          const v = minV + ((maxV - minV) * k) / 8;
          const h = hFovOf(v, screen.aspect);
          // Aim far past every edge and corner, and everywhere in between.
          for (let yawDeg = -180; yawDeg < 180; yawDeg += 15) {
            for (const pitchDeg of [-89, -60, -30, -10, 0, 10, 30, 60, 89]) {
              const pos = clampToCoverage({ yaw: rad(yawDeg), pitch: rad(pitchDeg) }, v, h, node.c);
              expect(outsidePoints(pos, v, screen.aspect, node.c)).toBe(0);
              checked++;
            }
          }
        }
        expect(checked).toBeGreaterThan(1000);
      });

      it(`${node.name} on ${screen.name}: maxVFovDeg is tight (a few degrees wider would show black)`, () => {
        const maxV = maxVFovDeg(node.c, screen.aspect);
        expect(maxV).toBeLessThanOrEqual(90);
        if (maxV < 90) {
          const wider = maxV + 2;
          const pos = clampToCoverage({ yaw: 0, pitch: 0 }, wider, hFovOf(wider, screen.aspect), node.c, 0);
          expect(outsidePoints(pos, wider, screen.aspect, node.c)).toBeGreaterThan(0);
        }
      });
    }
  }

  it("keeps the configured margin from the edge", () => {
    const c = NODES[1].c;
    const pos = clampToCoverage({ yaw: rad(179), pitch: 0 }, 60, 90, c);
    expect(signedYaw(pos.yaw) + rad(45) + EDGE_MARGIN).toBeCloseTo(c.yawMax, 6);
  });
});

describe("tour config", () => {
  const deg = (r: number) => (r * 180) / Math.PI;

  it("puts every floor ring inside its node's photo (yaw AND pitch)", () => {
    for (const node of TOUR_NODES) {
      const c = nodeCoverage(node);
      for (const link of node.links) {
        expect(TOUR_NODES.some((n) => n.id === link.nodeId)).toBe(true);
        expect(link.pitch).toBeLessThan(0); // on the floor
        if (!c) continue;
        expect(link.yaw).toBeGreaterThan(deg(c.yawMin));
        expect(link.yaw).toBeLessThan(deg(c.yawMax));
        expect(link.pitch).toBeGreaterThan(deg(c.pitchMin));
        expect(link.pitch).toBeLessThan(deg(c.pitchMax));
      }
    }
  });

  it("puts every arrival direction inside the target photo", () => {
    for (const node of TOUR_NODES) {
      for (const link of node.links) {
        const target = TOUR_NODES.find((n) => n.id === link.nodeId);
        const c = target && nodeCoverage(target);
        if (!c) continue;
        const arrive = link.arriveYaw ?? 0;
        expect(arrive).toBeGreaterThan(deg(c.yawMin));
        expect(arrive).toBeLessThan(deg(c.yawMax));
      }
    }
  });
});
