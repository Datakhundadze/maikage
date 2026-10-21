// First-touch / last-touch order attribution (client side).
//
// On every route change we read the ad/referral signals of the CURRENT visit
// (utm_*, fbclid, gclid, external document.referrer, landing path, in-app
// browser) and keep two snapshots in localStorage `maika_attr`:
//   ft  first touch — written once, replaced only after it is 30 days old
//   lt  last touch  — overwritten by every visit that carries any signal
// AttributionTracker sends the blob to the record_order_attribution RPC once
// an order exists (see that component). Nothing here ever throws: storage can
// be blocked (Safari private mode, in-app browsers) and that must never break
// the storefront.
//
// Bank returns are NOT visits: the bank sends the customer back to
// /?payment=… (→ /order-confirmation) with the bank's page as referrer, which
// would otherwise overwrite the real last touch with "pay.flitt.com".

export const ATTR_KEY = "maika_attr";
export const ATTR_SENT_KEY = "maika_attr_sent";
export const PENDING_ORDER_KEY = "maika_pending_order_id";

const FT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LEN = 300;

export interface AttrTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  fbclid?: string;
  gclid?: string;
  referrer?: string;
  landing_page?: string;
  ts: number;
}

export interface AttrBlob {
  ft?: AttrTouch;
  lt?: AttrTouch;
  in_app?: string;
}

// Our own hosts (internal navigation is not a referral). მაიკა.გე is matched
// both as Unicode and as punycode (xn--lodaxeh.xn--node) — browsers report
// the punycode form in URL.hostname.
const OWN_HOST_SUFFIXES = ["maika.ge", "xn--lodaxeh.xn--node", "მაიკა.გე", "lovable.app", "lovableproject.com", "lovable.dev"];
// Payment / bank hosts (a return from checkout is not a referral).
const PAYMENT_HOST_SUFFIXES = [
  "flitt.com",
  "tbcbank.ge",
  "tbcpayments.ge",
  "tbc.ge",
  "bog.ge",
  "bankofgeorgia.ge",
  "ipay.ge",
];

function hostMatches(host: string, suffixes: string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith("." + s));
}

function isOwnHost(host: string): boolean {
  if (hostMatches(host, OWN_HOST_SUFFIXES)) return true;
  if (typeof window !== "undefined" && host === window.location.hostname) return true;
  return false;
}

function isPaymentHost(host: string): boolean {
  return hostMatches(host, PAYMENT_HOST_SUFFIXES) || /(^|\.)(3ds|acs)[.-]/.test(host);
}

function clip(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  return s ? s.slice(0, MAX_LEN) : undefined;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked / full — attribution is best-effort */
  }
}

export function readAttribution(): AttrBlob | null {
  try {
    const raw = safeGet(ATTR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AttrBlob) : null;
  } catch {
    return null;
  }
}

export function detectInApp(ua: string): string | undefined {
  if (/FBAN|FBAV/i.test(ua)) return "facebook";
  if (/Instagram/i.test(ua)) return "instagram";
  return undefined;
}

/** External referrer host+path, or undefined for own/payment/empty referrers. */
function externalReferrer(): { value?: string; payment: boolean } {
  try {
    const ref = typeof document !== "undefined" ? document.referrer : "";
    if (!ref) return { payment: false };
    const u = new URL(ref);
    const host = u.hostname.toLowerCase();
    if (isPaymentHost(host)) return { payment: true };
    if (isOwnHost(host)) return { payment: false };
    return { value: clip(host + u.pathname), payment: false };
  } catch {
    return { payment: false };
  }
}

// document.referrer never changes within a page load, so it is read only on
// the first captured route; later SPA navigations must not re-count it.
let referrerConsumed = false;

/** Capture the current visit's signals. Call on every route change. */

export function captureAttribution(pathname: string, search: string): void {
  try {
    if (pathname === "/order-confirmation" || pathname.startsWith("/order-confirmation/")) return;
    const params = new URLSearchParams(search);
    if (params.has("payment")) return;

    let referrer: string | undefined;
    if (!referrerConsumed) {
      referrerConsumed = true;
      const ext = externalReferrer();
      if (ext.payment) return; // back from the bank — not a touch
      referrer = ext.value;
    }

    const touch: AttrTouch = {
      source: clip(params.get("utm_source")),
      medium: clip(params.get("utm_medium")),
      campaign: clip(params.get("utm_campaign")),
      content: clip(params.get("utm_content")),
      term: clip(params.get("utm_term")),
      fbclid: clip(params.get("fbclid")),
      gclid: clip(params.get("gclid")),
      referrer,
      landing_page: clip(pathname + search),
      ts: Date.now(),
    };
    const hasSignal = !!(
      touch.source || touch.medium || touch.campaign || touch.content || touch.term ||
      touch.fbclid || touch.gclid || touch.referrer
    );

    const prev = readAttribution() ?? {};
    const next: AttrBlob = { ...prev };
    const inApp = typeof navigator !== "undefined" ? detectInApp(navigator.userAgent || "") : undefined;
    if (inApp) next.in_app = inApp;

    // First touch: the first captured page (direct visits included, so a later
    // ad click does not masquerade as the first touch). Written once; replaced
    // only once it is older than 30 days.
    const ftExpired = !prev.ft || typeof prev.ft.ts !== "number" || Date.now() - prev.ft.ts > FT_TTL_MS;
    if (ftExpired) next.ft = touch;
    // Last touch: any visit that carries a signal.
    if (hasSignal) next.lt = touch;

    if (next.ft !== prev.ft || next.lt !== prev.lt || next.in_app !== prev.in_app) {
      safeSet(ATTR_KEY, JSON.stringify(next));
    }
  } catch {
    /* never throw */
  }
}

export function readSentIds(): string[] {
  try {
    const raw = safeGet(ATTR_SENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markSent(orderId: string): void {
  try {
    const ids = readSentIds().filter((x) => x !== orderId);
    ids.push(orderId);
    safeSet(ATTR_SENT_KEY, JSON.stringify(ids.slice(-20)));
  } catch {
    /* never throw */
  }
}

export function readPendingOrderId(): string | null {
  return safeGet(PENDING_ORDER_KEY);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST the attribution blob for an order. keepalive so it survives the
 * redirect to the bank / tab close. Server side is idempotent
 * (ON CONFLICT DO NOTHING) and ignores orders older than 6 hours.
 */
export function sendOrderAttribution(orderId: string): void {
  try {
    if (!orderId || !UUID_RE.test(orderId)) return;
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (!url || !key || typeof fetch === "undefined") return;
    const p = readAttribution() ?? {};
    void fetch(`${url}/rest/v1/rpc/record_order_attribution`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_order_id: orderId, p }),
    }).catch(() => {});
  } catch {
    /* never throw */
  }
}
