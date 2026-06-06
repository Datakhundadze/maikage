import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { orderId, amount, description, cartId, backTransparentBackfill } = await req.json();
    if (!orderId || !amount) throw new Error("Missing orderId or amount");

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) throw new Error("Invalid amount");

    const merchantId = Deno.env.get("FLITT_MERCHANT_ID");
    const secretKey = Deno.env.get("FLITT_SECRET_KEY");
    if (!merchantId || !secretKey) throw new Error("Missing Flitt credentials (FLITT_MERCHANT_ID / FLITT_SECRET_KEY)");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // PAYMENT AMOUNT VALIDATION (Phase 1). See create-payment/index.ts for
    // the full rationale. Sum total_price across the order rows already in
    // the DB and require the client amount to match. Phase 1 only — does
    // not seal price-forgery at the orders.insert step.
    const totalsQuery = cartId
      ? supabase.from("orders").select("total_price").eq("cart_id", cartId)
      : supabase.from("orders").select("total_price").eq("id", orderId);
    const { data: totalRows, error: totalsErr } = await totalsQuery;
    if (totalsErr) {
      console.error("[create-payment-flitt] amount validation query failed:", totalsErr);
      return new Response(
        JSON.stringify({ error: "Failed to verify order total" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!totalRows || totalRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const expectedTotal = totalRows.reduce(
      (s: number, r: { total_price: number | null }) => s + Number(r.total_price ?? 0),
      0,
    );
    if (Math.abs(numericAmount - expectedTotal) >= 1) {
      console.warn(
        `[create-payment-flitt] amount mismatch — client=${numericAmount} expected=${expectedTotal} orderId=${orderId} cartId=${cartId ?? "null"}`,
      );
      return new Response(
        JSON.stringify({ error: `Amount mismatch (expected ${expectedTotal} GEL)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    // Server-side back_transparent_image_url backfill. Previously ran from
    // the browser as an anon UPDATE; moved here so the public UPDATE policy
    // on orders can eventually be dropped. Best-effort: a failed backfill
    // is logged but never aborts the payment.
    if (Array.isArray(backTransparentBackfill)) {
      for (const entry of backTransparentBackfill) {
        if (!entry || !entry.url || !Array.isArray(entry.orderIds) || entry.orderIds.length === 0) continue;
        try {
          const { error: bfErr } = await supabase
            .from("orders")
            .update({ back_transparent_image_url: entry.url })
            .in("id", entry.orderIds);
          if (bfErr) console.warn("[create-payment-flitt] back_transparent_image_url backfill skipped:", bfErr.message);
        } catch (bfThrow) {
          console.warn("[create-payment-flitt] back_transparent_image_url backfill threw:", bfThrow);
        }
      }
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

        // Background send via Resend — same approach as create-payment.
        const resendKey = Deno.env.get("RESEND_API_KEY");
        const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
        if (!resendKey) {
          console.error("[create-payment-flitt] RESEND_API_KEY not set — order notification email NOT sent");
        } else {
          const sendPromise = fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: resendFrom,
              to: ["maika@maika.ge"],
              subject: `ახალი შეკვეთა (Flitt): ${orderRow.first_name} ${orderRow.last_name} — ${orderRow.total_price} ₾`,
              html: htmlBody,
            }),
          })
            .then(async (res) => {
              if (!res.ok) {
                const body = await res.text();
                console.error("[create-payment-flitt] Resend HTTP", res.status, body);
              } else {
                const body = await res.json().catch(() => null);
                console.log("[create-payment-flitt] Order notification email sent for orderId:", orderId, "resend_id:", body?.id);
              }
            })
            .catch((sendErr) => console.error("[create-payment-flitt] Resend fetch threw:", sendErr));
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
