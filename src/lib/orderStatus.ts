// Order-status lookup for the FAQ chat.
//
// ── THE SECURITY SHAPE, WHICH IS THE WHOLE POINT ─────────────────────────────
//
// The model NEVER sees an order. It emits a bare ```maika-order-status fence —
// a signal with no payload — and that is the entire extent of its involvement.
// The client strips the fence, runs the query itself, and renders the result
// into a component. Nothing here is ever written into a message's `content`,
// which is what both chats send back as history on the next turn, so no order
// detail can enter the model's context on this turn or any later one. Prompt
// injection cannot extract what the model was never given.
//
// ── AUTHORISATION ────────────────────────────────────────────────────────────
//
// There is NO new RPC, NO SECURITY DEFINER function and NO new policy. The
// query below is an ordinary PostgREST select that goes through the existing
// policy, untouched since 2026-03-08:
//
//   CREATE POLICY "Users can read own orders" ON public.orders
//     FOR SELECT TO authenticated USING (auth.uid() = user_id);
//
// A signed-in customer therefore sees exactly their own rows and the database
// enforces it. An anonymous caller matches no policy and reads nothing — which
// is why the guest path in the UI is an invitation to sign in rather than a
// lookup. Anonymous sessions (signInAnonymously) are `authenticated` to
// Postgres but own no orders, so they read nothing either.
//
// Migration 20260523130000 deliberately dropped anon SELECT on orders. Nothing
// here reinstates it.
//
// ── WHAT IS SELECTED ─────────────────────────────────────────────────────────
//
// Three columns. Not the address, price, phone, email, product, size, design,
// prompt or id. RLS would happily return them; we do not ask for them, so they
// never reach the browser at all.

import { supabase } from "@/integrations/supabase/client";
import type { Lang } from "@/lib/i18n";

/** The only columns this feature is allowed to read. */
const ORDER_STATUS_COLUMNS = "cart_id, created_at, status, payment_status";

/** Most recent purchases to show. "The most recent few", not an enumeration. */
export const MAX_ORDERS_SHOWN = 3;

/** Rows fetched per query — enough to fill MAX_ORDERS_SHOWN groups after the
 *  cart_id collapse, since one multi-item checkout inserts one row per item. */
const ROW_FETCH_LIMIT = 40;

interface OrderStatusRow {
  cart_id: string | null;
  created_at: string;
  status: string;
  payment_status: string;
}

/** One purchase, after collapsing the per-item rows of a single checkout. */
export interface OrderStatusGroup {
  key: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
}

export type OrderStatusResult =
  | { kind: "orders"; groups: OrderStatusGroup[] }
  | { kind: "none" }
  | { kind: "error" };

// ── Fence ────────────────────────────────────────────────────────────────────
// Mirrors the maika-mockup / maika-generate contract: stripped from the text on
// ANY match so a raw fence can never reach a bubble, whether or not it closed.
const ORDER_STATUS_FENCE_RE = /```maika-order-status\b[\s\S]*?(?:```|$)/g;

/** Remove every maika-order-status fence (closed OR truncated) from the text. */
export function stripOrderStatusFence(raw: string): string {
  return raw.replace(ORDER_STATUS_FENCE_RE, "").trim();
}

/**
 * Did the model ask for an order-status lookup?
 *
 * Deliberately a boolean and not a parsed object. The fence carries NO payload:
 * there is nothing for the model to fill in, so there is nothing it could use
 * to point the lookup at someone else. Who the query returns is decided
 * entirely by auth.uid() inside Postgres.
 */
export function hasOrderStatusFence(raw: string): boolean {
  ORDER_STATUS_FENCE_RE.lastIndex = 0;
  return ORDER_STATUS_FENCE_RE.test(raw);
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Fetch the signed-in customer's own recent order states.
 *
 * Returns "none" both when there are no rows and when the caller is not
 * signed in — the caller decides what to render, and the two are deliberately
 * indistinguishable to anything downstream.
 */
export async function fetchOwnOrderStatus(): Promise<OrderStatusResult> {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_STATUS_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(ROW_FETCH_LIMIT);

    if (error) return { kind: "error" };
    const rows = (data ?? []) as OrderStatusRow[];
    if (rows.length === 0) return { kind: "none" };

    // Collapse a multi-item checkout into one purchase. Rows arrive newest
    // first, so the first row of each cart_id is the one that dates the group.
    const seen = new Set<string>();
    const groups: OrderStatusGroup[] = [];
    for (const r of rows) {
      const key = r.cart_id ?? `single-${r.created_at}-${r.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({
        key,
        createdAt: r.created_at,
        status: r.status,
        paymentStatus: r.payment_status,
      });
      if (groups.length >= MAX_ORDERS_SHOWN) break;
    }
    return { kind: "orders", groups };
  } catch {
    return { kind: "error" };
  }
}

// ── Display ──────────────────────────────────────────────────────────────────

const STATUS_KA: Record<string, string> = {
  pending: "მოლოდინში",
  confirmed: "დადასტურებული",
  in_production: "წარმოებაში",
  shipped: "გაგზავნილი",
  delivered: "მიტანილი",
  cancelled: "გაუქმებული",
};

const STATUS_EN: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  in_production: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const PAYMENT_KA: Record<string, string> = {
  unpaid: "გადაუხდელი",
  pending: "მუშავდება",
  paid: "გადახდილია",
  failed: "გადახდა ვერ განხორციელდა",
  refunded: "დაბრუნებული",
};

const PAYMENT_EN: Record<string, string> = {
  unpaid: "Unpaid",
  pending: "Processing",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded",
};

/** Order stage in the page language; unknown values pass through verbatim. */
export function statusLabel(status: string, lang: Lang): string {
  return (lang === "en" ? STATUS_EN : STATUS_KA)[status] ?? status;
}

/** Payment state in the page language; unknown values pass through verbatim. */
export function paymentLabel(payment: string, lang: Lang): string {
  return (lang === "en" ? PAYMENT_EN : PAYMENT_KA)[payment] ?? payment;
}

/**
 * A deliberately COARSE date — "3 days ago", never a timestamp.
 *
 * Precision here would be a small gift to anyone reading over a shoulder and
 * is of no use to the customer, who wants to know roughly when they ordered.
 */
export function coarseDate(iso: string, lang: Lang, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const days = Math.floor((now - then) / 86_400_000);
  const en = lang === "en";
  if (days <= 0) return en ? "today" : "დღეს";
  if (days === 1) return en ? "yesterday" : "გუშინ";
  if (days < 7) return en ? `${days} days ago` : `${days} დღის წინ`;
  if (days < 31) {
    const w = Math.floor(days / 7);
    return en ? `about ${w} week${w > 1 ? "s" : ""} ago` : `დაახლოებით ${w} კვირის წინ`;
  }
  const m = Math.floor(days / 30);
  return en ? `about ${m} month${m > 1 ? "s" : ""} ago` : `დაახლოებით ${m} თვის წინ`;
}
