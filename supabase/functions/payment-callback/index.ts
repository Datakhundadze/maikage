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
    const body = await req.json();
    const externalOrderId = body.external_order_id;
    const statusKey = body.order_status?.key;
    if (!externalOrderId) {
      return new Response(JSON.stringify({ error: "Missing external_order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    if (statusKey === "completed") {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "pending",
          paid_at: new Date().toISOString(),
        })
        .eq("id", externalOrderId);
      if (error) console.error("Failed to update order as paid:", error);
    } else if (statusKey === "rejected") {
      const { error } = await supabase
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", externalOrderId);
      if (error) console.error("Failed to update order as failed:", error);
    }
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("payment-callback error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
