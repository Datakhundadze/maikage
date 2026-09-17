import { describe, it, expect } from "vitest";
import {
  chargeRateLimit,
  PG_INT_MAX,
  type RateLimitArgs,
  type RateLimitRpc,
} from "../../supabase/functions/gemini-proxy/rateLimitCharge";

/**
 * In-memory replica of public.check_and_increment_rate_limit — same sliding
 * windows, same `count >= limit → false`, same insert-then-prune of THIS key's
 * rows older than a day. `now` is injectable so the windows can be walked.
 */
function makeLimiter(clock: { now: number }) {
  const rows: { key: string; at: number }[] = [];
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const calls: RateLimitArgs[] = [];
  const rpc: RateLimitRpc = async (_fn, args) => {
    calls.push(args);
    const now = clock.now;
    const mine = rows.filter((r) => r.key === args.p_key);
    const vHour = mine.filter((r) => r.at >= now - HOUR).length;
    const vDay = mine.filter((r) => r.at >= now - DAY).length;
    if (vHour >= args.p_hour_limit || vDay >= args.p_day_limit) return { data: false, error: null };
    rows.push({ key: args.p_key, at: now });
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].key === args.p_key && rows[i].at < now - DAY) rows.splice(i, 1);
    }
    return { data: true, error: null };
  };
  return { rpc, rows, calls, count: (key: string) => rows.filter((r) => r.key === key).length };
}

const GUEST = { hourLimit: 4, dayLimit: 3 };
const KEY = "gen:ip:203.0.113.7";

describe("chargeRateLimit — guest 4 units/hour, 3 units/day", () => {
  it("charges a 2-unit action as two rows and leaves room for one more call that hour", async () => {
    const clock = { now: 1_000_000_000_000 };
    const lim = makeLimiter(clock);

    const iso = await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 });
    expect(iso.allowed).toBe(true);
    expect(iso.charged).toBe(2);
    expect(lim.count(KEY)).toBe(2);
    // Gate call carried the reduced limits; top-up carried INT_MAX.
    expect(lim.calls[0]).toEqual({ p_key: KEY, p_hour_limit: 3, p_day_limit: 2 });
    expect(lim.calls[1]).toEqual({ p_key: KEY, p_hour_limit: PG_INT_MAX, p_day_limit: PG_INT_MAX });

    const gen = await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 1 });
    expect(gen.allowed).toBe(true);
    expect(lim.count(KEY)).toBe(3);

    // Day allowance (3) is now spent: nothing else today, of any weight.
    const more1 = await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 1 });
    expect(more1.allowed).toBe(false);
    const more2 = await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 });
    expect(more2.allowed).toBe(false);
    expect(lim.count(KEY)).toBe(3);
  });

  it("refuses a second background removal in the same day, and charges nothing for the refusal", async () => {
    const clock = { now: 1_000_000_000_000 };
    const lim = makeLimiter(clock);
    expect((await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 })).allowed).toBe(true);
    const second = await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 });
    expect(second.allowed).toBe(false);
    expect(second.charged).toBe(0);
    expect(lim.count(KEY)).toBe(2);
    // The refusal made exactly one RPC (the gate) and no top-up.
    expect(lim.calls.length).toBe(3);
  });

  it("with a permissive day limit, the hourly cap alone allows two 2-unit actions and refuses a third", async () => {
    const clock = { now: 1_000_000_000_000 };
    const lim = makeLimiter(clock);
    const opts = { key: KEY, hourLimit: 4, dayLimit: 100, units: 2 };
    expect((await chargeRateLimit(lim.rpc, opts)).allowed).toBe(true);
    expect((await chargeRateLimit(lim.rpc, opts)).allowed).toBe(true);
    expect((await chargeRateLimit(lim.rpc, opts)).allowed).toBe(false);
    expect(lim.count(KEY)).toBe(4);
    // Hour passes → a 2-unit action fits again.
    clock.now += 3600_001;
    expect((await chargeRateLimit(lim.rpc, opts)).allowed).toBe(true);
  });

  it("prunes rows older than a day for the key on the next allowed call, top-up rows included", async () => {
    const clock = { now: 1_000_000_000_000 };
    const lim = makeLimiter(clock);
    await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 });
    await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 1 });
    expect(lim.count(KEY)).toBe(3);
    clock.now += 24 * 3600_000 + 1;
    const next = await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 });
    expect(next.allowed).toBe(true);
    // Yesterday's three rows are gone; only today's two remain.
    expect(lim.count(KEY)).toBe(2);
  });

  it("keeps other keys untouched and registered users on one unit per call", async () => {
    const clock = { now: 1_000_000_000_000 };
    const lim = makeLimiter(clock);
    const user = { key: "gen:user:abc", hourLimit: 30, dayLimit: 100, units: 1 };
    for (let i = 0; i < 30; i++) expect((await chargeRateLimit(lim.rpc, user)).allowed).toBe(true);
    expect((await chargeRateLimit(lim.rpc, user)).allowed).toBe(false);
    expect(lim.count("gen:user:abc")).toBe(30);
    // Every registered call carried the unreduced limits.
    expect(lim.calls.every((c) => c.p_hour_limit === 30 && c.p_day_limit === 100)).toBe(true);
    expect((await chargeRateLimit(lim.rpc, { key: KEY, ...GUEST, units: 2 })).allowed).toBe(true);
  });

  it("an action heavier than the allowance is refused without an RPC", async () => {
    const clock = { now: 1_000_000_000_000 };
    const lim = makeLimiter(clock);
    const r = await chargeRateLimit(lim.rpc, { key: KEY, hourLimit: 1, dayLimit: 3, units: 2 });
    expect(r.allowed).toBe(false);
    expect(lim.calls.length).toBe(0);
  });

  it("fails open on a gate error and reports a top-up error without refusing", async () => {
    let n = 0;
    const failing: RateLimitRpc = async () => ({ data: null, error: new Error("boom") });
    const gateErr = await chargeRateLimit(failing, { key: KEY, ...GUEST, units: 2 });
    expect(gateErr.allowed).toBe(true);
    expect(gateErr.error).toBeInstanceOf(Error);
    expect(gateErr.charged).toBe(0);

    const flaky: RateLimitRpc = async () => {
      n += 1;
      return n === 1 ? { data: true, error: null } : { data: null, error: new Error("top-up boom") };
    };
    const topErr = await chargeRateLimit(flaky, { key: KEY, ...GUEST, units: 2 });
    expect(topErr.allowed).toBe(true);
    expect(topErr.error).toBeNull();
    expect(topErr.charged).toBe(1);
    expect(topErr.topUpError).toBeInstanceOf(Error);
  });
});
