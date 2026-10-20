// Pure helpers for the „რეკლამები → შეკვეთები" section of the admin „ხარჯები"
// tab — no Supabase, no React; unit-tested in src/test/adFunnel.test.ts.
//
// ⚠️ The SQL in supabase/migrations/20261020140000_ad_funnel.sql
// (public.admin_ad_funnel) is AUTHORITATIVE — the tab shows what the RPC
// returns. The parsing / attribution rules below MIRROR it so they can be
// tested and so the UI can explain its numbers. Change both together.

// ---------------------------------------------------------------------------
// Staff-message conventions (direction = 'out' only)
// ---------------------------------------------------------------------------

/** Requisites sent. Substring, so the real typo „რეკვიზირებს" also matches. */
export const REQUISITES_RE = /რეკვიზ/u;

/** Payment confirmed (SQL: `~*` with the same alternation). */
export const PAYMENT_CONFIRM_RE = /ვადასტურებთ ჩარიცხ|გიდასტურებთ|ჩარიცხვა დადასტურ|მივიღეთ ჩარიცხ/iu;

/** Item price in GEL: „ღირებულება 85ლარია", „ღირებულება: 120,50 ლარი". First match wins. */
export const PRICE_RE = /ღირებულება[\s:]*(\d+(?:[.,]\d{1,2})?)\s*ლარ/u;

export function isRequisitesMessage(text: string | null | undefined): boolean {
  return !!text && REQUISITES_RE.test(text);
}

export function isPaymentConfirmation(text: string | null | undefined): boolean {
  return !!text && PAYMENT_CONFIRM_RE.test(text);
}

/** Price in GEL from one staff message, or null. Courier (+8 ₾) is never matched. */
export function parsePriceGel(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export interface ReferralLike {
  conversation_key: string;
  ad_id: string | null;
  occurred_at: string;
  ad_title?: string | null;
}

export interface MessageLike {
  conversation_key: string;
  direction: "in" | "out";
  text: string | null;
  sent_at: string;
}

const ms = (iso: string): number => new Date(iso).getTime();

/**
 * ad_id of the most recent referral of `conversationKey` at or before `atIso`
 * (null = organic / unknown, incl. a ref-only referral with no ad_id). On equal
 * occurred_at the later entry in `referrals` wins.
 */
export function pickReferralAd(referrals: ReferralLike[], conversationKey: string, atIso: string): string | null {
  const at = ms(atIso);
  let best: ReferralLike | null = null;
  for (const r of referrals) {
    if (r.conversation_key !== conversationKey) continue;
    const t = ms(r.occurred_at);
    if (!(t <= at)) continue;
    if (best == null || t >= ms(best.occurred_at)) best = r;
  }
  return best ? best.ad_id : null;
}

// ---------------------------------------------------------------------------
// RPC rows
// ---------------------------------------------------------------------------

export interface AdFunnelRow {
  /** null = organic / unknown. */
  ad_id: string | null;
  ad_name: string | null;
  /** null = no spend rows (always null for organic). */
  spend_usd: number | null;
  conversations: number;
  requisites: number;
  paid: number;
  /** null = no paid conversation with a known price. */
  revenue_gel: number | null;
  paid_without_price: number;
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
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Normalise raw admin_ad_funnel rows (bigint / numeric may arrive as strings). Organic last. */
export function normalizeFunnelRows(raw: unknown): AdFunnelRow[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw.map((r: Record<string, unknown>) => {
    const adId = strOrNull(r.ad_id);
    return {
      ad_id: adId,
      ad_name: strOrNull(r.ad_name),
      spend_usd: adId == null ? null : numOrNull(r.spend_usd),
      conversations: num(r.conversations),
      requisites: num(r.requisites),
      paid: num(r.paid),
      revenue_gel: numOrNull(r.revenue_gel),
      paid_without_price: num(r.paid_without_price),
    };
  });
  return [...rows.filter((r) => r.ad_id != null), ...rows.filter((r) => r.ad_id == null)];
}

/** Spend per paid order (USD). null when nothing is paid or there is no spend. */
export function costPerPaid(spendUsd: number | null, paid: number): number | null {
  if (spendUsd == null || !Number.isFinite(spendUsd) || spendUsd <= 0 || !(paid > 0)) return null;
  return spendUsd / paid;
}

export interface FunnelTotals {
  spendUsd: number;
  conversations: number;
  requisites: number;
  paid: number;
  /** null = no known price at all. */
  revenueGel: number | null;
  paidWithoutPrice: number;
  /** Paid conversations attributed to an ad (organic excluded) — the denominator of costPerPaid. */
  adPaid: number;
  /** Total ad spend ÷ ad-attributed paid orders (organic excluded). */
  costPerPaidUsd: number | null;
}

export function summarizeFunnel(rows: AdFunnelRow[]): FunnelTotals {
  let spendUsd = 0, conversations = 0, requisites = 0, paid = 0, paidWithoutPrice = 0, adPaid = 0;
  let revenueGel: number | null = null;
  for (const r of rows) {
    spendUsd += r.spend_usd ?? 0;
    conversations += r.conversations;
    requisites += r.requisites;
    paid += r.paid;
    paidWithoutPrice += r.paid_without_price;
    if (r.revenue_gel != null) revenueGel = (revenueGel ?? 0) + r.revenue_gel;
    if (r.ad_id != null) adPaid += r.paid;
  }
  return {
    spendUsd, conversations, requisites, paid, revenueGel, paidWithoutPrice, adPaid,
    costPerPaidUsd: costPerPaid(spendUsd, adPaid),
  };
}

// ---------------------------------------------------------------------------
// Reference implementation of the RPC's funnel counting (tests only)
// ---------------------------------------------------------------------------

/**
 * Same rules as admin_ad_funnel, minus spend / names:
 *  - unit = (conversation, ad attributed to each message)
 *  - unit is in range when its first inbound message is in [fromIso, toIso)
 *  - requisites / paid once per unit, from staff ('out') messages only
 *  - revenue = last staff price in the whole conversation at/before the unit's
 *    first confirmation
 */
export function computeFunnelCounts(
  messages: MessageLike[],
  referrals: ReferralLike[],
  fromIso: string,
  toIso: string,
): Omit<AdFunnelRow, "ad_name" | "spend_usd">[] {
  const from = ms(fromIso);
  const to = ms(toIso);
  const byConv = new Map<string, MessageLike[]>();
  for (const m of messages) {
    if (!byConv.has(m.conversation_key)) byConv.set(m.conversation_key, []);
    byConv.get(m.conversation_key)!.push(m);
  }

  interface Unit { ck: string; ad: string | null; firstIn: number | null; req: boolean; firstPaid: number | null }
  const units = new Map<string, Unit>();
  for (const [ck, list] of byConv) {
    if (!list.some((m) => m.direction === "in" && ms(m.sent_at) >= from && ms(m.sent_at) < to)) continue;
    for (const m of list) {
      const ad = pickReferralAd(referrals, ck, m.sent_at);
      const key = `${ck}\u0000${ad ?? ""}`;
      if (!units.has(key)) units.set(key, { ck, ad, firstIn: null, req: false, firstPaid: null });
      const u = units.get(key)!;
      const t = ms(m.sent_at);
      if (m.direction === "in") u.firstIn = u.firstIn == null ? t : Math.min(u.firstIn, t);
      if (m.direction === "out" && isRequisitesMessage(m.text)) u.req = true;
      if (m.direction === "out" && isPaymentConfirmation(m.text)) u.firstPaid = u.firstPaid == null ? t : Math.min(u.firstPaid, t);
    }
  }

  const out = new Map<string, Omit<AdFunnelRow, "ad_name" | "spend_usd">>();
  for (const u of units.values()) {
    if (u.firstIn == null || u.firstIn < from || u.firstIn >= to) continue;
    const k = u.ad ?? "";
    if (!out.has(k)) out.set(k, { ad_id: u.ad, conversations: 0, requisites: 0, paid: 0, revenue_gel: null, paid_without_price: 0 });
    const row = out.get(k)!;
    row.conversations += 1;
    if (u.req) row.requisites += 1;
    if (u.firstPaid != null) {
      row.paid += 1;
      let price: number | null = null;
      let priceAt = -Infinity;
      for (const m of byConv.get(u.ck) ?? []) {
        const t = ms(m.sent_at);
        if (m.direction !== "out" || t > u.firstPaid || t < priceAt) continue;
        const p = parsePriceGel(m.text);
        if (p != null) { price = p; priceAt = t; }
      }
      if (price == null) row.paid_without_price += 1;
      else row.revenue_gel = (row.revenue_gel ?? 0) + price;
    }
  }
  return [...out.values()].sort((a, b) => (a.ad_id == null ? 1 : 0) - (b.ad_id == null ? 1 : 0) || String(a.ad_id).localeCompare(String(b.ad_id)));
}
