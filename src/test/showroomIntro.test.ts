// The street-to-hall clip after „მობრძანდით" (2026-11-16).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const WALK = readFileSync(path.join(root, "src/components/tour/VideoWalk.tsx"), "utf8");

describe("showroom intro", () => {
  it.each(["portrait", "landscape"])("%s clip is shipped and small", (name) => {
    const f = path.join(root, "public/tour/intro", `${name}.mp4`);
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThan(3_000_000);
  });
  it("never blocks the way in: ends, is skipped, or fails → the showroom", () => {
    expect(WALK).toContain("onEnded={endIntro}");
    expect(WALK).toContain("onError={endIntro}");
    expect(WALK).toContain("onClick={endIntro}");
    expect(WALK).toContain("muted");
    expect(WALK).toContain("playsInline");
  });
  it("once per session, not for reduced motion, and the first walk waits for it", () => {
    expect(WALK).toContain('sessionStorage.getItem("maika.tour.intro") === "1"');
    expect(WALK).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
    expect(WALK).toContain('if (status !== "ready" || !pendingEnterRef.current || intro !== "done") return;');
  });
});
