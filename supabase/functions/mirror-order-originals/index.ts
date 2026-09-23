// mirror-order-originals — copy a cart order's original photos from
// cart-items/<cartItemId>/ into order-originals/<orderId>/ so the admin's
// "ორიგინალი" download buttons (which list that folder) work for cart orders.
//
// This used to run in the browser (CartPage.mirrorCartItemOriginals) and
// needed an anonymous SELECT policy on cart-items/, which let anyone enumerate
// every customer's original photos. It now runs here with the SERVICE ROLE,
// which bypasses storage RLS, so that policy can be dropped
// (migration 20260924110000).
//
// INPUT   { orderIds: string[] }   1..50 order row UUIDs (the rows CartPage
//                                  just inserted for one cart item)
// OUTPUT  200 { results: { [orderId]: { status, copied?, skipped?, failed? } } }
//         400 only for a malformed body
//
// WHY THIS CANNOT BE ABUSED. The caller supplies order ids only. Each row's
// design_state is read with the service role and the ONLY files copied are the
// cart-items/ originals that row's own photos[].url already reference (see
// derive.ts — the regex is the allow-list). No listing, no caller-supplied
// paths. The worst a caller can do with a real order id is re-copy that order's
// own files into that order's own folder, which is idempotent. An unknown id
// reports "not_found"; a row whose design_state references no cart file
// reports "nothing_to_copy" — either way nothing is read from or written to
// storage. Order ids are random UUIDs, so this is not a usable existence
// oracle; the same ids are already in the payment redirect URL.
//
// FAIL SOFT, exactly as today: a copy failure is logged and reported in the
// body, never an error status, and never touches the order row. CartPage
// fires this and does not await it, so a slow or failed copy cannot delay the
// payment redirect. A copy onto a path that already exists (a retry, or the
// old browser-side copy having run first) is counted as "skipped", not failed.
//
// AUTH. verify_jwt = false for this function (supabase/config.toml): guest
// checkout has no JWT. There is no secret to check — the request carries no
// authority beyond naming order ids, and naming an order id grants nothing.
//
// DEPLOY. A GitHub merge does not deploy edge functions; deploy this manually
// BEFORE applying 20260924110000, or guest cart checkouts silently stop
// copying originals.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deriveCopyJobs, isDuplicateError, parseOrderIds } from "./derive.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "designs";

type OrderResult =
  | { status: "not_found" }
  | { status: "no_design_state" }
  | { status: "nothing_to_copy" }
  | { status: "done"; copied: number; skipped: number; failed: number };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const orderIds = parseOrderIds(body);
  if (!orderIds) return json(400, { error: "orderIds: 1..50 UUIDs required" });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    // Names only, never values. Soft: the order is already placed; only the
    // admin's originals view is affected.
    console.error("[mirror-order-originals] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    return json(200, { results: Object.fromEntries(orderIds.map((id) => [id, { status: "nothing_to_copy" }])), warning: "service role not configured" });
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error: readErr } = await admin
    .from("orders")
    .select("id, design_state")
    .in("id", orderIds);
  if (readErr) {
    console.error("[mirror-order-originals] orders read failed:", readErr.message);
    return json(200, { results: Object.fromEntries(orderIds.map((id) => [id, { status: "nothing_to_copy" }])), warning: "orders read failed" });
  }

  const byId = new Map<string, unknown>((rows ?? []).map((r: { id: string; design_state: unknown }) => [String(r.id).toLowerCase(), r.design_state]));
  const results: Record<string, OrderResult> = {};

  for (const orderId of orderIds) {
    if (!byId.has(orderId)) { results[orderId] = { status: "not_found" }; continue; }
    const derived = deriveCopyJobs(byId.get(orderId), orderId);
    if (derived.status !== "ok") { results[orderId] = { status: derived.status }; continue; }

    let copied = 0, skipped = 0, failed = 0;
    await Promise.all(derived.jobs.map(async ({ from, to }) => {
      const { error } = await admin.storage.from(BUCKET).copy(from, to);
      if (!error) { copied++; return; }
      if (isDuplicateError(error.message)) { skipped++; return; }
      failed++;
      console.warn(`[mirror-order-originals] copy ${from} → ${to} failed: ${error.message}`);
    }));
    results[orderId] = { status: "done", copied, skipped, failed };
  }

  console.log(`[mirror-order-originals] ${JSON.stringify(results)}`);
  return json(200, { results });
});
