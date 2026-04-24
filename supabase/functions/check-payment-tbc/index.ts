import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("Missing orderId");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, bog_order_id, payment_status, payment_provider, cart_id")
      .eq("id", orderId)
      .single();

    if (fetchErr || !order) throw new Error("Order not found");
    if (order.payment_status === "paid") {
      return new Response(JSON.stringify({ status: "paid", already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!order.bog_order_id) {
      return new Response(JSON.stringify({ status: order.payment_status, error: "No TBC pay ID" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine which API key to use
    const isCredit = order.payment_provider === "tbc_credit";
    const apiKey = isCredit
      ? Deno.env.get("TBC_CREDIT_API_KEY")
      : Deno.env.get("TBC_API_KEY");
    if (!apiKey) throw new Error("Missing TBC API key");

    // Get access token
    const tokenRes = await fetch("https://api.tbcbank.ge/v1/tpay/access-token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `apiKey=${encodeURIComponent(apiKey)}`,
    });
    if (!tokenRes.ok) throw new Error(`TBC auth failed (${tokenRes.status})`);
    const { accessToken } = await tokenRes.json();

    // Check payment status
    const statusRes = await fetch(
      `https://api.tbcbank.ge/v1/tpay/payments/${order.bog_order_id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
        },
      },
    );

    if (!statusRes.ok) {
      const err = await statusRes.text();
      throw new Error(`TBC status check failed (${statusRes.status}): ${err}`);
    }

    const tbcData = await statusRes.json();
    console.log("[check-payment-tbc] TBC status:", JSON.stringify(tbcData));

    const tbcStatus = (tbcData.status || "").toLowerCase();

    const applyUpdate = (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return order.cart_id ? q.eq("cart_id", order.cart_id) : q.eq("id", orderId);
    };

    if (tbcStatus === "succeeded" || tbcStatus === "confirmed") {
      await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ status: "paid", tbc_status: tbcStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tbcStatus === "failed" || tbcStatus === "rejected" || tbcStatus === "expired") {
      await applyUpdate({ payment_status: "failed" });
      return new Response(JSON.stringify({ status: "failed", tbc_status: tbcStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ status: order.payment_status, tbc_status: tbcStatus }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[check-payment-tbc] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
