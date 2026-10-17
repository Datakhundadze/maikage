import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getNode, panoramaSize, TOUR, TOUR_NODES } from "./tourConfig";
import { angleDiff, pickLink } from "./tourMath";

const PUBLIC = path.resolve(__dirname, "../../../public");

describe("tour config", () => {
  it("has s1…s6 in shooting order", () => {
    expect(TOUR_NODES.map((n) => n.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(TOUR.startNodeId).toBe("s1");
  });

  it("links the nodes as a chain, both ways", () => {
    TOUR_NODES.forEach((node, i) => {
      const expected = [TOUR_NODES[i - 1]?.id, TOUR_NODES[i + 1]?.id].filter(Boolean).sort();
      expect(node.links.map((l) => l.to).sort()).toEqual(expected);
      for (const link of node.links) {
        expect(getNode(link.to).links.some((back) => back.to === node.id)).toBe(true);
      }
    });
  });

  it("points each link back the opposite way (world yaws agree)", () => {
    for (const node of TOUR_NODES) {
      for (const link of node.links) {
        const back = getNode(link.to).links.find((l) => l.to === node.id)!;
        expect(Math.abs(angleDiff(back.yawDeg, link.yawDeg + 180))).toBeLessThan(10);
      }
    }
  });

  it("keeps angles in range and arrows on the floor", () => {
    for (const node of TOUR_NODES) {
      expect(Math.abs(node.northOffsetDeg)).toBeLessThanOrEqual(180);
      for (const link of node.links) {
        expect(Math.abs(link.yawDeg)).toBeLessThanOrEqual(180);
        expect(link.pitchDeg).toBeLessThan(0);
        expect(link.pitchDeg).toBeGreaterThan(-90);
      }
    }
  });

  it("starts at s1 facing s2", () => {
    const toS2 = getNode("s1").links.find((l) => l.to === "s2")!;
    expect(Math.abs(angleDiff(TOUR.startYawDeg, toS2.yawDeg))).toBeLessThan(5);
    expect(pickLink(getNode("s1").links, TOUR.startYawDeg, "forward")?.to).toBe("s2");
  });

  it("points at panoramas that exist, with the sizes in the manifest", () => {
    const manifest: { file: string; node: string; width: number; height: number }[] = JSON.parse(
      readFileSync(path.join(PUBLIC, "tour/360/manifest.json"), "utf8"),
    );
    for (const node of TOUR_NODES) {
      for (const [size, url] of Object.entries(node.panorama)) {
        expect(existsSync(path.join(PUBLIC, url))).toBe(true);
        const entry = manifest.find((m) => `/tour/360/${m.file}` === url)!;
        expect(entry.node).toBe(node.id);
        expect(entry.width).toBe(size === "6k" ? 6144 : 4096);
        expect(entry.width).toBe(entry.height * 2);
      }
    }
    expect(existsSync(path.join(PUBLIC, TOUR.nadirLogo.url))).toBe(true);
  });

  it("serves 4k to phones and 6k otherwise", () => {
    expect(panoramaSize({ coarsePointer: true, viewportWidth: 1400 })).toBe("4k");
    expect(panoramaSize({ coarsePointer: false, viewportWidth: 899 })).toBe("4k");
    expect(panoramaSize({ coarsePointer: false, viewportWidth: 900 })).toBe("6k");
  });
});
