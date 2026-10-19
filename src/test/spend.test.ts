import { describe, expect, it } from "vitest";
import {
  actionLabel,
  costPerResult,
  currentMonth,
  fixedCostMonthlyAmount,
  fixedCostMonthlyUsd,
  formatUsdGel,
  monthBounds,
  monthLabel,
  normalizeAiRows,
  parseDecimalInput,
  parseMonthKey,
  shiftMonth,
  summarizeAiSpend,
  toUsd,
  tzOffsetMinutes,
  type FixedCostLike,
} from "@/lib/spend";

describe("months in Asia/Tbilisi", () => {
  it("Tbilisi is UTC+4", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(240);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(240);
  });

  it("month bounds are local midnights, as UTC ISO", () => {
    const b = monthBounds(2026, 10);
    expect(b.fromIso).toBe("2026-09-30T20:00:00.000Z");
    expect(b.toIso).toBe("2026-10-31T20:00:00.000Z");
    expect(b.firstDay).toBe("2026-10-01");
    expect(b.lastDay).toBe("2026-10-31");
    expect(b.nextFirstDay).toBe("2026-11-01");
  });

  it("December rolls into next year; February length", () => {
    const d = monthBounds(2026, 12);
    expect(d.toIso).toBe("2026-12-31T20:00:00.000Z");
    expect(d.nextFirstDay).toBe("2027-01-01");
    expect(monthBounds(2028, 2).lastDay).toBe("2028-02-29");
    expect(monthBounds(2027, 2).lastDay).toBe("2027-02-28");
  });

  it("current month follows Tbilisi, not UTC", () => {
    // 2026-10-31 21:30 UTC = 2026-11-01 01:30 in Tbilisi
    expect(currentMonth(new Date("2026-10-31T21:30:00Z"))).toEqual({ year: 2026, month: 11 });
    expect(currentMonth(new Date("2026-10-31T19:30:00Z"))).toEqual({ year: 2026, month: 10 });
  });

  it("shiftMonth / parseMonthKey / monthLabel", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 5, -17)).toEqual({ year: 2024, month: 12 });
    expect(parseMonthKey("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("x")).toBeNull();
    expect(monthLabel(2026, 10)).toBe("ოქტომბერი 2026");
  });
});

describe("currency", () => {
  it("converts GEL to USD with the rate", () => {
    expect(toUsd(27, "GEL", 2.7)).toBeCloseTo(10, 10);
    expect(toUsd(5, "USD", null)).toBe(5);
    expect(toUsd(27, "GEL", null)).toBeNull();
    expect(toUsd(27, "GEL", 0)).toBeNull();
  });

  it("formats both currencies", () => {
    expect(formatUsdGel(12.4, 2.7)).toBe("$12.40 · 33.48 ₾");
    expect(formatUsdGel(0, 2.7)).toBe("$0.00 · 0.00 ₾");
    expect(formatUsdGel(12.4, null)).toBe("$12.40");
    expect(formatUsdGel(null, 2.7)).toBe("—");
  });

  it("parses typed decimals", () => {
    expect(parseDecimalInput("12,5")).toBe(12.5);
    expect(parseDecimalInput(" 0.04 ")).toBe(0.04);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNaN();
  });
});

describe("fixed costs per month", () => {
  const oct = monthBounds(2026, 10);
  const base: FixedCostLike = {
    amount: 20, currency: "USD", period: "monthly",
    start_on: null, end_on: null, paid_on: null, active: true,
  };

  it("monthly → amount, yearly → amount / 12", () => {
    expect(fixedCostMonthlyAmount(base, oct)).toBe(20);
    expect(fixedCostMonthlyAmount({ ...base, period: "yearly", amount: 120 }, oct)).toBe(10);
    expect(fixedCostMonthlyAmount({ ...base, amount: "19.99" }, oct)).toBeCloseTo(19.99);
  });

  it("inactive → 0", () => {
    expect(fixedCostMonthlyAmount({ ...base, active: false }, oct)).toBe(0);
  });

  it("respects start_on / end_on", () => {
    expect(fixedCostMonthlyAmount({ ...base, start_on: "2026-11-01" }, oct)).toBe(0);
    expect(fixedCostMonthlyAmount({ ...base, start_on: "2026-10-31" }, oct)).toBe(20);
    expect(fixedCostMonthlyAmount({ ...base, end_on: "2026-09-30" }, oct)).toBe(0);
    expect(fixedCostMonthlyAmount({ ...base, end_on: "2026-10-01" }, oct)).toBe(20);
    expect(fixedCostMonthlyAmount({ ...base, start_on: "2026-01-01", end_on: "2026-12-31" }, oct)).toBe(20);
  });

  it("one_off counts only when paid_on is in the month", () => {
    const one = { ...base, period: "one_off" as const, amount: 300 };
    expect(fixedCostMonthlyAmount({ ...one, paid_on: "2026-10-05" }, oct)).toBe(300);
    expect(fixedCostMonthlyAmount({ ...one, paid_on: "2026-10-31" }, oct)).toBe(300);
    expect(fixedCostMonthlyAmount({ ...one, paid_on: "2026-11-01" }, oct)).toBe(0);
    expect(fixedCostMonthlyAmount({ ...one, paid_on: null }, oct)).toBe(0);
  });

  it("GEL costs convert to USD", () => {
    expect(fixedCostMonthlyUsd({ ...base, amount: 54, currency: "GEL" }, oct, 2.7)).toBeCloseTo(20);
    expect(fixedCostMonthlyUsd({ ...base, amount: 54, currency: "GEL" }, oct, null)).toBeNull();
    expect(fixedCostMonthlyUsd({ ...base, amount: 54, currency: "GEL", active: false }, oct, null)).toBe(0);
  });
});

describe("AI spend", () => {
  it("labels known actions and passes unknown ids through", () => {
    expect(actionLabel("generate-design")).toBe("დიზაინის გენერაცია");
    expect(actionLabel("probe-image-model")).toBe("მოდელების ტესტი");
    expect(actionLabel("something-new")).toBe("something-new");
    expect(actionLabel("toString")).toBe("toString");
    expect(actionLabel(null)).toBe("—");
  });

  it("normalises string numerics and keeps NULL unit_cost", () => {
    const rows = normalizeAiRows([
      { day: "2026-10-18", action: "upscale", model: "m1", calls_ok: "3", calls_failed: "1", calls_failed_maybe_billed: "0", unit_cost: null, cost: null, cost_max: null },
    ]);
    expect(rows[0]).toMatchObject({ calls_ok: 3, calls_failed: 1, unit_cost: null, cost: null });
    expect(normalizeAiRows(null)).toEqual([]);
  });

  it("summarises by action and by day (newest first)", () => {
    const rows = normalizeAiRows([
      { day: "2026-10-17", action: "generate-design", model: "a", calls_ok: 10, calls_failed: 1, calls_failed_maybe_billed: 1, unit_cost: 0.04, cost: 0.4, cost_max: 0.44 },
      { day: "2026-10-18", action: "generate-design", model: "a", calls_ok: 5, calls_failed: 0, calls_failed_maybe_billed: 0, unit_cost: 0.04, cost: 0.2, cost_max: 0.2 },
      { day: "2026-10-18", action: "upscale", model: "b", calls_ok: 2, calls_failed: 2, calls_failed_maybe_billed: 0, unit_cost: null, cost: null, cost_max: null },
    ]);
    const s = summarizeAiSpend(rows);
    expect(s.cost).toBeCloseTo(0.6);
    expect(s.costMax).toBeCloseTo(0.64);
    expect(s.callsOk).toBe(17);
    expect(s.callsFailed).toBe(3);
    expect(s.unpricedModels).toEqual(["b"]);
    expect(s.byAction.map((g) => g.key)).toEqual(["generate-design", "upscale"]);
    expect(s.byAction[1].unpricedModels).toEqual(["b"]);
    expect(s.byDay.map((g) => g.key)).toEqual(["2026-10-18", "2026-10-17"]);
    expect(s.byDay[0].cost).toBeCloseTo(0.2);
  });

  it("empty input → zero summary", () => {
    const s = summarizeAiSpend([]);
    expect(s).toMatchObject({ cost: 0, costMax: 0, callsOk: 0, byAction: [], byDay: [] });
  });
});

describe("marketing", () => {
  it("cost per result", () => {
    expect(costPerResult(30, 6)).toBe(5);
    expect(costPerResult("30.00", "3")).toBe(10);
    expect(costPerResult(30, 0)).toBeNull();
    expect(costPerResult(30, null)).toBeNull();
  });
});
