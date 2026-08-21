import { describe, it, expect } from "vitest";
import {
  coarseDate,
  hasOrderStatusFence,
  stripOrderStatusFence,
} from "@/lib/orderStatus";

describe("order-status fence", () => {
  it("detects a well-formed block", () => {
    expect(hasOrderStatusFence("ვნახოთ.\n```maika-order-status\n{}\n```")).toBe(true);
  });

  it("detects a truncated block (the model ran out of tokens)", () => {
    expect(hasOrderStatusFence("ვნახოთ.\n```maika-order-status\n{")).toBe(true);
  });

  it("is not fooled by the other two fences", () => {
    expect(hasOrderStatusFence("```maika-mockup\n{}\n```")).toBe(false);
    expect(hasOrderStatusFence("```maika-generate\n{}\n```")).toBe(false);
  });

  it("returns a stable answer across repeated calls", () => {
    // The regex is module-level and /g, so lastIndex must be reset per call —
    // otherwise every second call would answer false.
    const s = "```maika-order-status\n{}\n```";
    expect(hasOrderStatusFence(s)).toBe(true);
    expect(hasOrderStatusFence(s)).toBe(true);
    expect(hasOrderStatusFence(s)).toBe(true);
  });

  it("strips a closed fence, leaving only the prose", () => {
    expect(stripOrderStatusFence("ვნახოთ.\n```maika-order-status\n{}\n```")).toBe("ვნახოთ.");
  });

  it("strips a TRUNCATED fence too, so raw JSON never reaches a bubble", () => {
    expect(stripOrderStatusFence("ვნახოთ.\n```maika-order-status\n{\"a\":")).toBe("ვნახოთ.");
  });

  it("leaves ordinary text untouched", () => {
    expect(stripOrderStatusFence("გამარჯობა")).toBe("გამარჯობა");
  });
});

describe("coarseDate — never a timestamp", () => {
  const now = Date.parse("2026-08-21T12:00:00Z");
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it("reports today, yesterday and recent days", () => {
    expect(coarseDate(ago(0), "ka", now)).toBe("დღეს");
    expect(coarseDate(ago(1), "ka", now)).toBe("გუშინ");
    expect(coarseDate(ago(3), "ka", now)).toBe("3 დღის წინ");
  });

  it("coarsens to weeks and months", () => {
    expect(coarseDate(ago(10), "ka", now)).toBe("დაახლოებით 1 კვირის წინ");
    expect(coarseDate(ago(60), "ka", now)).toBe("დაახლოებით 2 თვის წინ");
  });

  it("speaks English when the page does", () => {
    expect(coarseDate(ago(0), "en", now)).toBe("today");
    expect(coarseDate(ago(3), "en", now)).toBe("3 days ago");
    expect(coarseDate(ago(10), "en", now)).toBe("about 1 week ago");
    expect(coarseDate(ago(60), "en", now)).toBe("about 2 months ago");
  });

  it("never leaks a clock time or a calendar date", () => {
    for (const d of [0, 1, 5, 12, 40, 200]) {
      const out = coarseDate(ago(d), "en", now);
      expect(out).not.toMatch(/\d{4}/); // no year
      expect(out).not.toMatch(/:/); // no time
    }
  });

  it("returns empty for an unparseable value rather than throwing", () => {
    expect(coarseDate("not-a-date", "ka", now)).toBe("");
  });
});
