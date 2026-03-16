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

    // Enqueue email to transactional queue
    const { error: enqueueError } = await supabase.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        to: "maika@maika.ge",
        subject: `კორპორატიული მოთხოვნა: ${companyName}`,
        html: htmlBody,
        template_name: "corporate_inquiry",
      },
    });

    if (enqueueError) {
      console.error("[Corporate Inquiry] Enqueue error:", enqueueError);
      throw enqueueError;
    }

    console.log("[Corporate Inquiry] Email enqueued for", companyName);

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
