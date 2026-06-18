// Shared order-grouping for the customer-facing post-purchase views (order
// confirmation + My Orders). Mirrors the cart_id collapse logic AdminOrders
// uses (AdminOrders.tsx:164-180): a multi-unit checkout — qty>1 or a
// multi-item cart — inserts N order rows that share one cart_id, and we
// render them as a single grouped card. Single-unit orders (cart_id null)
// form a one-row group keyed by `single-${id}`.

/** Minimal order shape the customer post-purchase views read. A subset of
 *  the orders table columns (the admin panel has its own richer type). */
export interface CustomerOrder {
  id: string;
  cart_id: string | null;
  created_at: string;
  status: string;
  payment_status: string;
  product: string;
  sub_product: string | null;
  color: string | null;
  size: string | null;
  total_price: number;
  delivery_price: number;
  front_mockup_url: string | null;
  back_mockup_url: string | null;
}

/** Columns to SELECT for the customer views — keep in sync with CustomerOrder. */
export const CUSTOMER_ORDER_COLUMNS =
  "id, cart_id, created_at, status, payment_status, product, sub_product, color, size, total_price, delivery_price, front_mockup_url, back_mockup_url";

export interface OrderGroup<T extends GroupableOrder> {
  key: string;
  head: T;
  rows: T[];
  quantity: number;
  groupTotal: number;
  deliveryTotal: number;
}

type GroupableOrder = {
  id: string;
  cart_id: string | null;
  total_price: number;
  delivery_price: number;
};

/** Collapse rows sharing a cart_id into one group. Input is assumed sorted
 *  created_at DESC (a cart's rows share a timestamp, so they stay adjacent
 *  and Map insertion order preserves the DESC ordering — same invariant as
 *  AdminOrders). */
export function groupOrdersByCart<T extends GroupableOrder>(orders: T[]): OrderGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const o of orders) {
    const key = o.cart_id ?? `single-${o.id}`;
    const arr = map.get(key);
    if (arr) arr.push(o);
    else map.set(key, [o]);
  }
  return Array.from(map.entries()).map(([key, rows]) => ({
    key,
    head: rows[0],
    rows,
    quantity: rows.length,
    groupTotal: rows.reduce((s, r) => s + (r.total_price ?? 0), 0),
    deliveryTotal: rows.reduce((s, r) => s + (r.delivery_price ?? 0), 0),
  }));
}

/** Display-only short order number — first 8 chars of the UUID, uppercased.
 *  No schema change; the canonical id remains the full UUID. */
export function shortOrderId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
