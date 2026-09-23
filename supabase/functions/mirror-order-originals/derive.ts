// mirror-order-originals — the pure part: from an order's stored design_state,
// derive exactly which cart-items/ files to copy and where. No Deno, no
// supabase-js, so vitest can pin the mapping.
//
// WHY THE SOURCE IS DERIVED, NOT SUPPLIED. The browser used to list
// cart-items/<cartItemId>/ itself and copy each "-original-" file into
// order-originals/<orderId>/ (CartPage.mirrorCartItemOriginals). That needed an
// anonymous SELECT policy on cart-items/, which let anyone enumerate every
// customer's original photos. This function does the copy with the service
// role instead — but it must not become a way to copy arbitrary folders. So
// it takes ORDER ROW IDS only, reads each row's design_state, and copies only
// the cart-items/ files that row's own photos[].url already point at. A caller
// who knows an order id can make that order's own files land in that order's
// own folder, which is what checkout does anyway; nothing else.
//
// DESTINATION PATHS ARE BYTE-IDENTICAL to the old browser copy:
//   cart-items/<id>/front-original-0.png  →  order-originals/<orderId>/front-0.png
// AdminOrders lists order-originals/<orderId>/ and filters on
// name.startsWith("back"), so the naming must not change.

export interface CopyJob {
  from: string;
  to: string;
}

export type DeriveOutcome =
  | { status: "no_design_state" }
  | { status: "nothing_to_copy" }
  | { status: "ok"; jobs: CopyJob[] };

/** Matches the tail of a public URL (or a bare path) inside cart-items/. */
const CART_ORIGINAL_RE =
  /(?:^|\/)cart-items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(front|back)-original-(\d+)\.(png|jpe?g|webp)(?:[?#].*)?$/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Parse one photo url. Returns the copy job for this order, or null when the
 * url is not a cart-items original (an OrderDialog order stores
 * order-originals/ urls, which are already in place; a failed upload stores
 * null). Anything that does not match the exact cart layout is ignored — the
 * regex is the allow-list.
 */
export function jobForPhotoUrl(url: unknown, orderId: string): CopyJob | null {
  if (typeof url !== "string") return null;
  const m = CART_ORIGINAL_RE.exec(url);
  if (!m) return null;
  const [, cartItemId, sideRaw, idx, extRaw] = m;
  const side = sideRaw.toLowerCase();
  const ext = extRaw.toLowerCase();
  return {
    from: `cart-items/${cartItemId}/${side}-original-${idx}.${ext}`,
    to: `order-originals/${orderId}/${side}-${idx}.${ext}`,
  };
}

/** Walk design_state.front/back.photos[].url; dedupe; never throws. */
export function deriveCopyJobs(designState: unknown, orderId: string): DeriveOutcome {
  if (!designState || typeof designState !== "object") return { status: "no_design_state" };
  const ds = designState as { front?: unknown; back?: unknown };
  const jobs: CopyJob[] = [];
  const seen = new Set<string>();
  for (const side of [ds.front, ds.back]) {
    if (!side || typeof side !== "object") continue;
    const photos = (side as { photos?: unknown }).photos;
    if (!Array.isArray(photos)) continue;
    for (const p of photos) {
      const url = p && typeof p === "object" ? (p as { url?: unknown }).url : undefined;
      const job = jobForPhotoUrl(url, orderId);
      if (job && !seen.has(job.to)) {
        seen.add(job.to);
        jobs.push(job);
      }
    }
  }
  return jobs.length === 0 ? { status: "nothing_to_copy" } : { status: "ok", jobs };
}

/** Request body validation: 1..50 distinct UUIDs, nothing else accepted. */
export const MAX_ORDER_IDS = 50;

export function parseOrderIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { orderIds?: unknown }).orderIds;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ORDER_IDS) return null;
  const ids: string[] = [];
  for (const v of raw) {
    if (!isUuid(v)) return null;
    const id = v.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Supabase Storage reports a copy onto an existing key as a duplicate. */
export function isDuplicateError(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("already exists") || m.includes("duplicate");
}
