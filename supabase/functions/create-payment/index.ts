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
    const { orderId, amount, description } = await req.json();
    if (!orderId || !amount) throw new Error("Missing orderId or amount");
    const bogClientId = Deno.env.get("BOG_CLIENT_ID");
    const bogClientSecret = Deno.env.get("BOG_CLIENT_SECRET");
    if (!bogClientId || !bogClientSecret) throw new Error("Missing BOG credentials");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const credentials = btoa(`${bogClientId}:${bogClientSecret}`);
    const tokenRes = await fetch("https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`BOG auth failed (${tokenRes.status}): ${err}`);
    }
    const { access_token } = await tokenRes.json();
    const appUrl = Deno.env.get("APP_URL") || "https://maikage.lovable.app";
    const callbackUrl = `${supabaseUrl}/functions/v1/payment-callback`;
    const orderPayload = {
      callback_url: callbackUrl,
      external_order_id: orderId,
      purchase_units: {
        currency: "GEL",
        total_amount: amount,
        basket: [{
          quantity: 1,
          unit_price: amount,
          product_id: orderId,
          description: description || "Maika.ge Order",
        }],
      },
      redirect_urls: {
        success: `${appUrl}/?payment=success`,
        fail: `${appUrl}/?payment=fail`,
      },
    };
    const orderRes = await fetch("https://api.bog.ge/payments/v1/ecommerce/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Accept-Language": "ka",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });
    if (!orderRes.ok) {
      const err = await orderRes.text();
      throw new Error(`BOG order creation failed (${orderRes.status}): ${err}`);
    }
    const bogOrder = await orderRes.json();
    const { error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: "pending", bog_order_id: bogOrder.order_id || bogOrder.id })
      .eq("id", orderId);
    if (updateError) console.error("Failed to update order:", updateError);
    return new Response(
      JSON.stringify({ redirect_url: bogOrder.redirect_url || bogOrder._links?.redirect?.href }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-payment error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
