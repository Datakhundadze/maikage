import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, amount, description, cartId, installment } = await req.json();
    if (!orderId || !amount) throw new Error("Missing orderId or amount");

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) throw new Error("Invalid amount");

    const apiKey = installment
      ? Deno.env.get("TBC_CREDIT_API_KEY")
      : Deno.env.get("TBC_API_KEY");
    if (!apiKey) throw new Error(`Missing TBC API key (installment=${!!installment})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Get access token
    const tokenRes = await fetch("https://api.tbcbank.ge/v1/tpay/access-token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `apiKey=${encodeURIComponent(apiKey)}`,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`TBC auth failed (${tokenRes.status}): ${err}`);
    }

    const { accessToken } = await tokenRes.json();

    // 2. Create payment
    const appUrl = Deno.env.get("APP_URL") || "https://maika.ge";
    const callbackUrl = `${supabaseUrl}/functions/v1/tbc-callback`;

    const methods = installment ? [8] : [5, 9, 14]; // 5=card, 9=ApplePay, 14=GooglePay, 8=installment

    const paymentPayload: Record<string, unknown> = {
      amount: {
        currency: "GEL",
        total: numericAmount,
        subTotal: numericAmount,
        tax: 0,
        shipping: 0,
      },
      returnurl: `${appUrl}/?payment=success`,
      callbackUrl,
      preAuth: false,
      language: "KA",
      merchantPaymentId: orderId,
      saveCard: false,
      extra: cartId || orderId,
      methods,
    };

    if (installment) {
      paymentPayload.installmentProducts = [
        {
          name: description || "Maika.ge შეკვეთა",
          price: numericAmount,
          quantity: 1,
        },
      ];
    }

    console.log("[create-payment-tbc] Creating payment:", JSON.stringify(paymentPayload));

    const payRes = await fetch("https://api.tbcbank.ge/v1/tpay/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentPayload),
    });

    if (!payRes.ok) {
      const err = await payRes.text();
      throw new Error(`TBC payment creation failed (${payRes.status}): ${err}`);
    }

    const payData = await payRes.json();
    console.log("[create-payment-tbc] TBC response:", JSON.stringify(payData));

    const payId = payData.payId;
    const redirectLink = payData.links?.find(
      (l: { method: string; uri: string }) => l.method === "REDIRECT",
    );

    if (!payId || !redirectLink?.uri) {
      throw new Error("TBC did not return payId or redirect URL");
    }

    // 3. Update order(s) with TBC payId (stored in bog_order_id field for consistency)
    if (cartId) {
      await supabase
        .from("orders")
        .update({ payment_status: "pending", bog_order_id: payId })
        .eq("cart_id", cartId);
    } else {
      await supabase
        .from("orders")
        .update({ payment_status: "pending", bog_order_id: payId })
        .eq("id", orderId);
    }

    // 4. Email notification (fire-and-forget)
    try {
      const { data: orderRow } = await supabase.from("orders").select("*").eq("id", orderId).single();
      if (orderRow) {
        const htmlBody = `
<h2>ახალი შეკვეთა (TBC${installment ? " განვადება" : ""}) — maika.ge</h2>
<table style="border-collapse:collapse;width:100%;max-width:600px;">
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">შეკვეთის ID</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.id}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">სახელი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.first_name} ${orderRow.last_name}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ტელეფონი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.phone}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">პროდუქტი</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.product} — ${orderRow.sub_product || ""} (${orderRow.color || ""})</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ზომა</td><td style="padding:8px;border:1px solid #ddd;">${orderRow.size || "—"}</td></tr>
  <tr style="background:#f0f9f0;"><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">სულ</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${orderRow.total_price} ₾</td></tr>
</table>`.trim();

        await supabase.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            to: "maika@maika.ge",
            subject: `ახალი შეკვეთა (TBC): ${orderRow.first_name} ${orderRow.last_name} — ${orderRow.total_price} ₾`,
            html: htmlBody,
            template_name: "order_notification",
          },
        });
        supabase.functions.invoke("process-email-queue", { body: {} }).catch(() => {});
      }
    } catch (emailErr) {
      console.error("[create-payment-tbc] Email error:", emailErr);
    }

    return new Response(
      JSON.stringify({ redirect_url: redirectLink.uri }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[create-payment-tbc] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
