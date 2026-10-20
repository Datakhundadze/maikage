import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
  countAssistantReplies,
  isRatingDone,
  markRatingDone,
  shouldShowRating,
  summarizeRatings,
} from "@/lib/chatRating";

describe("chat rating show/hide logic", () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("counts only real assistant replies (greeting/errors are local)", () => {
    expect(countAssistantReplies([
      { role: "assistant", local: true },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant", local: true },
      { role: "assistant" },
    ])).toBe(2);
  });

  it("shows after ≥2 replies, not before", () => {
    expect(shouldShowRating(0, false)).toBe(false);
    expect(shouldShowRating(1, false)).toBe(false);
    expect(shouldShowRating(2, false)).toBe(true);
    expect(shouldShowRating(7, false)).toBe(true);
  });

  it("never shows once rated or dismissed", () => {
    expect(shouldShowRating(5, true)).toBe(false);
    expect(isRatingDone("s1")).toBe(false);
    markRatingDone("s1", "rated");
    expect(isRatingDone("s1")).toBe(true);
    markRatingDone("s2", "dismissed");
    expect(isRatingDone("s2")).toBe(true);
    expect(isRatingDone("s3")).toBe(false);
  });

  it("survives localStorage throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => markRatingDone("s1", "rated")).not.toThrow();
    expect(isRatingDone("s1")).toBe(false);
  });

  it("summarizes a window: count, average, distribution", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const rows = [
      { rating: 5, created_at: "2026-10-19T10:00:00Z" },
      { rating: 4, created_at: "2026-10-18T10:00:00Z" },
      { rating: 1, created_at: "2026-10-15T10:00:00Z" },
      { rating: 3, created_at: "2026-10-01T10:00:00Z" }, // only in 30d
      { rating: 2, created_at: "2026-08-01T10:00:00Z" }, // outside both
    ];
    const w7 = summarizeRatings(rows, 7, now);
    expect(w7.count).toBe(3);
    expect(w7.average).toBeCloseTo(10 / 3);
    expect(w7.distribution).toEqual([1, 0, 0, 1, 1]);
    const w30 = summarizeRatings(rows, 30, now);
    expect(w30.count).toBe(4);
    expect(w30.distribution).toEqual([1, 0, 1, 1, 1]);
    expect(summarizeRatings([], 7, now)).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
  });
});
