import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendLovableEmail } from "npm:@lovable.dev/email-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Flitt signature: SHA1( secretKey | v1 | v2 | ... ) where values are
// the request fields sorted alphabetically by key, with empty/null values skipped.
async function buildSignature(
  fields: Record<string, string | number | undefined | null>,
  secretKey: string,
): Promise<string> {
  const filtered: [string, string][] = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [k, String(v)]);
  filtered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signatureString = [secretKey, ...filtered.map(([, v]) => v)].join("|");

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-1", encoder.encode(signatureString));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, amount, description, cartId } = await req.json();
    if (!orderId || !amount) throw new Error("Missing orderId or amount");

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) throw new Error("Invalid amount");

    const merchantId = Deno.env.get("FLITT_MERCHANT_ID");
    const secretKey = Deno.env.get("FLITT_SECRET_KEY");
    if (!merchantId || !secretKey) throw new Error("Missing Flitt credentials (FLITT_MERCHANT_ID / FLITT_SECRET_KEY)");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const appUrl = Deno.env.get("APP_URL") || "https://maika.ge";
    const callbackUrl = `${supabaseUrl}/functions/v1/flitt-callback`;

    // Flitt expects amount in subunits (tetri): 35 GEL → 3500
    const amountInTetri = Math.round(numericAmount * 100);

    const requestFields = {
      order_id: orderId,
      merchant_id: merchantId,
      order_desc: description || "Maika.ge შეკვეთა",
      amount: amountInTetri,
      currency: "GEL",
      response_url: `${appUrl}/?payment=success&orderId=${orderId}`,
      server_callback_url: callbackUrl,
      lang: "ka",
      merchant_data: cartId || orderId,
    };

    const signature = await buildSignature(requestFields, secretKey);

    const payload = { request: { ...requestFields, signature } };

    console.log("[create-payment-flitt] Creating order:", JSON.stringify({ ...payload, request: { ...payload.request, signature: "***" } }));

    const flittRes = await fetch("https://pay.flitt.com/api/checkout/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!flittRes.ok) {
      const err = await flittRes.text();
      throw new Error(`Flitt request failed (${flittRes.status}): ${err}`);
    }

    const flittData = await flittRes.json();
    console.log("[create-payment-flitt] Flitt response:", JSON.stringify(flittData));

    const response = flittData.response;
    if (!response || response.response_status !== "success") {
      const errMsg = response?.error_message || response?.error_code || "Unknown Flitt error";
      throw new Error(`Flitt error: ${errMsg}`);
    }

    const checkoutUrl = response.checkout_url;
    const paymentId = response.payment_id ? String(response.payment_id) : null;
    if (!checkoutUrl) throw new Error("Flitt did not return checkout_url");

    // Reuse bog_order_id column to store provider order id (consistent with TBC integration)
    const providerRef = paymentId || orderId;
    if (cartId) {
      await supabase
        .from("orders")
        .update({ payment_status: "pending", bog_order_id: providerRef })
        .eq("cart_id", cartId);
    } else {
      await supabase
        .from("orders")
        .update({ payment_status: "pending", bog_order_id: providerRef })
        .eq("id", orderId);
    }

    // Email notification (fire-and-forget)
    try {
      const { data: orderRow } = await supabase.from("orders").select("*").eq("id", orderId).single();
      if (orderRow) {
        const htmlBody = `
<h2>ახალი შეკვეთა (Flitt) — maika.ge</h2>
<table style="border-collapse:collapse;width:100%;max-width:600px;">
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">შეკვეთის ID</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.id}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">სახელი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.first_name} ${orderRow.last_name}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ტელეფონი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.phone}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">პროდუქტი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.product} — ${orderRow.sub_product || ""} (${orderRow.color || ""})</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ზომა</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.size || "—"}</td></tr>
  <tr style="background:#f0f9f0;"><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">სულ</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${orderRow.total_price} ₾</td></tr>
</table>`.trim();

        // Background send via EdgeRuntime.waitUntil — same approach as
        // create-payment, keeps "go to payment" responsive.
        const apiKey = Deno.env.get("LOVABLE_API_KEY");
        if (!apiKey) {
          console.error("[create-payment-flitt] LOVABLE_API_KEY not set — order notification email NOT sent");
        } else {
          const sendPromise = sendLovableEmail(
            {
              to: "maika@maika.ge",
              subject: `ახალი შეკვეთა (Flitt): ${orderRow.first_name} ${orderRow.last_name} — ${orderRow.total_price} ₾`,
              html: htmlBody,
            } as any,
            { apiKey, sendUrl: Deno.env.get("LOVABLE_SEND_URL") },
          )
            .then(() => console.log("[create-payment-flitt] Order notification email sent for orderId:", orderId))
            .catch((sendErr) => console.error("[create-payment-flitt] Email send threw:", sendErr));
          // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime
          if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
            // @ts-ignore
            EdgeRuntime.waitUntil(sendPromise);
          }
        }
      }
    } catch (emailErr) {
      console.error("[create-payment-flitt] Email error:", emailErr);
    }

    return new Response(
      JSON.stringify({ redirect_url: checkoutUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[create-payment-flitt] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
