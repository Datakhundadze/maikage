import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOM_IMAGES, SCENE, type RackId } from "@/lib/tour/sceneConfig";
import { buildWalkArea, panelStretch, rackFootprint, rackFrame, usedImages } from "@/lib/tour/roomGeometry";
import { closestOnArea, pointInArea, pointInPolygon, type Vec2 } from "@/lib/tour/walkBounds";
import { targetVelocity } from "@/lib/tour/walkMotion";

const ROOM_DIR = path.join(process.cwd(), "public", "tour", "room");
const area = buildWalkArea(SCENE);
const { length: L, width: W, height: H } = SCENE.room;

describe("photo assets", () => {
  it("every photo in the config exists as a WebP with the listed size", () => {
    const manifest: Array<{ file: string; width: number; height: number }> = JSON.parse(
      readFileSync(path.join(ROOM_DIR, "asset-manifest.json"), "utf8"),
    );
    for (const [file, size] of Object.entries(ROOM_IMAGES)) {
      const buf = readFileSync(path.join(ROOM_DIR, file));
      expect(buf.toString("latin1", 0, 4)).toBe("RIFF");
      expect(buf.toString("latin1", 8, 12)).toBe("WEBP");
      const entry = manifest.find((m) => m.file === file);
      expect(entry, file).toBeTruthy();
      expect([entry!.width, entry!.height]).toEqual([size.width, size.height]);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2048);
    }
  });

  it("public/tour/room stays under 8 MB, without the floor sample or any splat file", () => {
    const files = readdirSync(ROOM_DIR);
    const total = files.reduce((s, f) => s + statSync(path.join(ROOM_DIR, f)).size, 0);
    expect(total).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(files.some((f) => f.startsWith("floor-sample"))).toBe(false);
    const tour = path.join(process.cwd(), "public", "tour");
    expect(readdirSync(tour).some((f) => f.endsWith(".spz"))).toBe(false);
    expect(existsSync(path.join(tour, "shop.spz"))).toBe(false);
  });

  it("uses the clock-wall photo whole, and every photo it loads is listed", () => {
    const clock = SCENE.walls.filter((w) => w.wall === "clock");
    expect(clock.map((w) => w.image)).toEqual(["15-clock-wall-straight-on.webp"]);
    expect(clock[0].crop[0]).toBe(0);
    expect(clock[0].crop[2]).toBe(1);
    for (const img of usedImages(SCENE)) expect(ROOM_IMAGES[img]).toBeTruthy();
  });
});

describe("walls", () => {
  it("covers each wall with the photos named in the brief", () => {
    const by = (w: string) => SCENE.walls.filter((p) => p.wall === w).map((p) => p.image);
    expect(by("street")).toEqual([
      "10-entrance-door-with-rack-A.webp",
      "11-street-window-head-stands.webp",
      "12-street-wall-mannequins.webp",
    ]);
    expect(by("counter")).toEqual(["16-counter-wall-straight-on.webp", "14-radio-cabinet-oil-lamps.webp"]);
    expect(by("back")).toEqual(["13-back-wall-maisuri-hoodie-panel.webp"]);
  });

  it("puts the entrance door near the clock-wall corner (x ≈ 1–2)", () => {
    const door = SCENE.walls.find((p) => p.image === "10-entrance-door-with-rack-A.webp")!;
    const mid = (door.left + door.right) / 2;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2.5);
  });

  it("keeps panels on their wall, crops inside the image, distortion modest", () => {
    for (const p of SCENE.walls) {
      const span = p.wall === "clock" || p.wall === "back" ? W : L;
      for (const s of [p.left, p.right]) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(span);
      }
      expect(p.bottom).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeLessThanOrEqual(H);
      const [u0, v0, u1, v1] = p.crop;
      expect(0 <= u0 && u0 < u1 && u1 <= 1 && 0 <= v0 && v0 < v1 && v1 <= 1).toBe(true);
      const stretch = panelStretch(p.image, p.crop, Math.abs(p.right - p.left), p.top - p.bottom);
      expect(stretch, p.image).toBeGreaterThan(0.75);
      expect(stretch, p.image).toBeLessThan(1.4);
    }
  });

  it("panels on the same wall don't overlap", () => {
    for (const wall of ["clock", "street", "counter", "back"]) {
      const spans = SCENE.walls
        .filter((p) => p.wall === wall)
        .map((p) => [Math.min(p.left, p.right), Math.max(p.left, p.right)])
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1] - 1e-9);
    }
  });
});

describe("racks", () => {
  const ids: RackId[] = [
    "rack_long_yellow",
    "rack_gildan_white",
    "rack_sols",
    "rack_window_heads",
    "rack_C",
    "rack_A_D",
    "rack_B",
    "rack_hoodie_panel",
    "rack_polo",
    "rack_jerseys",
  ];

  it("has exactly the ten racks of the brief, each with a Georgian label", () => {
    expect(SCENE.racks.map((r) => r.id).sort()).toEqual([...ids].sort());
    for (const r of SCENE.racks) expect(r.labelKa).toMatch(/[ა-ჿ]/);
  });

  it("stands each rack inside the room, as a 1.6–2.2 m billboard on the floor", () => {
    for (const r of SCENE.racks) {
      for (const [x, z] of rackFootprint(r)) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(L);
        expect(z).toBeGreaterThan(0);
        expect(z).toBeLessThan(W);
      }
      const top = Math.max(...r.panels.map((p) => p.top));
      expect(top, r.id).toBeGreaterThanOrEqual(1.6);
      expect(top, r.id).toBeLessThanOrEqual(2.2);
      expect(r.height).toBeGreaterThanOrEqual(top);
      expect(Math.min(...r.panels.map((p) => p.bottom))).toBeGreaterThanOrEqual(0);
    }
  });

  it("crops stay in the image and stretch modestly", () => {
    for (const r of SCENE.racks) {
      for (const p of r.panels) {
        const [u0, v0, u1, v1] = p.crop;
        expect(0 <= u0 && u0 < u1 && u1 <= 1 && 0 <= v0 && v0 < v1 && v1 <= 1).toBe(true);
        const stretch = panelStretch(p.image, p.crop, p.width, p.top - p.bottom);
        expect(stretch, `${r.id} ${p.image}`).toBeGreaterThan(0.75);
        expect(stretch, `${r.id} ${p.image}`).toBeLessThan(1.4);
        expect(Math.abs(p.offset) + p.width / 2, r.id).toBeLessThanOrEqual(r.length / 2 + 0.25);
      }
    }
  });

  it("sits roughly where the brief puts it", () => {
    const near: Record<RackId, [number, number, number]> = {
      // x, z, tolerance (m)
      rack_long_yellow: [7, 4, 0.6],
      rack_gildan_white: [4, 3, 0.4],
      rack_sols: [3.5, 4.5, 0.4],
      rack_window_heads: [3, 0.6, 0.6],
      rack_C: [6, 1, 0.4],
      rack_A_D: [4.5, 2.2, 0.4],
      rack_B: [1.5, 3.5, 0.4],
      rack_hoodie_panel: [9, 4, 0.4],
      rack_polo: [5, 6, 0.4],
      rack_jerseys: [6.5, 5.5, 0.5],
    };
    for (const r of SCENE.racks) {
      const [x, z, tol] = near[r.id];
      expect(Math.hypot(r.x - x, r.z - z), r.id).toBeLessThanOrEqual(tol);
    }
  });
});

describe("bounds and start", () => {
  it("starts just inside the entrance at eye height, facing +x into the shop", () => {
    expect(Math.hypot(SCENE.start.x - 1.5, SCENE.start.z - 1.2)).toBeLessThan(0.2);
    expect(SCENE.eyeHeight).toBeCloseTo(1.6, 5);
    const [vx, vz] = targetVelocity({ forward: 1, strafe: 0 }, (SCENE.start.yawDeg * Math.PI) / 180, 1);
    expect(vx).toBeCloseTo(1, 5);
    expect(vz).toBeCloseTo(0, 5);
    const start: Vec2 = [SCENE.start.x, SCENE.start.z];
    expect(pointInArea(start, area)).toBe(true);
    expect(closestOnArea(start, area).distance).toBeGreaterThan(0.2);
  });

  it("keeps ~0.4 m from the walls and around every rack", () => {
    expect(SCENE.bounds.wallMargin).toBeGreaterThanOrEqual(0.35);
    expect(SCENE.bounds.rackMargin).toBeGreaterThanOrEqual(0.3);
    for (const r of SCENE.racks) {
      for (const p of rackFootprint(r)) expect(pointInArea(p, area)).toBe(false);
      expect(pointInArea([r.x, r.z], area)).toBe(false);
    }
    expect(pointInArea([0.3, 4], area)).toBe(false);
    expect(pointInArea([5, 7.7], area)).toBe(false);
  });

  // 5 cm raster of the walkable floor, flood-filled from the start
  const STEP = 0.05;
  const nx = Math.round(L / STEP);
  const nz = Math.round(W / STEP);
  const cell = (i: number, j: number): Vec2 => [(i + 0.5) * STEP, (j + 0.5) * STEP];
  const walkable = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) walkable[i * nz + j] = pointInArea(cell(i, j), area) ? 1 : 0;
  const reached = new Uint8Array(nx * nz);
  {
    const si = Math.floor(SCENE.start.x / STEP);
    const sj = Math.floor(SCENE.start.z / STEP);
    const queue = [si * nz + sj];
    reached[queue[0]] = 1;
    while (queue.length) {
      const k = queue.pop()!;
      const i = Math.floor(k / nz);
      const j = k % nz;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const n = a * nz + b;
        if (walkable[n] && !reached[n]) {
          reached[n] = 1;
          queue.push(n);
        }
      }
    }
  }

  it("the walkable floor is (almost) one connected region from the start", () => {
    const total = walkable.reduce((s, v) => s + v, 0);
    const got = reached.reduce((s, v) => s + v, 0);
    expect(total * STEP * STEP).toBeGreaterThan(20); // m²
    expect(got / total).toBeGreaterThan(0.97);
  });

  it("every rack can be walked up to, in front of its photo", () => {
    for (const r of SCENE.racks) {
      const { normal } = rackFrame(r);
      // a reached cell within 1.2 m of the rack's front face, on the front side
      let ok = false;
      for (let i = 0; i < nx && !ok; i++) {
        for (let j = 0; j < nz && !ok; j++) {
          if (!reached[i * nz + j]) continue;
          const [x, z] = cell(i, j);
          const dx = x - r.x;
          const dz = z - r.z;
          const front = dx * normal[0] + dz * normal[1];
          if (front > r.depth / 2 && front < r.depth / 2 + 1.2 && Math.abs(dx * normal[1] - dz * normal[0]) < r.length / 2) {
            ok = true;
          }
        }
      }
      expect(ok, r.id).toBe(true);
    }
  });

  it("walks the length of the shop: from the entrance to the back wall area", () => {
    const back = (): boolean => {
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (reached[i * nz + j] && cell(i, j)[0] > 9) return true;
      return false;
    };
    expect(back()).toBe(true);
    expect(pointInPolygon([SCENE.start.x, SCENE.start.z], area.outer)).toBe(true);
  });

  it("walks at about 1.2 m/s with a short ease and limits pitch to about ±60°", () => {
    expect(SCENE.walkSpeed).toBeCloseTo(1.2, 5);
    expect(SCENE.accelTime).toBeGreaterThan(0);
    expect(SCENE.accelTime).toBeLessThan(0.6);
    expect(SCENE.pitchLimitDeg).toBe(60);
    expect(Math.abs(SCENE.start.pitchDeg)).toBeLessThanOrEqual(SCENE.pitchLimitDeg);
  });
});
