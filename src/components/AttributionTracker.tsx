import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  captureAttribution,
  markSent,
  readPendingOrderId,
  readSentIds,
  sendOrderAttribution,
} from "@/lib/attribution";

// Order attribution (first/last touch) — see src/lib/attribution.ts.
// Mounted once in App.tsx next to RouteChangeTracker. Renders nothing.
//
// Three triggers, all best-effort and never throwing:
//  (a) every route change → capture utm / click ids / referrer into
//      localStorage `maika_attr`;
//  (b) pagehide / visibilitychange(hidden) → if checkout left a
//      `maika_pending_order_id` that was not sent yet, POST it (keepalive).
//      This is the main path: CartPage / OrderDialog set the id right before
//      `window.location.href = <bank>`, which fires pagehide;
//  (c) /order-confirmation → send again for the returned order id (server is
//      idempotent). OrderConfirmationPage removes `maika_pending_order_id` in
//      its mount effect, so the fallback id is read here during the FIRST
//      RENDER of this component, which precedes that (lazy-loaded) page.

function isReturnUrl(pathname: string, search: string): boolean {
  return pathname.startsWith("/order-confirmation") || new URLSearchParams(search).has("payment");
}

const sentThisLoad = new Set<string>();

export const AttributionTracker = () => {
  const location = useLocation();

  // Captured synchronously on first render, before OrderConfirmationPage can
  // clear the pending marker.
  const returnOrderIdRef = useRef<string | null | undefined>(undefined);
  if (returnOrderIdRef.current === undefined) {
    let id: string | null = null;
    try {
      if (isReturnUrl(location.pathname, location.search)) {
        id = new URLSearchParams(location.search).get("orderId") || readPendingOrderId();
      }
    } catch {
      id = null;
    }
    returnOrderIdRef.current = id;
  }

  // (a) capture on every route change
  useEffect(() => {
    captureAttribution(location.pathname, location.search);
  }, [location.pathname, location.search]);

  // (c) confirmation page
  useEffect(() => {
    if (!location.pathname.startsWith("/order-confirmation")) return;
    let id: string | null = null;
    try {
      id = new URLSearchParams(location.search).get("orderId") || returnOrderIdRef.current || null;
    } catch {
      id = returnOrderIdRef.current || null;
    }
    if (!id || sentThisLoad.has(id)) return;
    sentThisLoad.add(id);
    sendOrderAttribution(id);
    markSent(id);
  }, [location.pathname, location.search]);

  // (b) leaving the page with a pending order
  useEffect(() => {
    const flush = () => {
      try {
        const id = readPendingOrderId();
        if (!id || sentThisLoad.has(id) || readSentIds().includes(id)) return;
        sentThisLoad.add(id);
        sendOrderAttribution(id);
        markSent(id);
      } catch {
        /* never throw */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
};
