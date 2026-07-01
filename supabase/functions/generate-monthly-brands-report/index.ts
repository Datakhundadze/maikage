import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Monthly per-brand sales report emailed to the accountant. Triggered by
// pg_cron (net.http_post with the service-role Bearer) on the 1st of each
// month — hence verify_jwt = true (no public exposure). Runs a read-only
// aggregation of the PREVIOUS calendar month's PAID orders (via the
// report_brands_last_month() SQL function) and emails an HTML table via Resend.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BrandRow {
  brand: string | null;
  type: string | null;
  total_items: number;
  tbc_items: number;
  bog_items: number;
  total_revenue: number;
  tbc_revenue: number;
  bog_revenue: number;
  avg_price: number;
}

const GE_MONTHS = [
  "იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
  "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი",
];

function money(n: number): string {
  return `${(Number(n) || 0).toFixed(2)} ₾`;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Previous calendar month label ("2026 ივნისი"), computed from now-1-month.
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthLabel = `${prev.getUTCFullYear()} ${GE_MONTHS[prev.getUTCMonth()]}`;

    // Aggregation via the SECURITY DEFINER SQL function (clean FILTER support).
    const { data, error } = await supabase.rpc("report_brands_last_month");
    if (error) throw new Error(`aggregation failed: ${error.message}`);

    const rows: BrandRow[] = ((data as BrandRow[]) || []).map((r) => ({
      brand: r.brand,
      type: r.type,
      total_items: Number(r.total_items),
      tbc_items: Number(r.tbc_items),
      bog_items: Number(r.bog_items),
      total_revenue: Number(r.total_revenue),
      tbc_revenue: Number(r.tbc_revenue),
      bog_revenue: Number(r.bog_revenue),
      avg_price: Number(r.avg_price),
    }));

    // ── Build the HTML email ──
    let html: string;
    if (rows.length === 0) {
      html = `<div style="font-family:sans-serif;">
        <h2>ბრენდების ანგარიში — ${esc(monthLabel)}</h2>
        <p>გასულ თვეში გადახდილი შეკვეთა არ იყო.</p>
      </div>`;
    } else {
      const tot = rows.reduce(
        (a, r) => ({
          total_items: a.total_items + r.total_items,
          tbc_items: a.tbc_items + r.tbc_items,
          bog_items: a.bog_items + r.bog_items,
          total_revenue: a.total_revenue + r.total_revenue,
          tbc_revenue: a.tbc_revenue + r.tbc_revenue,
          bog_revenue: a.bog_revenue + r.bog_revenue,
        }),
        { total_items: 0, tbc_items: 0, bog_items: 0, total_revenue: 0, tbc_revenue: 0, bog_revenue: 0 },
      );

      const th = (label: string) =>
        `<th style="padding:8px;border:1px solid #ddd;text-align:left;">${label}</th>`;
      const td = (v: string, align = "left") =>
        `<td style="padding:8px;border:1px solid #ddd;text-align:${align};">${v}</td>`;

      const bodyRows = rows.map((r) =>
        `<tr>${td(esc(r.brand ?? "—"))}${td(esc(r.type ?? "—"))}` +
        `${td(String(r.total_items), "right")}${td(String(r.tbc_items), "right")}${td(String(r.bog_items), "right")}` +
        `${td(money(r.total_revenue), "right")}${td(money(r.tbc_revenue), "right")}${td(money(r.bog_revenue), "right")}` +
        `${td(money(r.avg_price), "right")}</tr>`,
      ).join("");

      const totalsRow =
        `<tr style="font-weight:bold;background:#f3f4f6;">${td("სულ")}${td("")}` +
        `${td(String(tot.total_items), "right")}${td(String(tot.tbc_items), "right")}${td(String(tot.bog_items), "right")}` +
        `${td(money(tot.total_revenue), "right")}${td(money(tot.tbc_revenue), "right")}${td(money(tot.bog_revenue), "right")}` +
        `${td("")}</tr>`;

      html = `<div style="font-family:sans-serif;">
        <h2>ბრენდების ანგარიში — ${esc(monthLabel)}</h2>
        <table style="border-collapse:collapse;width:100%;max-width:920px;font-size:14px;">
          <thead>
            <tr style="background:#26BB89;color:#fff;">
              ${th("ბრენდი")}${th("ტიპი")}${th("სულ")}${th("TBC")}${th("BOG")}${th("სულ შემოს.")}${th("TBC შემოს.")}${th("BOG შემოს.")}${th("საშ. ფასი")}
            </tr>
          </thead>
          <tbody>${bodyRows}${totalsRow}</tbody>
        </table>
        <p style="color:#888;font-size:12px;">გადახდილი შეკვეთები, პროდუქტის ფასი მიწოდების გარეშე.</p>
      </div>`;
    }

    // ── Send via Resend (direct — mirrors create-payment's pattern) ──
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
    const accountant = Deno.env.get("ACCOUNTANT_EMAIL") || "nutsachkheidze1@gmail.com";
    let emailSent = false;

    if (!resendKey) {
      console.error("[monthly-brands-report] RESEND_API_KEY not set — email NOT sent");
    } else {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: resendFrom,
            to: [accountant],
            cc: ["maika@maika.ge"],
            subject: `ბრენდების ანგარიში — ${monthLabel}`,
            html,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          console.error("[monthly-brands-report] Resend HTTP", res.status, body);
        } else {
          emailSent = true;
          const body = await res.json().catch(() => null);
          console.log("[monthly-brands-report] sent; resend_id:", body?.id, "brands:", rows.length);
        }
      } catch (sendErr) {
        console.error("[monthly-brands-report] Resend fetch threw:", sendErr);
      }
    }

    return new Response(
      JSON.stringify({ sent: emailSent, brands: rows.length, month: monthLabel }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[monthly-brands-report] fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
