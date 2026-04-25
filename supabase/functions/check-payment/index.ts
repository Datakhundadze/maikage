import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      .select("id, bog_order_id, payment_status, total_price, cart_id")
      .eq("id", orderId)
      .single();

    if (fetchErr || !order) {
      throw new Error("Order not found");
    }

    if (order.payment_status === "paid") {
      return new Response(JSON.stringify({ status: "paid", already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!order.bog_order_id) {
      return new Response(JSON.stringify({ status: order.payment_status, error: "No BOG order ID" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bogClientId = Deno.env.get("BOG_CLIENT_ID");
    const bogClientSecret = Deno.env.get("BOG_CLIENT_SECRET");
    if (!bogClientId || !bogClientSecret) throw new Error("Missing BOG credentials");

    const credentials = btoa(`${bogClientId}:${bogClientSecret}`);
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
      const err = await tokenRes.text();
      throw new Error(`BOG auth failed (${tokenRes.status}): ${err}`);
    }

    const { access_token } = await tokenRes.json();

    const detailRes = await fetch(
      `https://api.bog.ge/payments/v1/ecommerce/orders/${order.bog_order_id}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Accept-Language": "ka",
        },
      },
    );

    if (!detailRes.ok) {
      const err = await detailRes.text();
      console.error("[check-payment] BOG detail fetch failed:", err);
      throw new Error(`BOG order detail failed (${detailRes.status})`);
    }

    const bogOrder = await detailRes.json();
    console.log("[check-payment] BOG order detail:", JSON.stringify(bogOrder));

    const rawStatus =
      (typeof bogOrder.order_status === "object"
        ? bogOrder.order_status?.key
        : bogOrder.order_status) ||
      bogOrder.status;
    const bogStatus = typeof rawStatus === "string" ? rawStatus.toLowerCase() : rawStatus;

    // Some BOG responses report the actual money-transfer result here even when
    // order_status is still "in_progress". Treat a successful transfer as paid.
    const transferRaw =
      (typeof bogOrder.payment_detail?.transfer_status === "object"
        ? bogOrder.payment_detail.transfer_status?.key
        : bogOrder.payment_detail?.transfer_status) ||
      bogOrder.payment_detail?.code_description;
    const transferStatus = typeof transferRaw === "string" ? transferRaw.toLowerCase() : "";

    // Cart checkouts share one bog_order_id across multiple rows; update the whole cart
    // if cart_id is set so a single payment confirmation flips every line item.
    const applyUpdate = (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return order.cart_id ? q.eq("cart_id", order.cart_id) : q.eq("id", orderId);
    };

    const isPaid =
      bogStatus === "completed" ||
      bogStatus === "approved" ||
      bogStatus === "success" ||
      transferStatus === "success" ||
      transferStatus === "successful" ||
      transferStatus === "completed";

    if (isPaid) {
      const { error: updateErr } = await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });

      if (updateErr) console.error("[check-payment] Update failed:", updateErr);

      return new Response(JSON.stringify({ status: "paid", bog_status: bogStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bogStatus === "rejected" || bogStatus === "failed" || bogStatus === "error" || bogStatus === "declined") {
      await applyUpdate({ payment_status: "failed" });

      return new Response(JSON.stringify({ status: "failed", bog_status: bogStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: order.payment_status, bog_status: bogStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[check-payment] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
