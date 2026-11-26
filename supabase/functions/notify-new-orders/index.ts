import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// E-mail to the shop for every PAID order (2026-11-26, owner's request after a
// paid order sat unnoticed for a week). Runs from pg_cron every 2 minutes with
// the service-role Bearer — NOT from the payment callbacks, which stay
// untouched: whatever path marks an order paid (Flitt/TBC/BOG callback, the
// admin's payment check, a manual status change), this picks it up.
//
// Exactly-once-ish: rows are CLAIMED first (staff_notified_at = now() where it
// was null), then one e-mail per checkout (cart) is sent; if the send fails the
// claim is released and the next run retries. Showroom orders are entered by
// the staff themselves and are skipped. Only orders created in the last 30 days
// are considered, so an old backlog can never be mailed out by accident.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOP_EMAIL = "maika@maika.ge";
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_URL = "https://maika.ge/admin";

interface OrderRow {
  id: string;
  cart_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  product: string | null;
  sub_product: string | null;
  color: string | null;
  size: string | null;
  total_price: number | null;
  delivery_type: string | null;
  delivery_address: string | null;
  comment: string | null;
  paid_at: string | null;
  created_at: string;
  front_mockup_url: string | null;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}

// Same check as generate-weekly-sales-report: verify_jwt = true would let the
// public anon key through, so require the service_role claim.
function jwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const part = authHeader.slice("Bearer ".length).trim().split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const role = (JSON.parse(atob(b64)) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

const DELIVERY_KA: Record<string, string> = {
  pickup: "ადგილზე გატანა",
  courier_tbilisi: "კურიერი — თბილისი",
  courier_region: "კურიერი — რეგიონი",
  courier_express: "ექსპრეს კურიერი",
};

function tbilisiTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Tbilisi", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function buildEmail(rows: OrderRow[]): { subject: string; html: string } {
  const head = rows[0];
  const name = `${head.first_name ?? ""} ${head.last_name ?? ""}`.trim() || "—";
  const total = rows.reduce((s, r) => s + (Number(r.total_price) || 0), 0);
  const items = rows
    .map((r) =>
      `<li>${esc(r.product)}${r.sub_product && r.sub_product !== r.product ? ` · ${esc(r.sub_product)}` : ""} · ${esc(r.color ?? "—")} · ${esc(r.size ?? "—")}</li>`)
    .join("");
  const cell = 'style="padding:6px 10px;border:1px solid #ddd;"';
  const row = (k: string, v: string) => `<tr><td ${cell}><b>${k}</b></td><td ${cell}>${v}</td></tr>`;
  const html = `
<h2>🆕 ახალი გადახდილი შეკვეთა</h2>
<table style="border-collapse:collapse;max-width:600px;">
${row("კლიენტი", esc(name))}
${row("ტელეფონი", esc(head.phone ?? "—"))}
${row("ელ.ფოსტა", esc(head.email ?? "—"))}
${row("გადახდილია", `${tbilisiTime(head.paid_at ?? head.created_at)} · ${total} ₾`)}
${row("მიწოდება", esc(DELIVERY_KA[head.delivery_type ?? ""] ?? head.delivery_type ?? "—") + (head.delivery_address ? `<br>${esc(head.delivery_address)}` : ""))}
${head.comment ? row("კომენტარი", esc(head.comment)) : ""}
</table>
<p><b>ნივთები (${rows.length}):</b></p><ul>${items}</ul>
${head.front_mockup_url ? `<p><img src="${esc(head.front_mockup_url)}" alt="" width="260" style="border:1px solid #ddd;border-radius:6px;"></p>` : ""}
<p><a href="${ADMIN_URL}">გახსენი ადმინი</a> და დააჭირე „მივიღე“-ს, როცა წარმოებაში გაუშვებ.</p>`.trim();
  return { subject: `🆕 ახალი შეკვეთა — ${name} · ${total} ₾`, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (jwtRole(req.headers.get("Authorization")) !== "service_role") return json(403, { error: "Forbidden" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
  if (!resendKey) {
    console.error("[notify-new-orders] RESEND_API_KEY not set — nothing claimed, nothing sent");
    return json(500, { error: "RESEND_API_KEY not set" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  // Claim. Concurrent runs cannot both get the same row: the UPDATE's WHERE is
  // re-checked under the row lock.
  const { data: claimed, error } = await supabase
    .from("orders")
    .update({ staff_notified_at: new Date().toISOString() })
    .eq("payment_status", "paid")
    .is("staff_notified_at", null)
    .neq("payment_provider", "showroom")
    .gte("created_at", since)
    .select("id,cart_id,first_name,last_name,phone,email,product,sub_product,color,size,total_price,delivery_type,delivery_address,comment,paid_at,created_at,front_mockup_url");
  if (error) {
    console.error("[notify-new-orders] claim failed:", error.message);
    return json(500, { error: error.message });
  }
  const rows = (claimed ?? []) as OrderRow[];
  if (rows.length === 0) return json(200, { sent: 0 });

  const groups = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const key = r.cart_id ?? `single-${r.id}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  let sent = 0;
  let failed = 0;
  for (const group of groups.values()) {
    const { subject, html } = buildEmail(group);
    let ok = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: resendFrom, to: [SHOP_EMAIL], subject, html }),
      });
      ok = res.ok;
      if (!ok) console.error("[notify-new-orders] Resend HTTP", res.status, await res.text());
    } catch (e) {
      console.error("[notify-new-orders] Resend fetch threw:", e);
    }
    if (ok) {
      sent += 1;
    } else {
      failed += 1;
      // Release the claim so the next run retries this checkout.
      const { error: relErr } = await supabase
        .from("orders")
        .update({ staff_notified_at: null })
        .in("id", group.map((r) => r.id));
      if (relErr) console.error("[notify-new-orders] release failed:", relErr.message);
    }
  }
  console.log("[notify-new-orders] sent:", sent, "failed:", failed);
  return json(failed > 0 && sent === 0 ? 502 : 200, { sent, failed });
});
