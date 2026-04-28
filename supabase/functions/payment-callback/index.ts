import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID = ["completed", "approved", "success", "paid", "successful"];
const FAILED = ["rejected", "failed", "error", "declined", "expired", "cancelled"];

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
      `https://api.bog.ge/payments/v1/ecommerce/orders/${bogOrderId}`,
      { headers: { Authorization: `Bearer ${access_token}`, "Accept-Language": "ka" } },
    );
    if (!detailRes.ok) {
      console.error("[payment-callback] BOG order fetch failed:", detailRes.status);
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

    // Resolve order: by external_order_id (our id) first, then by bog_order_id
    let orderId = externalOrderId;
    let cartId: string | null = null;
    let bogOrderIdForLookup: string | null = bogPayId || null;
    if (!orderId && bogPayId) {
      const { data } = await supabase
        .from("orders")
        .select("id, cart_id, bog_order_id")
        .eq("bog_order_id", bogPayId)
        .limit(1)
        .maybeSingle();
      if (data) {
        orderId = data.id;
        cartId = data.cart_id;
        bogOrderIdForLookup = data.bog_order_id;
      }
    } else if (orderId) {
      const { data } = await supabase
        .from("orders")
        .select("cart_id, bog_order_id")
        .eq("id", orderId)
        .maybeSingle();
      if (data) {
        cartId = data.cart_id ?? null;
        bogOrderIdForLookup = data.bog_order_id || bogOrderIdForLookup;
      }
    }

    if (!orderId) {
      console.error("[payment-callback] Could not resolve order. Merged payload:", JSON.stringify(merged));
      return new Response(JSON.stringify({ error: "Cannot resolve order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Source of truth: query BOG API directly using bog_order_id. The webhook
    // payload is sometimes incomplete or sent before the transfer is finalized.
    let finalStatus = callbackStatus;
    let finalTransfer = callbackTransfer;
    if (bogOrderIdForLookup) {
      const fresh = await fetchBogStatus(bogOrderIdForLookup);
      if (fresh) {
        finalStatus = fresh.status || finalStatus;
        finalTransfer = fresh.transfer || finalTransfer;
      }
    }

    // Also check result_code from callback or BOG detail
    const resultCodeRaw = merged.payment_detail?.result_code || merged.result_code;
    const resultCode = typeof resultCodeRaw === "string" ? resultCodeRaw.toLowerCase() : String(resultCodeRaw ?? "");

    const isPaid = PAID.includes(finalStatus) || PAID.includes(finalTransfer) || resultCode === "100";
    const isFailed = FAILED.includes(finalStatus) || FAILED.includes(finalTransfer);

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
