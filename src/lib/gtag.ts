// Tiny, defensive wrapper around GA4's window.gtag (id G-3NPL6ESFSC, loaded in
// index.html). Sends a single `event` hit. No-ops when gtag is absent (ad
// blockers, SSR, gtag not yet loaded) and NEVER throws — analytics must never
// break the app or block the UI. Callers pass order/cart facts only (product
// names, prices, ids) — no PII (name/email/phone/address).
//
// Cast to a local shape rather than augmenting the global Window so this stays
// self-contained (RouteChangeTracker has its own `gtag` declaration).
//
// Ecommerce events are also mirrored to the Meta pixel (metaPixel.ts):
// add_to_cart → AddToCart, begin_checkout → InitiateCheckout, purchase →
// Purchase (eventID = transaction_id). The mirror runs BEFORE the gtag lookup
// so a blocked GA does not also silence Meta, and the GA call below is
// unchanged.
import { metaEventFor, trackMeta } from "@/lib/metaPixel";

function mirrorToMeta(name: string, params: Record<string, unknown>): void {
  try {
    const meta = metaEventFor(name, params);
    if (meta) trackMeta(meta.event, meta.params, meta.options);
  } catch {
    /* analytics must never break the app */
  }
}

export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  mirrorToMeta(name, params);
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return;
  try {
    gtag("event", name, params);
  } catch {
    /* analytics must never break the app */
  }
}
