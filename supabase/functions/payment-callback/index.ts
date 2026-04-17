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
    let body: Record<string, any> = {};

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

    console.log("[payment-callback] Received body:", JSON.stringify(body));
    console.log("[payment-callback] Content-Type:", contentType);
    console.log("[payment-callback] Method:", req.method);

    const externalOrderId = body.external_order_id || body.externalOrderId || body.order_external_id;
    const statusKey =
      (typeof body.order_status === "object" ? body.order_status?.key : body.order_status) ||
      body.status ||
      body.payment_status;

    console.log("[payment-callback] Resolved externalOrderId:", externalOrderId, "statusKey:", statusKey);

    if (!externalOrderId) {
      console.error("[payment-callback] No external_order_id found in body");
      return new Response(JSON.stringify({ error: "Missing external_order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    if (statusKey === "completed" || statusKey === "approved" || statusKey === "success" || statusKey === "paid") {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "confirmed",
          paid_at: new Date().toISOString(),
        })
        .eq("id", externalOrderId);
      if (error) console.error("[payment-callback] Failed to update order as paid:", error);
      else console.log("[payment-callback] Order marked as paid:", externalOrderId);
    } else if (statusKey === "rejected" || statusKey === "failed" || statusKey === "error") {
      const { error } = await supabase
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", externalOrderId);
      if (error) console.error("[payment-callback] Failed to update order as failed:", error);
      else console.log("[payment-callback] Order marked as failed:", externalOrderId);
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
