// Pure aggregation for the admin "AI ხარჯი" tab (AdminAiSpend.tsx).
//
// Everything here is side-effect free so it can be unit-tested without a
// database: Tbilisi-day arithmetic, the period picker's ranges, the per-day /
// per-person roll-ups, the confirmed-order count and the paginator that keeps
// PostgREST's row ceiling from silently truncating a period.
//
// Costs come from aiCostRates.ts and are ESTIMATES at public list prices.
// Only successful calls are costed unless costFailed is set; failed calls are
// always counted separately.

import { rateFor } from "@/lib/aiCostRates";

export const TBILISI_TZ = "Asia/Tbilisi";

/** The ai_calls columns the tab reads. */
export interface AiCallRow {
  created_at: string;
  action: string;
  model: string;
  user_id: string | null;
  session_id: string | null;
  is_guest: boolean;
  success: boolean;
  duration_ms?: number | null;
  error_code?: string | null;
}

// ── Tbilisi days ────────────────────────────────────────────────────────────

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TBILISI_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" of the instant in Asia/Tbilisi. */
export function tbilisiDay(at: string | Date): string {
  return dayFormatter.format(typeof at === "string" ? new Date(at) : at);
}

/** Calendar arithmetic on a "YYYY-MM-DD" string (no time zone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TBILISI_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Tbilisi's UTC offset in ms at the given instant (via Intl, not hard-coded). */
function tbilisiOffsetMs(at: number): number {
  const p = Object.fromEntries(partsFormatter.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** ISO instant of 00:00 Tbilisi time on `day`. */
export function tbilisiDayStartIso(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tbilisiOffsetMs(guess - tbilisiOffsetMs(guess))).toISOString();
}

// ── Period picker ───────────────────────────────────────────────────────────

export type PeriodPreset = "today" | "7d" | "30d" | "custom";

/** Inclusive range of Tbilisi days. */
export interface DayRange {
  fromDay: string;
  toDay: string;
}

/**
 * The days a preset covers, ending on `today` (a Tbilisi day). "7d" is today
 * and the six days before it. A custom range is normalised so from ≤ to.
 */
export function periodRange(preset: PeriodPreset, today: string, custom?: DayRange): DayRange {
  if (preset === "today") return { fromDay: today, toDay: today };
  if (preset === "7d") return { fromDay: addDays(today, -6), toDay: today };
  if (preset === "30d") return { fromDay: addDays(today, -29), toDay: today };
  const from = custom?.fromDay || today;
  const to = custom?.toDay || today;
  return from <= to ? { fromDay: from, toDay: to } : { fromDay: to, toDay: from };
}

/** created_at bounds for the query: [fromIso, toIso). */
export function queryBounds(range: DayRange): { fromIso: string; toIso: string } {
  return { fromIso: tbilisiDayStartIso(range.fromDay), toIso: tbilisiDayStartIso(addDays(range.toDay, 1)) };
}

/** Every day of the range, newest first. */
export function daysNewestFirst(range: DayRange): string[] {
  const days: string[] = [];
  for (let d = range.toDay; d >= range.fromDay; d = addDays(d, -1)) days.push(d);
  return days;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export interface CallTally {
  /** Successful calls. */
  calls: number;
  /** Failed calls (always counted, costed only with costFailed). */
  failed: number;
  /** Estimated USD. */
  usd: number;
}

export interface DayRow extends CallTally {
  day: string;
  perAction: Record<string, CallTally>;
}

export type WhoKind = "user" | "session" | "unknown";

export interface WhoRow extends CallTally {
  key: string;
  kind: WhoKind;
  userId: string | null;
  sessionId: string | null;
  perAction: Record<string, CallTally>;
  firstAt: string;
  lastAt: string;
}

export interface AiSpendSummary {
  totals: CallTally & {
    /** Calls (successful, or failed when costed) whose model has no rate. */
    unknownRateCalls: number;
  };
  /** Models with no rate, with how many calls used them. */
  unknownModels: { model: string; calls: number }[];
  /** Highest estimated USD (ties: more calls, then name). null when empty. */
  topAction: ({ action: string } & CallTally) | null;
  /** Actions seen, highest estimated USD first. */
  actions: string[];
  byDay: DayRow[];
  byWho: WhoRow[];
}

export interface AggregateOptions {
  /** Also cost failed calls. Default false. */
  costFailed?: boolean;
}

const emptyTally = (): CallTally => ({ calls: 0, failed: 0, usd: 0 });

function addTo(t: CallTally, success: boolean, usd: number) {
  if (success) t.calls += 1;
  else t.failed += 1;
  t.usd += usd;
}

function tallyFor(per: Record<string, CallTally>, action: string): CallTally {
  if (!per[action]) per[action] = emptyTally();
  return per[action];
}

function whoOf(row: AiCallRow): { key: string; kind: WhoKind } {
  if (row.user_id) return { key: `user:${row.user_id}`, kind: "user" };
  if (row.session_id) return { key: `session:${row.session_id}`, kind: "session" };
  return { key: "unknown", kind: "unknown" };
}

/** Rounds away float noise (0.1 + 0.2) without hiding real fractions of a cent. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

export function aggregateAiSpend(rows: AiCallRow[], range: DayRange, opts: AggregateOptions = {}): AiSpendSummary {
  const costFailed = opts.costFailed ?? false;
  const totals = { ...emptyTally(), unknownRateCalls: 0 };
  const unknown = new Map<string, number>();
  const actionTotals = new Map<string, CallTally>();
  const days = new Map<string, DayRow>(
    daysNewestFirst(range).map((day) => [day, { day, ...emptyTally(), perAction: {} }]),
  );
  const who = new Map<string, WhoRow>();

  for (const row of rows) {
    const rate = rateFor(row.model, row.action);
    const costed = row.success || costFailed;
    const usd = costed ? rate.usd : 0;
    if (costed && !rate.known) {
      totals.unknownRateCalls += 1;
      unknown.set(row.model, (unknown.get(row.model) ?? 0) + 1);
    }

    addTo(totals, row.success, usd);

    let a = actionTotals.get(row.action);
    if (!a) actionTotals.set(row.action, (a = emptyTally()));
    addTo(a, row.success, usd);

    const dayKey = tbilisiDay(row.created_at);
    let day = days.get(dayKey);
    if (!day) days.set(dayKey, (day = { day: dayKey, ...emptyTally(), perAction: {} }));
    addTo(day, row.success, usd);
    addTo(tallyFor(day.perAction, row.action), row.success, usd);

    const { key, kind } = whoOf(row);
    let w = who.get(key);
    if (!w) {
      w = {
        key,
        kind,
        userId: kind === "user" ? row.user_id : null,
        sessionId: kind === "session" ? row.session_id : null,
        ...emptyTally(),
        perAction: {},
        firstAt: row.created_at,
        lastAt: row.created_at,
      };
      who.set(key, w);
    }
    addTo(w, row.success, usd);
    addTo(tallyFor(w.perAction, row.action), row.success, usd);
    if (new Date(row.created_at) < new Date(w.firstAt)) w.firstAt = row.created_at;
    if (new Date(row.created_at) > new Date(w.lastAt)) w.lastAt = row.created_at;
  }

  const tidyTally = <T extends CallTally>(t: T): T => {
    t.usd = tidy(t.usd);
    return t;
  };
  const tidyPer = (per: Record<string, CallTally>) => {
    for (const k of Object.keys(per)) tidyTally(per[k]);
    return per;
  };

  const byUsdThenCalls = (a: CallTally, b: CallTally) => b.usd - a.usd || b.calls - a.calls;
  const actionEntries = [...actionTotals.entries()]
    .map(([action, t]) => ({ action, ...tidyTally(t) }))
    .sort((a, b) => byUsdThenCalls(a, b) || a.action.localeCompare(b.action));

  return {
    totals: tidyTally(totals),
    unknownModels: [...unknown.entries()]
      .map(([model, calls]) => ({ model, calls }))
      .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
    topAction: actionEntries[0] ?? null,
    actions: actionEntries.map((a) => a.action),
    byDay: [...days.values()]
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
      .map((d) => ({ ...tidyTally(d), perAction: tidyPer(d.perAction) })),
    byWho: [...who.values()]
      .map((w) => ({ ...tidyTally(w), perAction: tidyPer(w.perAction) }))
      .sort((a, b) => byUsdThenCalls(a, b) || a.key.localeCompare(b.key)),
  };
}

// ── Confirmed orders ────────────────────────────────────────────────────────

export interface PaidOrderRow {
  id: string;
  cart_id: string | null;
  user_id: string | null;
}

/**
 * Confirmed (paid) orders per user, counted as CHECKOUTS: a multi-item cart
 * or a quantity > 1 inserts one row per item sharing a cart_id, and those rows
 * are one order to the customer. Rows without a cart_id are one order each.
 */
export function countConfirmedOrders(rows: PaidOrderRow[]): Map<string, number> {
  const checkouts = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.user_id) continue;
    let set = checkouts.get(r.user_id);
    if (!set) checkouts.set(r.user_id, (set = new Set()));
    set.add(r.cart_id ?? r.id);
  }
  return new Map([...checkouts.entries()].map(([user, set]) => [user, set.size]));
}

// ── Pagination ──────────────────────────────────────────────────────────────

export interface Page<T> {
  rows: T[];
  /** Exact total for the query, when the server reported one. */
  total: number | null;
}

export interface FetchAllResult<T> {
  rows: T[];
  total: number | null;
  /** True only when maxRows stopped the loop before the total was reached. */
  truncated: boolean;
}

/**
 * Reads every page of a query with explicit ranges. Advances by the number of
 * rows actually RECEIVED, so a server row cap smaller than pageSize costs
 * extra requests instead of silently dropping rows, and stops at the exact
 * total (when known) or at the first empty page.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
  { pageSize = 1000, maxRows = 200_000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<FetchAllResult<T>> {
  const rows: T[] = [];
  let total: number | null = null;
  for (;;) {
    if (total !== null && rows.length >= total) return { rows, total, truncated: false };
    if (rows.length >= maxRows) return { rows, total, truncated: true };
    const page = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (page.total !== null) total = page.total;
    if (page.rows.length === 0) return { rows, total, truncated: false };
    rows.push(...page.rows);
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export const shortId = (id: string, n = 8) => id.slice(0, n);
