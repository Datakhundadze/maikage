import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { companyName, taxId, contactPerson, phone, email, tshirtQuantity, color, comment, logoPath } = body;

    // Format email body
    const emailBody = `
ახალი კორპორატიული მოთხოვნა:

კომპანია: ${companyName}
საიდენტიფიკაციო კოდი: ${taxId}
საკონტაქტო პირი: ${contactPerson}
ტელეფონი: ${phone}
ელ.ფოსტა: ${email}
მაისურის რაოდენობა: ${tshirtQuantity}
ფერი: ${color || "არ არის მითითებული"}
კომენტარი: ${comment || "არ არის"}
ლოგო: ${logoPath ? "ატვირთულია" : "არ არის ატვირთული"}
    `.trim();

    console.log("[Corporate Inquiry] New inquiry received:");
    console.log(emailBody);

    // Note: Email sending requires email domain setup.
    // For now, the inquiry is saved to DB and logged here.
    // To enable email notifications, set up an email domain in Cloud → Emails.

    return new Response(
      JSON.stringify({ success: true, message: "Inquiry logged successfully" }),
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
