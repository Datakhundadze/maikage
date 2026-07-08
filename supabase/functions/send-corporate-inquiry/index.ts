import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { companyName, taxId, contactPerson, phone, email, tshirtQuantity, color, comment, logoPath } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Build email HTML
    const htmlBody = `
<h2>ახალი კორპორატიული მოთხოვნა</h2>
<table style="border-collapse:collapse;width:100%;max-width:600px;">
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">კომპანია</td><td style="padding:8px;border:1px solid #ddd;">${companyName}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ს/კ</td><td style="padding:8px;border:1px solid #ddd;">${taxId}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">საკონტაქტო პირი</td><td style="padding:8px;border:1px solid #ddd;">${contactPerson}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ტელეფონი</td><td style="padding:8px;border:1px solid #ddd;">${phone}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ელ.ფოსტა</td><td style="padding:8px;border:1px solid #ddd;">${email}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">რაოდენობა</td><td style="padding:8px;border:1px solid #ddd;">${tshirtQuantity}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ფერი</td><td style="padding:8px;border:1px solid #ddd;">${color || "არ არის მითითებული"}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">კომენტარი</td><td style="padding:8px;border:1px solid #ddd;">${comment || "არ არის"}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">ლოგო</td><td style="padding:8px;border:1px solid #ddd;">${logoPath ? "ატვირთულია" : "არ არის"}</td></tr>
</table>
    `.trim();

    // Send via Resend directly — same proven pattern as create-payment (BOG).
    // The Lovable email queue path failed with no_matching_sender and is being
    // retired. Fire-and-forget via EdgeRuntime.waitUntil: an email failure is
    // logged but no longer fails the user's form submission (the inquiry row
    // and logo are already saved above).
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
    if (!resendKey) {
      console.error("[send-corporate-inquiry] RESEND_API_KEY not set — inquiry email NOT sent");
    } else {
      const sendPromise = fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: resendFrom,
          to: ["maika@maika.ge"],
          subject: `კორპორატიული მოთხოვნა: ${companyName}`,
          html: htmlBody,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.text();
            console.error("[send-corporate-inquiry] Resend HTTP", res.status, body);
          } else {
            const body = await res.json().catch(() => null);
            console.log("[send-corporate-inquiry] Inquiry email sent for", companyName, "resend_id:", body?.id);
          }
        })
        .catch((sendErr) => console.error("[send-corporate-inquiry] Resend fetch threw:", sendErr));
      // EdgeRuntime is provided by the Supabase Edge runtime (absent from DOM types).
      const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (typeof edgeRuntime?.waitUntil === "function") {
        edgeRuntime.waitUntil(sendPromise);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing corporate inquiry:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
