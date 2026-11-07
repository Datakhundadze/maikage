import { describe, expect, it } from "vitest";
import { partBase, pickTier } from "./videoTier";
import { WALK_TRACK } from "./walkTrack";

describe("pickTier", () => {
  it("desktop: 4k only on a fast line", () => {
    expect(pickTier(40, false)).toBe("4k");
    expect(pickTier(15, false)).toBe("hd");
    expect(pickTier(8.5, false)).toBe("lite"); // David's laptop, 2026-11-07
  });
  it("phones never get 4k", () => {
    expect(pickTier(100, true)).toBe("hd");
    expect(pickTier(5, true)).toBe("lite");
  });
  it("unknown speed: the middle copy", () => {
    expect(pickTier(null, false)).toBe("hd");
  });
});

describe("partBase", () => {
  it("every part has all three copies", () => {
    for (const p of WALK_TRACK.parts) {
      expect(partBase(p, "4k")).toMatch(/\/walk3\/p\d$/);
      expect(partBase(p, "hd")).toMatch(/\/walk3m\/p\d$/);
      expect(partBase(p, "lite")).toMatch(/\/walk3s\/p\d$/);
    }
  });
});
