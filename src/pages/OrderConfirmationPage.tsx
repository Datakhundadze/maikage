import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { CheckCircle, XCircle, Loader2, ArrowRight } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import OrderCard from "@/components/OrderCard";
import { trackEvent } from "@/lib/gtag";
import {
  groupOrdersByCart,
  shortOrderId,
  CUSTOMER_ORDER_COLUMNS,
  type CustomerOrder,
  type OrderGroup,
} from "@/lib/orderGrouping";

type PaymentState = "checking" | "paid" | "processing" | "failed";

// Persistent post-payment confirmation. Reached from the bank redirect
// (/?payment=success&orderId=…) via the App-level redirect to this route.
// Reuses the existing check-payment edge function (unchanged) to resolve the
// authoritative paid/failed status; logged-in users also see a live summary
// of the order(s) read under the "Users can read own orders" RLS policy.
export default function OrderConfirmationPage() {
  const { user, isAnonymous } = useAuth();
  const { lang, setMode } = useAppState();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLoggedIn = !!user && !isAnonymous;

  const payParam = searchParams.get("payment");
  // orderId from the redirect URL; fall back to the legacy localStorage marker
  // OrderDialog/CartPage set right before redirecting to the bank.
  const [orderId] = useState<string | null>(() => {
    const fromUrl = searchParams.get("orderId");
    const fromStorage = typeof localStorage !== "undefined" ? localStorage.getItem("maika_pending_order_id") : null;
    return fromUrl || fromStorage;
  });

  const [paymentState, setPaymentState] = useState<PaymentState>(payParam === "fail" ? "failed" : "checking");
  const [groups, setGroups] = useState<OrderGroup<CustomerOrder>[] | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.removeItem("maika_pending_order_id");
  }, []);

  // Poll check-payment (service role; returns only status fields) until the
  // bank's outcome is known. Mirrors the previous LandingPage banner poll.
  useEffect(() => {
    if (payParam === "fail") { setPaymentState("failed"); return; }
    if (!orderId) { setPaymentState("processing"); return; }

    pollingRef.current = true;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;
    const INTERVAL_MS = 3000;

    const check = async (): Promise<{ status?: string } | null> => {
      try {
        const { data, error } = await supabase.functions.invoke("check-payment", { body: { orderId } });
        if (error) {
          try {
            const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
            if (ctx?.json) return (await ctx.json()) as { status?: string };
          } catch { /* ignore parse errors */ }
          return null;
        }
        return data as { status?: string };
      } catch {
        return null;
      }
    };

    const poll = async () => {
      while (pollingRef.current && attempts < MAX_ATTEMPTS) {
        attempts++;
        const data = await check();
        if (data?.status === "paid") { setPaymentState("paid"); return; }
        if (data?.status === "failed") { setPaymentState("failed"); return; }
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }
      // Exhausted: the bank redirected as success but our DB hasn't caught up.
      // Show "processing" rather than asserting paid.
      if (pollingRef.current) setPaymentState((s) => (s === "checking" ? "processing" : s));
    };
    poll();
    return () => { pollingRef.current = false; };
  }, [orderId, payParam]);

  // Logged-in: read this checkout's order(s) (RLS: auth.uid() = user_id) and
  // group by cart_id. Guests intentionally don't read orders client-side.
  useEffect(() => {
    if (!isLoggedIn || !orderId) { setGroups(null); return; }
    let cancelled = false;
    (async () => {
      const { data: head } = await supabase.from("orders").select(CUSTOMER_ORDER_COLUMNS).eq("id", orderId).maybeSingle();
      if (cancelled) return;
      if (!head) { setGroups([]); return; }
      let rows = [head as unknown as CustomerOrder];
      const cartId = (head as unknown as CustomerOrder).cart_id;
      if (cartId) {
        const { data: siblings } = await supabase
          .from("orders")
          .select(CUSTOMER_ORDER_COLUMNS)
          .eq("cart_id", cartId)
          .order("created_at", { ascending: true });
        if (!cancelled && siblings && siblings.length) rows = siblings as unknown as CustomerOrder[];
      }
      if (!cancelled) setGroups(groupOrdersByCart(rows));
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, orderId]);

  // GA4 conversion: fire `purchase` ONCE per order, ONLY on confirmed success
  // (paymentState === "paid", which is set only when check-payment returns
  // "paid" — never on failed/pending/processing). Double-fire guard: an
  // in-mount ref + a sessionStorage flag keyed by orderId so a page refresh
  // can't double-count revenue. value/items come from the order rows the page
  // already loads for logged-in users (RLS); guests can't read orders
  // client-side, so their hit carries transaction_id + a generic item (the
  // conversion still counts; revenue lives in the orders table / admin panel).
  const purchaseTrackedRef = useRef(false);
  useEffect(() => {
    if (paymentState !== "paid" || !orderId) return;
    if (purchaseTrackedRef.current) return;
    // For logged-in users wait until the order rows load so value/items are real.
    if (isLoggedIn && groups === null) return;

    const flagKey = `ga4_purchase_${orderId}`;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(flagKey)) {
        purchaseTrackedRef.current = true;
        return;
      }
    } catch { /* sessionStorage unavailable — fall back to the in-mount ref */ }

    const rows = groups ? groups.flatMap((g) => g.rows) : [];
    const value = rows.reduce((s, r) => s + (Number(r.total_price) || 0), 0);
    const shipping = rows.reduce((s, r) => s + (Number(r.delivery_price) || 0), 0);
    const items = rows.length
      ? rows.map((r) => ({
          item_id: r.id,
          item_name: [r.product, r.sub_product, r.color, r.size].filter(Boolean).join(" "),
          item_category: r.product,
          // product_price directly: total_price − delivery_price used to be
          // equivalent, but total_price now also carries the once-per-order bag
          // fee on row 0, which would inflate that item's reported price.
          price: Number(r.product_price) || 0,
          quantity: 1,
        }))
      : [{ item_id: orderId, item_name: "maika.ge order", quantity: 1 }];

    purchaseTrackedRef.current = true;
    try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(flagKey, "1"); } catch { /* ignore */ }

    trackEvent("purchase", {
      transaction_id: orderId,
      // currency/value only when a real total is known (logged-in). Guests
      // still record the conversion (count) without revenue.
      ...(value > 0 ? { value, currency: "GEL", shipping } : {}),
      items,
    });
  }, [paymentState, orderId, isLoggedIn, groups]);

  const isFailed = paymentState === "failed";
  const isPaid = paymentState === "paid";

  const goHome = () => { setMode("landing"); navigate("/"); };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <SeoHead title="შეკვეთა — Maika.ge" description="შეკვეთის დადასტურება." url={`${SITE_URL}/order-confirmation`} noindex />

      {/* Top bar */}
      <header className="h-14 flex items-center px-4 border-b border-border shrink-0">
        <button onClick={goHome} className="flex items-center gap-2 font-black hover:opacity-80 transition-opacity" aria-label="maika.ge">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-black">M</div>
          <span>maika.ge</span>
        </button>
      </header>

      <main className="flex-1 flex items-start justify-center p-4">
        <div className="w-full max-w-md space-y-5 py-8">
          {/* Status header */}
          <div className="text-center space-y-3">
            {isFailed ? (
              <XCircle className="h-14 w-14 text-red-500 mx-auto" />
            ) : isPaid ? (
              <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto" />
            ) : (
              <Loader2 className="h-14 w-14 text-amber-500 mx-auto animate-spin" />
            )}
            <h1 className="text-2xl font-bold">
              {isFailed ? t(lang, "confirm.failedTitle") : isPaid ? t(lang, "confirm.paidTitle") : t(lang, "confirm.processingTitle")}
            </h1>
            {orderId && !isFailed && (
              <p className="text-sm font-mono text-muted-foreground">
                {t(lang, "confirm.orderNumber")} #{shortOrderId(orderId)}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {isFailed ? t(lang, "confirm.failed") : isPaid ? t(lang, "confirm.paid") : t(lang, "confirm.processing")}
            </p>
          </div>

          {/* Logged-in order summary */}
          {!isFailed && isLoggedIn && groups && groups.length > 0 && (
            <div className="space-y-3">
              {groups.map((g) => <OrderCard key={g.key} group={g} lang={lang} />)}
            </div>
          )}

          {/* Guest note */}
          {!isFailed && !isLoggedIn && (
            <div className="rounded-2xl border border-border bg-card p-4 text-center space-y-1.5">
              <p className="text-sm text-foreground">{t(lang, "confirm.guestNote")}</p>
              <p className="text-xs text-muted-foreground">{t(lang, "confirm.guestCreateAccount")}</p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            {!isFailed && isLoggedIn && (
              <Link
                to="/my-designs?tab=orders"
                className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                {t(lang, "confirm.viewOrders")} <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            <button
              onClick={goHome}
              className="w-full h-12 inline-flex items-center justify-center rounded-xl border border-border font-semibold hover:bg-muted transition-colors"
            >
              {t(lang, "confirm.backHome")}
            </button>
            {isFailed && (
              <a
                href="mailto:maika@maika.ge"
                className="w-full h-11 inline-flex items-center justify-center rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t(lang, "confirm.contact")}
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
