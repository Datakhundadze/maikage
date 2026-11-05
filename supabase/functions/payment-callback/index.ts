import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FAILED = ["rejected", "failed", "declined", "expired", "cancelled"];

async function fetchBogStatus(bogOrderId: string): Promise<{ status: string; transfer: string } | null> {
  const clientId = Deno.env.get("BOG_CLIENT_ID");
  const clientSecret = Deno.env.get("BOG_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("[payment-callback] BOG credentials missing — cannot verify status from API");
    return null;
  }
  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch(
      "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
    );
    if (!tokenRes.ok) {
      console.error("[payment-callback] BOG auth failed:", tokenRes.status);
      return null;
    }
    const { access_token } = await tokenRes.json();
    const detailRes = await fetch(
      `https://api.bog.ge/payments/v1/receipt/${bogOrderId}`,
      { headers: { Authorization: `Bearer ${access_token}`, "Accept-Language": "ka" } },
    );
    if (!detailRes.ok) {
      const errBody = await detailRes.text();
      console.error("[payment-callback] BOG receipt fetch failed:", detailRes.status, errBody);
      return null;
    }
    const data = await detailRes.json();
    console.log("[payment-callback] BOG fetched status:", JSON.stringify(data));
    const rawStatus =
      (typeof data.order_status === "object" ? data.order_status?.key : data.order_status) ||
      data.status || "";
    const transferRaw =
      (typeof data.payment_detail?.transfer_status === "object"
        ? data.payment_detail.transfer_status?.key
        : data.payment_detail?.transfer_status) ||
      data.payment_detail?.code_description || "";
    return {
      status: typeof rawStatus === "string" ? rawStatus.toLowerCase() : "",
      transfer: typeof transferRaw === "string" ? transferRaw.toLowerCase() : "",
    };
  } catch (e) {
    console.error("[payment-callback] BOG fetch threw:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // Merge query params (for GET callbacks) with body params
    const url = new URL(req.url);
    const query: Record<string, any> = {};
    for (const [k, v] of url.searchParams) {
      try { query[k] = JSON.parse(v); } catch { query[k] = v; }
    }

    let body: Record<string, any> = {};
    if (req.method !== "GET") {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        body = await req.json();
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await req.text();
        const params = new URLSearchParams(text);
        for (const [k, v] of params) {
          try { body[k] = JSON.parse(v); } catch { body[k] = v; }
        }
      } else {
        const text = await req.text();
        try {
          body = JSON.parse(text);
        } catch {
          const params = new URLSearchParams(text);
          for (const [k, v] of params) {
            try { body[k] = JSON.parse(v); } catch { body[k] = v; }
          }
        }
      }
    }

    // BOG sometimes wraps the actual data inside a "body" key
    const merged = { ...query, ...body, ...(body?.body || {}) };

    console.log("[payment-callback] Method:", req.method, "Query:", JSON.stringify(query), "Body:", JSON.stringify(body));

    const externalOrderId =
      merged.external_order_id || merged.externalOrderId || merged.order_external_id || merged.order_id;

    const callbackStatusRaw =
      (typeof merged.order_status === "object" ? merged.order_status?.key : merged.order_status) ||
      merged.status ||
      merged.payment_status ||
      (typeof merged.payment_detail === "object" ? merged.payment_detail?.status : undefined);
    const callbackStatus = typeof callbackStatusRaw === "string" ? callbackStatusRaw.toLowerCase() : "";

    const callbackTransferRaw =
      (typeof merged.payment_detail === "object"
        ? (typeof merged.payment_detail.transfer_status === "object"
            ? merged.payment_detail.transfer_status?.key
            : merged.payment_detail.transfer_status) || merged.payment_detail.code_description
        : undefined);
    const callbackTransfer = typeof callbackTransferRaw === "string" ? callbackTransferRaw.toLowerCase() : "";

    const bogPayId = merged.id || merged.order_id;

    console.log(
      "[payment-callback] Resolved externalOrderId:", externalOrderId,
      "bogPayId:", bogPayId,
      "callbackStatus:", callbackStatus,
      "callbackTransfer:", callbackTransfer,
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // SECURITY (2026-11-05): this endpoint is public (verify_jwt = false) and
    // BOG callbacks are unsigned here, so NOTHING in the request is trusted for
    // the outcome. The request only names an order; the status comes solely
    // from BOG's API, looked up with the bog_order_id WE stored for that order
    // (set server-side by create-payment). Before this fix a forged POST
    // {"external_order_id": <id>, "order_status": "completed"} marked any order
    // paid whenever the API lookup was skipped (no stored id) or failed, and a
    // body-supplied "id" could point the lookup at someone else's BOG payment.
    let orderId: string | null = null;
    let cartId: string | null = null;
    let storedBogId: string | null = null;
    let provider: string | null = null;
    if (externalOrderId) {
      const { data } = await supabase
        .from("orders")
        .select("id, cart_id, bog_order_id, payment_provider")
        .eq("id", externalOrderId)
        .maybeSingle();
      if (data) {
        orderId = data.id;
        cartId = data.cart_id ?? null;
        storedBogId = data.bog_order_id ?? null;
        provider = data.payment_provider ?? null;
      }
    } else if (bogPayId) {
      const { data } = await supabase
        .from("orders")
        .select("id, cart_id, bog_order_id, payment_provider")
        .eq("bog_order_id", bogPayId)
        .limit(1)
        .maybeSingle();
      if (data) {
        orderId = data.id;
        cartId = data.cart_id ?? null;
        storedBogId = data.bog_order_id ?? null;
        provider = data.payment_provider ?? null;
      }
    }

    const ignore = (reason: string) => {
      console.warn("[payment-callback] ignored:", reason, "order:", orderId ?? externalOrderId ?? bogPayId ?? "-");
      // 200 so BOG does not retry forever; nothing is changed.
      return new Response(JSON.stringify({ status: "ignored" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

    if (!orderId) return ignore("order not found");
    if (provider !== "bog") return ignore(`provider is ${provider}, not bog`);
    if (!storedBogId) return ignore("no stored bog_order_id");

    const fresh = await fetchBogStatus(storedBogId);
    if (!fresh) return ignore("BOG API status unavailable — nothing changed (check-payment can re-sync)");
    const finalStatus = (fresh.status || "").toLowerCase();
    const finalTransfer = (fresh.transfer || "").toLowerCase();
    if (callbackStatus && callbackStatus !== finalStatus) {
      console.log("[payment-callback] body status", callbackStatus, "≠ BOG API", finalStatus, "— using BOG API");
    }

    // BOG's only canonical "paid" signal is order_status.key === "completed".
    // transfer_status / code_description / result_code can read "approved" during
    // 3DS authorization without funds transferring — trusting them produced false
    // positives where unpaid orders showed as confirmed in admin.
    const isPaid = finalStatus === "completed";
    const isFailed = FAILED.includes(finalStatus);

    const applyUpdate = (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return cartId ? q.eq("cart_id", cartId) : q.eq("id", orderId);
    };

    if (isPaid) {
      const { error } = await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });
      if (error) console.error("[payment-callback] Failed to update order as paid:", error);
      else console.log("[payment-callback] Order(s) marked as paid:", cartId ? `cart=${cartId}` : orderId);
    } else if (isFailed) {
      const { error } = await applyUpdate({ payment_status: "failed" });
      if (error) console.error("[payment-callback] Failed to update order as failed:", error);
      else console.log("[payment-callback] Order(s) marked as failed:", cartId ? `cart=${cartId}` : orderId);
    } else {
      console.log("[payment-callback] Unhandled status. status:", finalStatus, "transfer:", finalTransfer);
    }

    return new Response(JSON.stringify({ status: "ok", resolved_status: finalStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[payment-callback] error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
