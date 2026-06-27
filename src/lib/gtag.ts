// Tiny, defensive wrapper around GA4's window.gtag (id G-3NPL6ESFSC, loaded in
// index.html). Sends a single `event` hit. No-ops when gtag is absent (ad
// blockers, SSR, gtag not yet loaded) and NEVER throws — analytics must never
// break the app or block the UI. Callers pass order/cart facts only (product
// names, prices, ids) — no PII (name/email/phone/address).
//
// Cast to a local shape rather than augmenting the global Window so this stays
// self-contained (RouteChangeTracker has its own `gtag` declaration).
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return;
  try {
    gtag("event", name, params);
  } catch {
    /* analytics must never break the app */
  }
}
