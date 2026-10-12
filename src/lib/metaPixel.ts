// Meta (Facebook / Instagram) pixel for ad conversion measurement.
//
// Loaded from code rather than index.html or GTM: the script is injected once,
// on the first event, by the standard Meta base code (unminified below), and
// every call goes through trackMeta, which NEVER throws — analytics must never
// break the app or block checkout. When an ad blocker stops fbevents.js the
// script's error handler marks the pixel blocked and every later call is a
// no-op (until then the standard stub only queues).
//
// Sends page views and the funnel events gtag.ts maps (AddToCart,
// InitiateCheckout, Purchase) with order value and currency only. No advanced
// matching: no name, email, phone or address is ever passed to Meta.
// Disclosed in PrivacyPage section 8.

export const META_PIXEL_ID = "1446729430731985";

const SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};
type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq };

let initialised = false;
let blocked = false;

function init(): Fbq | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const w = window as PixelWindow;
  if (!initialised) {
    initialised = true;
    if (!w.fbq) {
      // Standard Meta base code: a stub that queues calls until fbevents.js
      // loads and replays them.
      const n: Fbq = function (...args: unknown[]) {
        if (n.callMethod) n.callMethod(...args);
        else n.queue?.push(args);
      };
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      w.fbq = n;
      if (!w._fbq) w._fbq = n;
      const s = document.createElement("script");
      s.async = true;
      s.src = SCRIPT_SRC;
      s.onerror = () => {
        blocked = true;
      };
      const first = document.getElementsByTagName("script")[0];
      if (first?.parentNode) first.parentNode.insertBefore(s, first);
      else document.head.appendChild(s);
    }
    w.fbq?.("init", META_PIXEL_ID);
  }
  return w.fbq ?? null;
}

/**
 * fbq('track', event, params, options). Safe to call anywhere: loads the pixel
 * on first use, no-ops when it is blocked, and swallows every error.
 */
export function trackMeta(event: string, params: Record<string, unknown> = {}, options?: { eventID?: string }): void {
  try {
    if (blocked) return;
    const fbq = init();
    if (!fbq || blocked) return;
    if (options) fbq("track", event, params, options);
    else fbq("track", event, params);
  } catch {
    /* analytics must never break the app */
  }
}

/** Meta standard event and parameters for one GA4 ecommerce event, or null. */
export function metaEventFor(
  name: string,
  params: Record<string, unknown>,
): { event: string; params: Record<string, unknown>; options?: { eventID: string } } | null {
  const value = typeof params.value === "number" && Number.isFinite(params.value) ? params.value : null;
  const money = value !== null ? { value, currency: "GEL" } : {};
  if (name === "add_to_cart") return { event: "AddToCart", params: money };
  if (name === "begin_checkout") return { event: "InitiateCheckout", params: money };
  if (name === "purchase") {
    const id = params.transaction_id;
    const eventID = typeof id === "string" && id ? id : undefined;
    // Value only when the order total is known (> 0); otherwise the
    // conversion still counts, deduplicated on the order id.
    return {
      event: "Purchase",
      params: value !== null && value > 0 ? money : {},
      ...(eventID ? { options: { eventID } } : {}),
    };
  }
  return null;
}
