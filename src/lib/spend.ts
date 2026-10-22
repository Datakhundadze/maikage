// Pure helpers for the admin "ხარჯები" (Spend) tab — no Supabase, no React, so
// they are unit-tested in src/test/spend.test.ts.
//
// Money model: everything is summed in USD; GEL is a display conversion through
// the single spend_settings.usd_gel rate (1 USD = rate GEL). A fixed cost billed
// in GEL is converted GEL → USD with the same rate before it is summed.

export const SPEND_TZ = "Asia/Tbilisi";

// ---------------------------------------------------------------------------
// Months (Asia/Tbilisi)
// ---------------------------------------------------------------------------

/** "YYYY-MM" key for a month. `month` is 1–12. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `tz` from UTC at instant `date`, in minutes (Tbilisi: +240). */
export function tzOffsetMinutes(date: Date, tz: string = SPEND_TZ): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

/** The UTC instant of local midnight on year-month-day in `tz`. */
function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  const first = guess - offset * 60000;
  // Re-check at the corrected instant in case an offset change sits in between.
  const offset2 = tzOffsetMinutes(new Date(first), tz);
  return new Date(guess - offset2 * 60000);
}

/** The month (in `tz`) that instant `now` falls in. */
export function currentMonth(now: Date = new Date(), tz: string = SPEND_TZ): { year: number; month: number } {
  const p = zonedParts(now, tz);
  return { year: p.year, month: p.month };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export interface MonthBounds {
  /** Inclusive start, ISO UTC timestamp (local midnight on the 1st). */
  fromIso: string;
  /** Exclusive end, ISO UTC timestamp (local midnight on the 1st of next month). */
  toIso: string;
  /** First calendar day of the month, "YYYY-MM-DD". */
  firstDay: string;
  /** Last calendar day of the month, "YYYY-MM-DD". */
  lastDay: string;
  /** First calendar day of the next month, "YYYY-MM-DD" (exclusive bound for date columns). */
  nextFirstDay: string;
}

export function monthBounds(year: number, month: number, tz: string = SPEND_TZ): MonthBounds {
  const next = shiftMonth(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromIso: zonedMidnight(year, month, 1, tz).toISOString(),
    toIso: zonedMidnight(next.year, next.month, 1, tz).toISOString(),
    firstDay: `${monthKey(year, month)}-01`,
    lastDay: `${monthKey(year, month)}-${String(daysInMonth).padStart(2, "0")}`,
    nextFirstDay: `${monthKey(next.year, next.month)}-01`,
  };
}

const GEO_MONTHS = [
  "იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
  "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი",
];

export function monthLabel(year: number, month: number): string {
  return `${GEO_MONTHS[month - 1] ?? month} ${year}`;
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export type Currency = "USD" | "GEL";

export function isValidRate(rate: number | null | undefined): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/** Convert an amount in `currency` to USD. GEL without a valid rate → null. */
export function toUsd(amount: number, currency: Currency, usdGel: number | null | undefined): number | null {
  if (!Number.isFinite(amount)) return null;
  if (currency === "USD") return amount;
  if (!isValidRate(usdGel)) return null;
  return amount / usdGel;
}

export function usdToGel(usd: number, usdGel: number | null | undefined): number | null {
  if (!isValidRate(usdGel) || !Number.isFinite(usd)) return null;
  return usd * usdGel;
}

export function formatUsd(usd: number): string {
  const sign = usd < 0 ? "-" : "";
  return `${sign}$${Math.abs(usd).toFixed(2)}`;
}

export function formatGel(gel: number): string {
  return `${gel.toFixed(2)} ₾`;
}

/** "$12.40 · 33.48 ₾" — or "$12.40" when there is no usable rate. */
export function formatUsdGel(usd: number | null | undefined, usdGel: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  const gel = usdToGel(usd, usdGel);
  return gel == null ? formatUsd(usd) : `${formatUsd(usd)} · ${formatGel(gel)}`;
}

// ---------------------------------------------------------------------------
// Fixed costs (subscriptions)
// ---------------------------------------------------------------------------

export type FixedPeriod = "monthly" | "yearly" | "one_off";

export interface FixedCostLike {
  amount: number | string | null;
  currency: Currency;
  period: FixedPeriod;
  start_on: string | null;
  end_on: string | null;
  paid_on: string | null;
  active: boolean | null;
}

/**
 * The share of a fixed cost that lands in the given month, in the cost's OWN
 * currency (0 when it does not apply):
 *  - inactive → 0
 *  - one_off → full amount only when paid_on falls inside the month
 *  - monthly → amount; yearly → amount / 12 — both only when the month overlaps
 *    [start_on, end_on] (either bound may be null = open)
 */
export function fixedCostMonthlyAmount(c: FixedCostLike, b: Pick<MonthBounds, "firstDay" | "lastDay">): number {
  if (c.active === false) return 0;
  const amount = Number(c.amount);
  if (!Number.isFinite(amount)) return 0;
  if (c.period === "one_off") {
    if (!c.paid_on) return 0;
    const d = c.paid_on.slice(0, 10);
    return d >= b.firstDay && d <= b.lastDay ? amount : 0;
  }
  if (c.start_on && c.start_on.slice(0, 10) > b.lastDay) return 0;
  if (c.end_on && c.end_on.slice(0, 10) < b.firstDay) return 0;
  if (c.period === "monthly") return amount;
  if (c.period === "yearly") return amount / 12;
  return 0;
}

/** fixedCostMonthlyAmount converted to USD (null if GEL and no valid rate). */
export function fixedCostMonthlyUsd(
  c: FixedCostLike,
  b: Pick<MonthBounds, "firstDay" | "lastDay">,
  usdGel: number | null | undefined,
): number | null {
  const own = fixedCostMonthlyAmount(c, b);
  if (own === 0) return 0;
  return toUsd(own, c.currency, usdGel);
}

// ---------------------------------------------------------------------------
// AI spend (admin_ai_spend RPC rows)
// ---------------------------------------------------------------------------

export const AI_ACTION_LABELS: Record<string, string> = {
  "generate-design": "დიზაინის გენერაცია",
  "edit-image": "რედაქტირება",
  "isolate-subject": "ფონის მოხსნა (ფოტო)",
  "isolate-design": "ფონის მოხსნა (დიზაინი)",
  "edit-image-cutout": "რედაქტირება+ფონი",
  "convert-bg-black": "თეთრის ამოღება",
  upscale: "ხარისხის გაზრდა",
  restyle: "სტილის შეცვლა",
  "virtual-tryon": "ვირტუალური მორგება",
  "faq-chat": "ჩატ-ბოტი",
  "randomize-prompt": "იდეის გენერაცია",
  "social-reply-draft": "სოც. პასუხის დრაფტი",
  "probe-image-model": "მოდელების ტესტი",
  "probe-image-edit": "მოდელების ტესტი (ფოტო)",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  return Object.prototype.hasOwnProperty.call(AI_ACTION_LABELS, action) ? AI_ACTION_LABELS[action] : action;
}

export interface AiSpendRow {
  day: string;
  action: string;
  model: string;
  calls_ok: number;
  calls_failed: number;
  calls_failed_maybe_billed: number;
  unit_cost: number | null;
  cost: number | null;
  cost_max: number | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalise raw RPC rows (bigint/numeric may arrive as strings). */
export function normalizeAiRows(raw: unknown): AiSpendRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: Record<string, unknown>) => ({
    day: String(r.day ?? "").slice(0, 10),
    action: String(r.action ?? ""),
    model: String(r.model ?? ""),
    calls_ok: num(r.calls_ok),
    calls_failed: num(r.calls_failed),
    calls_failed_maybe_billed: num(r.calls_failed_maybe_billed),
    unit_cost: numOrNull(r.unit_cost),
    cost: numOrNull(r.cost),
    cost_max: numOrNull(r.cost_max),
  }));
}

export interface AiGroup {
  key: string;
  callsOk: number;
  callsFailed: number;
  callsFailedMaybeBilled: number;
  cost: number;
  costMax: number;
  models: string[];
  unpricedModels: string[];
}

export interface AiSummary {
  cost: number;
  costMax: number;
  callsOk: number;
  callsFailed: number;
  /** Models seen this month with unit_cost NULL (their cost is not counted). */
  unpricedModels: string[];
  byAction: AiGroup[];
  /** Newest day first. */
  byDay: AiGroup[];
}

function emptyGroup(key: string): AiGroup {
  return { key, callsOk: 0, callsFailed: 0, callsFailedMaybeBilled: 0, cost: 0, costMax: 0, models: [], unpricedModels: [] };
}

function addTo(g: AiGroup, r: AiSpendRow) {
  g.callsOk += r.calls_ok;
  g.callsFailed += r.calls_failed;
  g.callsFailedMaybeBilled += r.calls_failed_maybe_billed;
  g.cost += r.cost ?? 0;
  g.costMax += r.cost_max ?? r.cost ?? 0;
  if (r.model && !g.models.includes(r.model)) g.models.push(r.model);
  if (r.unit_cost == null && r.model && !g.unpricedModels.includes(r.model)) g.unpricedModels.push(r.model);
}

export function summarizeAiSpend(rows: AiSpendRow[]): AiSummary {
  const total = emptyGroup("total");
  const byAction = new Map<string, AiGroup>();
  const byDay = new Map<string, AiGroup>();
  for (const r of rows) {
    addTo(total, r);
    if (!byAction.has(r.action)) byAction.set(r.action, emptyGroup(r.action));
    addTo(byAction.get(r.action)!, r);
    if (!byDay.has(r.day)) byDay.set(r.day, emptyGroup(r.day));
    addTo(byDay.get(r.day)!, r);
  }
  return {
    cost: total.cost,
    costMax: total.costMax,
    callsOk: total.callsOk,
    callsFailed: total.callsFailed,
    unpricedModels: total.unpricedModels.sort(),
    byAction: [...byAction.values()].sort(
      (a, b) => b.cost - a.cost || b.callsOk + b.callsFailed - (a.callsOk + a.callsFailed) || a.key.localeCompare(b.key),
    ),
    byDay: [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key)),
  };
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

/** Cost per result in USD; null when there are no results. */
export function costPerResult(amountUsd: number | string | null, results: number | string | null): number | null {
  const a = Number(amountUsd);
  const r = Number(results);
  if (!Number.isFinite(a) || !Number.isFinite(r) || r <= 0) return null;
  return a / r;
}

/** Parse a user-typed decimal ("12,5" or "12.5"). Empty → null; junk → NaN. */
export function parseDecimalInput(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  return /^-?\d*\.?\d+$|^-?\d+\.$/.test(t) ? Number(t) : NaN;
}
