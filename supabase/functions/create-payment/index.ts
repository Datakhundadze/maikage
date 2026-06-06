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
    const { orderId, amount, description, cartId, backTransparentBackfill } = await req.json();
    if (!orderId || !amount) throw new Error("Missing orderId or amount");
    const bogClientId = Deno.env.get("BOG_CLIENT_ID");
    const bogClientSecret = Deno.env.get("BOG_CLIENT_SECRET");
    if (!bogClientId || !bogClientSecret) throw new Error("Missing BOG credentials");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // PAYMENT AMOUNT VALIDATION (Phase 1):
    // The client computes the amount and sends it in the request body.
    // Without this check, a tampered request body could pay 1 GEL for a
    // 113 GEL order. We sum total_price across the order rows that ALREADY
    // exist in the DB at this point (submitOrder inserts rows BEFORE
    // invoking us) and require the client amount to match.
    //
    // Row build is the same in OrderDialog.tsx and CartPage.tsx: per-unit
    // rows share one cart_id when qty>1 (delivery added to row[0] only),
    // single row keyed by id when qty=1 / cart_id=null. SUM(total_price)
    // across that group equals the client totalWithDelivery exactly —
    // all GEL values are integers, no rounding drift.
    //
    // NOTE: this only catches naive amount-tampering. A determined attacker
    // could also forge product_price at the .insert() step (Phase 2 — port
    // pricing to a trusted server-side source).
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid amount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const totalsQuery = cartId
      ? supabase.from("orders").select("total_price").eq("cart_id", cartId)
      : supabase.from("orders").select("total_price").eq("id", orderId);
    const { data: totalRows, error: totalsErr } = await totalsQuery;
    if (totalsErr) {
      console.error("[create-payment] amount validation query failed:", totalsErr);
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
        `[create-payment] amount mismatch — client=${numericAmount} expected=${expectedTotal} orderId=${orderId} cartId=${cartId ?? "null"}`,
      );
      return new Response(
        JSON.stringify({ error: `Amount mismatch (expected ${expectedTotal} GEL)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
        success: `${appUrl}/?payment=success&orderId=${orderId}`,
        fail: `${appUrl}/?payment=fail&orderId=${orderId}`,
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
    const bogOrderId = bogOrder.order_id || bogOrder.id;
    // If this is a cart checkout, stamp the bog_order_id on every order in the cart
    // so the payment callback (which only knows bog_order_id) can flip the whole batch.
    if (cartId) {
      const { error: cartErr } = await supabase
        .from("orders")
        .update({ payment_status: "pending", bog_order_id: bogOrderId })
        .eq("cart_id", cartId);
      if (cartErr) console.error("Failed to update cart orders:", cartErr);
    } else {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ payment_status: "pending", bog_order_id: bogOrderId })
        .eq("id", orderId);
      if (updateError) console.error("Failed to update order:", updateError);
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
          if (bfErr) console.warn("[create-payment] back_transparent_image_url backfill skipped:", bfErr.message);
        } catch (bfThrow) {
          console.warn("[create-payment] back_transparent_image_url backfill threw:", bfThrow);
        }
      }
    }

    // Fetch full order details to send email notification
    try {
      const { data: orderRow } = await supabase.from("orders").select("*").eq("id", orderId).single();
      if (orderRow) {
        const htmlBody = `
<h2>ახალი შეკვეთა — maika.ge</h2>
<table style="border-collapse:collapse;width:100%;max-width:600px;">
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">შეკვეთის ID</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.id}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">სახელი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.first_name} ${orderRow.last_name}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ტელეფონი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.phone}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ელ.ფოსტა</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.email}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">პროდუქტი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.product} — ${orderRow.sub_product || ""} (${orderRow.color || ""})</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ზომა</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.size || "—"}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">მიწოდება</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.delivery_type} ${orderRow.delivery_address ? `— ${orderRow.delivery_address}` : ""}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">პროდუქტის ფასი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.product_price} ₾</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">მიწოდების ფასი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.delivery_price} ₾</td></tr>
  <tr style="background:#f0f9f0;"><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">სულ</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${orderRow.total_price} ₾</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">კომენტარი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.comment || "—"}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">რეჟიმი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.is_studio ? "AI სტუდიო" : "მარტივი"}</td></tr>
</table>
${orderRow.front_mockup_url ? `<p><a href="${orderRow.front_mockup_url}">წინა მოქაპი ნახვა</a></p>` : ""}
${orderRow.back_mockup_url ? `<p><a href="${orderRow.back_mockup_url}">უკანა მოქაპი ნახვა</a></p>` : ""}
        `.trim();

        // Send order notification via Resend. Earlier paths via Lovable
        // email-js / process-email-queue produced ~1500 retries per message
        // in production with zero deliveries, so we switched off entirely.
        // Background-send via EdgeRuntime.waitUntil so the create-payment
        // response doesn't wait on the email API.
        const resendKey = Deno.env.get("RESEND_API_KEY");
        const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
        if (!resendKey) {
          console.error("[create-payment] RESEND_API_KEY not set — order notification email NOT sent");
        } else {
          const sendPromise = fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: resendFrom,
              to: ["maika@maika.ge"],
              subject: `ახალი შეკვეთა: ${orderRow.first_name} ${orderRow.last_name} — ${orderRow.total_price} ₾`,
              html: htmlBody,
            }),
          })
            .then(async (res) => {
              if (!res.ok) {
                const body = await res.text();
                console.error("[create-payment] Resend HTTP", res.status, body);
              } else {
                const body = await res.json().catch(() => null);
                console.log("[create-payment] Order notification email sent for orderId:", orderId, "resend_id:", body?.id);
              }
            })
            .catch((sendErr) => console.error("[create-payment] Resend fetch threw:", sendErr));
          // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime
          if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
            // @ts-ignore
            EdgeRuntime.waitUntil(sendPromise);
          }
        }
      }
    } catch (emailErr) {
      console.error("[create-payment] Failed to enqueue order notification email:", emailErr);
      // Don't throw — payment flow continues even if email fails
    }

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
