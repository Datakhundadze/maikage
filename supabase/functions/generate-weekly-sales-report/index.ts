import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Per-brand sales report emailed to the accountant. Triggered by pg_cron
// (net.http_post with the service-role Bearer) — hence verify_jwt = true (no
// public exposure). Body { "period": "week" | "month" } selects the PREVIOUS
// COMPLETE calendar period (default "week"): week = last Mon 00:00 → this Mon
// 00:00, month = 1st of last month → 1st of this month, both in Asia/Tbilisi
// wall-clock. Reproduces the "ბრენდები" (Brands) sheet of PAID orders: one row
// per brand×type, PER ITEM (public.orders is one row per item), with a TBC/BOG
// bank split where Flitt + tbc_credit both count under TBC. Emails via Resend.

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
  other_items: number;
  total_revenue: number;
  tbc_revenue: number;
  bog_revenue: number;
  other_revenue: number;
  avg_price: number;
}

interface WeekMeta {
  total_orders: number;
  unknown_providers: string | null;
}

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

// DD.MM of a Tbilisi-wall-clock Date (its getUTC* fields hold Tbilisi local).
function ddmm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Georgian month names for the monthly subject/label.
const GE_MONTHS = [
  "იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
  "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი",
];

// Asia/Tbilisi is UTC+4 year-round (no DST since 2005), so a fixed offset is
// exact. Shifting by +4h makes a Date's getUTC* fields read as Tbilisi local.
const TB_OFFSET_MS = 4 * 60 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Requested period (default "week" when the body is absent/empty/invalid).
    let period: "week" | "month" = "week";
    try {
      const body = await req.json();
      if (body?.period === "month") period = "month";
    } catch { /* no/invalid body → default "week" */ }

    // Previous COMPLETE calendar period, computed in Tbilisi wall-clock, then
    // converted to real UTC for the timestamptz filter. `toTb` is the exclusive
    // end (start of the current period); the SQL filter is [p_from, p_to).
    const nowTb = new Date(Date.now() + TB_OFFSET_MS); // getUTC* now read as Tbilisi local
    let fromTb: Date;
    let toTb: Date;
    if (period === "month") {
      toTb = new Date(Date.UTC(nowTb.getUTCFullYear(), nowTb.getUTCMonth(), 1));       // 1st of this month 00:00
      fromTb = new Date(Date.UTC(nowTb.getUTCFullYear(), nowTb.getUTCMonth() - 1, 1)); // 1st of last month 00:00
    } else {
      const dow = (nowTb.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
      toTb = new Date(Date.UTC(nowTb.getUTCFullYear(), nowTb.getUTCMonth(), nowTb.getUTCDate() - dow)); // this Mon 00:00
      fromTb = new Date(toTb.getTime() - 7 * 24 * 60 * 60 * 1000);                     // last Mon 00:00
    }
    const pFrom = new Date(fromTb.getTime() - TB_OFFSET_MS).toISOString();
    const pTo = new Date(toTb.getTime() - TB_OFFSET_MS).toISOString();

    // Human labels (Tbilisi wall-clock). Week = Mon–Sun (last day = end − 1 day).
    const rangeLabel = `${ddmm(fromTb)}–${ddmm(new Date(toTb.getTime() - 24 * 60 * 60 * 1000))}`;
    const monthLabel = `${GE_MONTHS[fromTb.getUTCMonth()]} ${fromTb.getUTCFullYear()}`;
    const periodValue = period === "month" ? monthLabel : rangeLabel;
    const periodWord = period === "month" ? "თვე" : "კვირა";
    const titlePrefix = period === "month" ? "თვის რეპორტი" : "კვირის რეპორტი";

    // Aggregations via SECURITY DEFINER SQL functions (clean FILTER support).
    const { data: brandData, error: brandErr } = await supabase.rpc("report_brands", { p_from: pFrom, p_to: pTo });
    if (brandErr) throw new Error(`brands aggregation failed: ${brandErr.message}`);
    const { data: metaData, error: metaErr } = await supabase.rpc("report_meta", { p_from: pFrom, p_to: pTo });
    if (metaErr) throw new Error(`meta aggregation failed: ${metaErr.message}`);

    const rows: BrandRow[] = ((brandData as BrandRow[]) || []).map((r) => ({
      brand: r.brand,
      type: r.type,
      total_items: Number(r.total_items),
      tbc_items: Number(r.tbc_items),
      bog_items: Number(r.bog_items),
      other_items: Number(r.other_items),
      total_revenue: Number(r.total_revenue),
      tbc_revenue: Number(r.tbc_revenue),
      bog_revenue: Number(r.bog_revenue),
      other_revenue: Number(r.other_revenue),
      avg_price: Number(r.avg_price),
    }));
    const meta: WeekMeta = {
      total_orders: Number((metaData as WeekMeta[] | null)?.[0]?.total_orders ?? 0),
      unknown_providers: (metaData as WeekMeta[] | null)?.[0]?.unknown_providers ?? null,
    };

    const tot = rows.reduce(
      (a, r) => ({
        total_items: a.total_items + r.total_items,
        tbc_items: a.tbc_items + r.tbc_items,
        bog_items: a.bog_items + r.bog_items,
        other_items: a.other_items + r.other_items,
        total_revenue: a.total_revenue + r.total_revenue,
        tbc_revenue: a.tbc_revenue + r.tbc_revenue,
        bog_revenue: a.bog_revenue + r.bog_revenue,
      }),
      { total_items: 0, tbc_items: 0, bog_items: 0, other_items: 0, total_revenue: 0, tbc_revenue: 0, bog_revenue: 0 },
    );

    // Flag any unexpected payment_provider values (never silently dropped).
    if (meta.unknown_providers || tot.other_items > 0) {
      console.warn("[weekly-sales-report] unexpected payment_provider values not counted under TBC/BOG:", meta.unknown_providers, "other_items:", tot.other_items);
    }

    // ── Build the HTML email ──
    const header = `<p style="font-size:14px;">
      <strong>${periodWord}:</strong> ${esc(periodValue)} ·
      <strong>შეკვეთები:</strong> ${meta.total_orders} ·
      <strong>ნივთები:</strong> ${tot.total_items} ·
      <strong>შემოსავალი:</strong> ${money(tot.total_revenue)}
    </p>`;

    let html: string;
    if (rows.length === 0) {
      html = `<div style="font-family:sans-serif;">
        <h2>${titlePrefix} — ${esc(periodValue)}</h2>
        <p>ამ პერიოდში გადახდილი შეკვეთა არ ყოფილა.</p>
      </div>`;
    } else {
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
        `<tr style="font-weight:bold;background:#f3f4f6;">${td("ჯამი")}${td("")}` +
        `${td(String(tot.total_items), "right")}${td(String(tot.tbc_items), "right")}${td(String(tot.bog_items), "right")}` +
        `${td(money(tot.total_revenue), "right")}${td(money(tot.tbc_revenue), "right")}${td(money(tot.bog_revenue), "right")}` +
        `${td("")}</tr>`;

      const otherNote = (tot.other_items > 0 || meta.unknown_providers)
        ? `<p style="color:#b45309;font-size:12px;">⚠ სხვა/უცნობი payment_provider: ${esc(meta.unknown_providers ?? "?")} (${tot.other_items} ნივთი — არ ჩაითვალა TBC/BOG-ში).</p>`
        : "";

      html = `<div style="font-family:sans-serif;">
        <h2>${titlePrefix} — ${esc(periodValue)}</h2>
        ${header}
        <table style="border-collapse:collapse;width:100%;max-width:920px;font-size:14px;">
          <thead>
            <tr style="background:#26BB89;color:#fff;">
              ${th("ბრენდი")}${th("ტიპი")}${th("სულ")}${th("TBC")}${th("BOG")}${th("სულ შემოს.")}${th("TBC შემოს.")}${th("BOG შემოს.")}${th("საშ. ფასი")}
            </tr>
          </thead>
          <tbody>${bodyRows}${totalsRow}</tbody>
        </table>
        <p style="color:#888;font-size:12px;">გადახდილი შეკვეთები, per-item, პროდუქტის ფასი მიწოდების გარეშე. TBC = TBC + Flitt.</p>
        ${otherNote}
      </div>`;
    }

    // ── Send via Resend (direct — mirrors create-payment's proven pattern) ──
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
    const accountant = Deno.env.get("ACCOUNTANT_EMAIL"); // no hardcoded fallback
    let emailSent = false;

    if (!resendKey) {
      console.error("[weekly-sales-report] RESEND_API_KEY not set — email NOT sent");
    } else if (!accountant) {
      console.error("[weekly-sales-report] ACCOUNTANT_EMAIL not set — email NOT sent");
    } else {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: resendFrom,
            to: [accountant],
            cc: ["maika@maika.ge"],
            subject: `maika.ge — ${titlePrefix} (${periodValue})`,
            html,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          console.error("[weekly-sales-report] Resend HTTP", res.status, body);
        } else {
          emailSent = true;
          const body = await res.json().catch(() => null);
          console.log("[weekly-sales-report] sent; resend_id:", body?.id, "brands:", rows.length, "orders:", meta.total_orders);
        }
      } catch (sendErr) {
        console.error("[weekly-sales-report] Resend fetch threw:", sendErr);
      }
    }

    return new Response(
      JSON.stringify({ sent: emailSent, period, brands: rows.length, orders: meta.total_orders, items: tot.total_items, range: periodValue }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[weekly-sales-report] fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
