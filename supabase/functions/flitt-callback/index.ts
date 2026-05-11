import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Per Flitt's order lifecycle, `order_status: "approved"` is the only state
// that signals a captured payment. Other values like "created", "processing",
// "expired", "declined", "reversed" are non-paid lifecycle states.
// `response_status` is an API-protocol acknowledgment ("success" = callback
// well-formed), NOT a payment outcome — it must never feed the paid decision.
const PAID = ["approved"];
const FAILED = ["declined", "expired", "reversed", "failed", "error"];

async function sha1Hex(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Per Flitt docs: signature = SHA1( secretKey | v1 | v2 | ... ) where
// values are all callback fields except `signature` and `response_signature_string`,
// sorted alphabetically by key, with empty/null values skipped.
async function computeCallbackSignature(
  payload: Record<string, unknown>,
  secretKey: string,
): Promise<string> {
  const filtered = Object.entries(payload)
    .filter(([k]) => k !== "signature" && k !== "response_signature_string")
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  filtered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signatureString = [secretKey, ...filtered.map(([, v]) => v)].join("|");
  return sha1Hex(signatureString);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const secretKey = Deno.env.get("FLITT_SECRET_KEY");
    if (!secretKey) {
      console.error("[flitt-callback] FLITT_SECRET_KEY missing");
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let payload: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      for (const [k, v] of params) {
        try { payload[k] = JSON.parse(v); } catch { payload[k] = v; }
      }
    } else {
      const text = await req.text();
      try { payload = JSON.parse(text); } catch {
        const params = new URLSearchParams(text);
        for (const [k, v] of params) {
          try { payload[k] = JSON.parse(v); } catch { payload[k] = v; }
        }
      }
    }

    console.log("[flitt-callback] Received:", JSON.stringify(payload));

    const sigFromFlitt = typeof payload.signature === "string" ? payload.signature.toLowerCase() : "";
    const computed = await computeCallbackSignature(payload, secretKey);

    if (!sigFromFlitt || sigFromFlitt !== computed) {
      console.error("[flitt-callback] Signature mismatch. expected=", computed, "got=", sigFromFlitt);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = String(payload.order_id || "");
    const merchantData = payload.merchant_data ? String(payload.merchant_data) : "";
    const orderStatus = typeof payload.order_status === "string" ? payload.order_status.toLowerCase() : "";
    const responseStatus = typeof payload.response_status === "string" ? payload.response_status.toLowerCase() : "";

    if (!orderId) {
      console.error("[flitt-callback] No order_id in payload");
      return new Response(JSON.stringify({ error: "Missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // merchant_data carries cart_id when present (set in create-payment-flitt)
    const cartId = merchantData && merchantData !== orderId ? merchantData : null;

    // response_status is a protocol-level acknowledgment. If Flitt sent a
    // non-"success" response_status, the callback itself is malformed — log
    // for visibility but do not let it influence the payment decision.
    if (responseStatus && responseStatus !== "success") {
      console.warn(
        "[flitt-callback] Non-success response_status received:",
        responseStatus,
        "(payment decision still based solely on order_status)",
      );
    }

    // Decide on order_status only. Check FAILED before PAID so any future
    // accidental overlap in the PAID list can never override a failure.
    const isFailed = FAILED.includes(orderStatus);
    const isPaid = !isFailed && PAID.includes(orderStatus);

    const applyUpdate = (patch: Record<string, unknown>) => {
      const q = supabase.from("orders").update(patch);
      return cartId ? q.eq("cart_id", cartId) : q.eq("id", orderId);
    };

    if (isFailed) {
      const { error } = await applyUpdate({ payment_status: "failed" });
      if (error) console.error("[flitt-callback] failed update error:", error);
      else console.log(
        "[flitt-callback] Decision=FAILED order_status=", orderStatus,
        cartId ? `cart=${cartId}` : orderId,
      );
    } else if (isPaid) {
      const { error } = await applyUpdate({
        payment_status: "paid",
        status: "confirmed",
        paid_at: new Date().toISOString(),
      });
      if (error) console.error("[flitt-callback] paid update error:", error);
      else console.log(
        "[flitt-callback] Decision=PAID order_status=", orderStatus,
        cartId ? `cart=${cartId}` : orderId,
      );
    } else {
      console.log(
        "[flitt-callback] Decision=IGNORE order_status=", orderStatus,
        "response_status=", responseStatus,
        cartId ? `cart=${cartId}` : orderId,
      );
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[flitt-callback] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
