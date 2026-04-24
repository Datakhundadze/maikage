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
    const url = new URL(req.url);
    let payload: Record<string, unknown> = {};

    // TBC may send GET with query params or POST with JSON body
    if (req.method === "GET") {
      for (const [k, v] of url.searchParams) {
        try { payload[k] = JSON.parse(v); } catch { payload[k] = v; }
      }
    } else {
      const text = await req.text();
      try {
        payload = JSON.parse(text);
      } catch {
        for (const [k, v] of new URLSearchParams(text)) {
          try { payload[k] = JSON.parse(v); } catch { payload[k] = v; }
        }
      }
    }

    console.log("[tbc-callback] Method:", req.method, "Payload:", JSON.stringify(payload));

    // TBC sends PayId (capital P) and Status (capital S)
    const payId =
      (payload.PayId as string) ||
      (payload.payId as string) ||
      (payload.pay_id as string);
    const rawStatus =
      (payload.Status as string) ||
      (payload.status as string) ||
      "";
    const status = rawStatus.toLowerCase();

    if (!payId) {
      console.error("[tbc-callback] No payId in payload");
      return new Response(JSON.stringify({ error: "No payId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find the order(s) by TBC payId (stored in bog_order_id)
    const { data: orderRow } = await supabase
      .from("orders")
      .select("id, cart_id")
      .eq("bog_order_id", payId)
      .limit(1)
      .maybeSingle();

    if (!orderRow) {
      console.error("[tbc-callback] No order found for payId:", payId);
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const applyUpdate = (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return orderRow.cart_id ? q.eq("cart_id", orderRow.cart_id) : q.eq("id", orderRow.id);
    };

    const PAID = ["succeeded", "success", "completed", "approved", "confirmed"];
    const FAILED = ["failed", "rejected", "error", "declined", "expired"];

    if (PAID.includes(status)) {
      const { error } = await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });
      if (error) console.error("[tbc-callback] Update failed:", error);
      else console.log("[tbc-callback] Marked as paid:", orderRow.cart_id ? `cart=${orderRow.cart_id}` : orderRow.id);
    } else if (FAILED.includes(status)) {
      const { error } = await applyUpdate({ payment_status: "failed" });
      if (error) console.error("[tbc-callback] Update failed:", error);
      else console.log("[tbc-callback] Marked as failed:", orderRow.id);
    } else {
      console.log("[tbc-callback] Unhandled status:", rawStatus);
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[tbc-callback] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
