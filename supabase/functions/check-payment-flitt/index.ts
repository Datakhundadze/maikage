import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Per Flitt's order lifecycle, `order_status: "approved"` is the only state
// that signals a captured payment. Values like "success" / "completed" /
// "paid" are not part of Flitt's documented order_status enum, and matching
// them risks false positives if Flitt ever uses them for non-final states.
const PAID = ["approved"];
const FAILED = ["declined", "expired", "reversed", "failed", "error"];

async function buildSignature(
  fields: Record<string, string | number | undefined | null>,
  secretKey: string,
): Promise<string> {
  const filtered: [string, string][] = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [k, String(v)]);
  filtered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signatureString = [secretKey, ...filtered.map(([, v]) => v)].join("|");
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(signatureString));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("Missing orderId");

    const merchantId = Deno.env.get("FLITT_MERCHANT_ID");
    const secretKey = Deno.env.get("FLITT_SECRET_KEY");
    if (!merchantId || !secretKey) throw new Error("Missing Flitt credentials");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, payment_status, cart_id")
      .eq("id", orderId)
      .single();

    if (fetchErr || !order) throw new Error("Order not found");

    if (order.payment_status === "paid") {
      return new Response(JSON.stringify({ status: "paid", already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Flitt's /api/status/order_id endpoint queries by the merchant-supplied
    // order_id — which is the same value we registered in create-payment-flitt
    // (the Maika orders.id UUID). The numeric `bog_order_id` column stores
    // Flitt's internal `payment_id`, which would need /api/status/payment_id
    // instead. Verify with Flitt support if results ever look mismatched.
    const requestFields = {
      order_id: orderId,
      merchant_id: merchantId,
    };
    const signature = await buildSignature(requestFields, secretKey);

    const flittRes = await fetch("https://pay.flitt.com/api/status/order_id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { ...requestFields, signature } }),
    });

    if (!flittRes.ok) {
      const err = await flittRes.text();
      throw new Error(`Flitt status request failed (${flittRes.status}): ${err.slice(0, 200)}`);
    }

    const data = await flittRes.json();
    console.log("[check-payment-flitt] Flitt status response:", JSON.stringify(data));

    const response = data.response || data;
    const orderStatus = typeof response.order_status === "string" ? response.order_status.toLowerCase() : "";
    const responseStatus = typeof response.response_status === "string" ? response.response_status.toLowerCase() : "";

    const applyUpdate = (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return order.cart_id ? q.eq("cart_id", order.cart_id) : q.eq("id", orderId);
    };

    if (PAID.includes(orderStatus)) {
      await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ status: "paid", flitt_status: orderStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (FAILED.includes(orderStatus)) {
      await applyUpdate({ payment_status: "failed" });
      return new Response(JSON.stringify({ status: "failed", flitt_status: orderStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ status: order.payment_status, flitt_status: orderStatus, response_status: responseStatus }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[check-payment-flitt] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
