import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
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

    // Body takes precedence, query fills in gaps
    const merged = { ...query, ...body };

    console.log("[payment-callback] Method:", req.method, "Query:", JSON.stringify(query), "Body:", JSON.stringify(body));

    const externalOrderId =
      merged.external_order_id || merged.externalOrderId || merged.order_external_id || merged.order_id;

    const statusKey =
      (typeof merged.order_status === "object" ? merged.order_status?.key : merged.order_status) ||
      merged.status ||
      merged.payment_status ||
      (typeof merged.payment_detail === "object" ? merged.payment_detail?.status : undefined);

    console.log("[payment-callback] Resolved externalOrderId:", externalOrderId, "statusKey:", statusKey);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Try by external_order_id (our order.id) first, fall back to bog_order_id
    let orderId = externalOrderId;
    let cartId: string | null = null;
    if (!orderId && merged.id) {
      const { data } = await supabase
        .from("orders")
        .select("id, cart_id")
        .eq("bog_order_id", merged.id)
        .limit(1)
        .maybeSingle();
      if (data) {
        orderId = data.id;
        cartId = data.cart_id;
      }
    } else if (orderId) {
      const { data } = await supabase
        .from("orders")
        .select("cart_id")
        .eq("id", orderId)
        .maybeSingle();
      if (data?.cart_id) cartId = data.cart_id;
    }

    if (!orderId) {
      console.error("[payment-callback] Could not resolve order. Merged payload:", JSON.stringify(merged));
      return new Response(JSON.stringify({ error: "Cannot resolve order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PAID = ["completed", "approved", "success", "paid"];
    const FAILED = ["rejected", "failed", "error", "declined"];

    // Build the update scope: if this order is part of a cart, flip the whole cart
    const applyUpdate = async (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return cartId ? q.eq("cart_id", cartId) : q.eq("id", orderId);
    };

    if (statusKey && PAID.includes(statusKey.toLowerCase())) {
      const { error } = await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });
      if (error) console.error("[payment-callback] Failed to update order as paid:", error);
      else console.log("[payment-callback] Order(s) marked as paid:", cartId ? `cart=${cartId}` : orderId);
    } else if (statusKey && FAILED.includes(statusKey.toLowerCase())) {
      const { error } = await applyUpdate({ payment_status: "failed" });
      if (error) console.error("[payment-callback] Failed to update order as failed:", error);
      else console.log("[payment-callback] Order(s) marked as failed:", cartId ? `cart=${cartId}` : orderId);
    } else {
      console.log("[payment-callback] Unhandled status key:", statusKey);
    }
    return new Response(JSON.stringify({ status: "ok" }), {
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
