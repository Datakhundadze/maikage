import { describe, expect, it } from "vitest";
import { AI_COST_RATES, rateFor } from "@/lib/aiCostRates";
import {
  aggregateAiSpend,
  countConfirmedOrders,
  daysNewestFirst,
  fetchAllPages,
  formatUsd,
  periodRange,
  queryBounds,
  tbilisiDay,
  type AiCallRow,
} from "@/lib/aiSpend";

const PRO = "google/gemini-3-pro-image";
const FLASH_IMG = "google/gemini-2.5-flash-image";
const FLASH_TXT = "google/gemini-3-flash-preview";
const UNKNOWN = "google/gemini-3.1-flash-image";
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const S1 = "sess-abcdef123456";

const call = (created_at: string, action: string, model: string, who: { user?: string; session?: string }, success = true): AiCallRow => ({
  created_at,
  action,
  model,
  user_id: who.user ?? null,
  session_id: who.session ?? null,
  is_guest: !who.user,
  success,
});

// Tbilisi is UTC+4. Two rows sit just after Tbilisi midnight but on the
// previous UTC day, so a UTC-day bucket would misplace them.
const FIXTURE: AiCallRow[] = [
  call("2026-10-09T21:30:00Z", "generate-design", PRO, { user: U1 }), // 10-10 01:30 Tbilisi
  call("2026-10-10T08:00:00Z", "generate-design", PRO, { user: U1 }),
  call("2026-10-10T09:00:00Z", "generate-design", PRO, { user: U1 }, false), // failed
  call("2026-10-10T10:00:00Z", "faq-chat", FLASH_TXT, { session: S1 }),
  call("2026-10-09T10:00:00Z", "upscale", FLASH_IMG, { user: U2 }),
  call("2026-10-09T11:00:00Z", "faq-chat", FLASH_TXT, { session: S1 }),
  call("2026-10-08T12:00:00Z", "generate-design", UNKNOWN, { user: U2 }), // no rate
  call("2026-10-08T13:00:00Z", "convert-bg-black", FLASH_IMG, {}), // no user, no session
  call("2026-10-07T21:00:00Z", "faq-chat", FLASH_TXT, {}), // 10-08 01:00 Tbilisi
];
const RANGE = { fromDay: "2026-10-08", toDay: "2026-10-10" };

describe("aiCostRates", () => {
  it("has the starting list prices", () => {
    expect(rateFor(PRO, "generate-design")).toEqual({ usd: 0.134, known: true });
    expect(rateFor(FLASH_IMG, "upscale")).toEqual({ usd: 0.039, known: true });
    expect(rateFor(FLASH_TXT, "faq-chat")).toEqual({ usd: 0.012, known: true });
  });
  it("unknown model → 0 and flagged", () => {
    expect(rateFor(UNKNOWN, "generate-design")).toEqual({ usd: 0, known: false });
    expect(rateFor("__proto__", "x")).toEqual({ usd: 0, known: false });
  });
  it("per-action override replaces the model rate for that action only", () => {
    const rates = { ...AI_COST_RATES, [PRO]: { perCall: 0.134, byAction: { upscale: 0.24 } } };
    expect(rateFor(PRO, "upscale", rates).usd).toBe(0.24);
    expect(rateFor(PRO, "restyle", rates).usd).toBe(0.134);
  });
});

describe("Tbilisi days and periods", () => {
  it("buckets by Tbilisi day, not UTC day", () => {
    expect(tbilisiDay("2026-10-09T19:59:59Z")).toBe("2026-10-09");
    expect(tbilisiDay("2026-10-09T20:00:00Z")).toBe("2026-10-10");
  });
  it("query bounds are Tbilisi midnights, end exclusive", () => {
    expect(queryBounds(RANGE)).toEqual({ fromIso: "2026-10-07T20:00:00.000Z", toIso: "2026-10-10T20:00:00.000Z" });
  });
  it("presets end today; custom is normalised", () => {
    expect(periodRange("today", "2026-10-10")).toEqual({ fromDay: "2026-10-10", toDay: "2026-10-10" });
    expect(periodRange("7d", "2026-10-10")).toEqual({ fromDay: "2026-10-04", toDay: "2026-10-10" });
    expect(periodRange("30d", "2026-03-05")).toEqual({ fromDay: "2026-02-04", toDay: "2026-03-05" });
    expect(periodRange("custom", "2026-10-10", { fromDay: "2026-10-09", toDay: "2026-10-01" })).toEqual({ fromDay: "2026-10-01", toDay: "2026-10-09" });
    expect(daysNewestFirst(RANGE)).toEqual(["2026-10-10", "2026-10-09", "2026-10-08"]);
  });
});

describe("aggregateAiSpend", () => {
  const s = aggregateAiSpend(FIXTURE, RANGE);

  it("totals: successful calls costed, failed counted apart, unknown flagged", () => {
    expect(s.totals).toEqual({ calls: 8, failed: 1, usd: 0.382, unknownRateCalls: 1 });
    expect(s.unknownModels).toEqual([{ model: UNKNOWN, calls: 1 }]);
    expect(s.topAction).toEqual({ action: "generate-design", calls: 3, failed: 1, usd: 0.268 });
    expect(s.actions).toEqual(["generate-design", "convert-bg-black", "upscale", "faq-chat"]);
  });

  it("by day, newest first, per action", () => {
    expect(s.byDay.map((d) => [d.day, d.calls, d.failed, d.usd])).toEqual([
      ["2026-10-10", 3, 1, 0.28],
      ["2026-10-09", 2, 0, 0.051],
      ["2026-10-08", 3, 0, 0.051],
    ]);
    expect(s.byDay[0].perAction).toEqual({
      "generate-design": { calls: 2, failed: 1, usd: 0.268 },
      "faq-chat": { calls: 1, failed: 0, usd: 0.012 },
    });
  });

  it("by who: users, sessions, one unknown-guest row; sorted by estimated $", () => {
    expect(s.byWho.map((w) => [w.kind, w.userId ?? w.sessionId, w.calls, w.failed, w.usd])).toEqual([
      ["user", U1, 2, 1, 0.268],
      ["unknown", null, 2, 0, 0.051],
      ["user", U2, 2, 0, 0.039],
      ["session", S1, 2, 0, 0.024],
    ]);
    expect(s.byWho[0].firstAt).toBe("2026-10-09T21:30:00Z");
    expect(s.byWho[0].lastAt).toBe("2026-10-10T09:00:00Z");
  });

  it("costFailed also costs failed calls", () => {
    const f = aggregateAiSpend(FIXTURE, RANGE, { costFailed: true });
    expect(f.totals.usd).toBe(0.516);
    expect(f.byWho[0].usd).toBe(0.402);
  });

  it("empty period → zero rows per day, no top action", () => {
    const e = aggregateAiSpend([], RANGE);
    expect(e.topAction).toBeNull();
    expect(e.byDay).toHaveLength(3);
    expect(e.totals).toEqual({ calls: 0, failed: 0, usd: 0, unknownRateCalls: 0 });
  });
});

describe("countConfirmedOrders", () => {
  it("counts checkouts: rows sharing a cart_id are one order", () => {
    const m = countConfirmedOrders([
      { id: "a", cart_id: "c1", user_id: U1 },
      { id: "b", cart_id: "c1", user_id: U1 },
      { id: "c", cart_id: null, user_id: U1 },
      { id: "d", cart_id: null, user_id: U2 },
      { id: "e", cart_id: null, user_id: null },
    ]);
    expect(Object.fromEntries(m)).toEqual({ [U1]: 2, [U2]: 1 });
  });
});

describe("fetchAllPages", () => {
  const source = Array.from({ length: 2300 }, (_, i) => i);
  // Server that caps every response at `cap` rows regardless of the range.
  const server = (cap: number, reportTotal: boolean) => {
    const ranges: [number, number][] = [];
    const fetchPage = async (from: number, to: number) => {
      ranges.push([from, to]);
      return { rows: source.slice(from, Math.min(to + 1, from + cap)), total: reportTotal ? source.length : null };
    };
    return { ranges, fetchPage };
  };

  it("reads everything with 1000-row ranges", async () => {
    const s = server(1000, true);
    const r = await fetchAllPages(s.fetchPage);
    expect(r.rows).toEqual(source);
    expect(r.truncated).toBe(false);
    expect(s.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("a server cap below the page size costs requests, never rows", async () => {
    const s = server(500, true);
    const r = await fetchAllPages(s.fetchPage);
    expect(r.rows).toEqual(source);
    expect(s.ranges).toHaveLength(5);
  });

  it("without a total, stops at the first empty page", async () => {
    const s = server(500, false);
    const r = await fetchAllPages(s.fetchPage);
    expect(r.rows).toEqual(source);
    expect(s.ranges.at(-1)).toEqual([2300, 3299]);
  });

  it("maxRows stops loudly, not silently", async () => {
    const r = await fetchAllPages(server(1000, true).fetchPage, { maxRows: 1000 });
    expect(r.rows).toHaveLength(1000);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(2300);
  });
});

describe("formatUsd", () => {
  it("formats", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.382)).toBe("$0.38");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});
