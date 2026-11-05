// Showroom ("მაღაზია") order save — admin only, NO card payment.
//
// David 2026-11-05: when the shop account (any admin, e.g. maika@maika.ge) is
// logged in, the cart / order dialog must not send the operator to Flitt;
// the operator picks „გადახდილია" / „გადაუხდელია" and the order is just saved,
// so it shows up in the admin with its print package like any site order.
//
// ADD-ONLY: the card path (submitOrder → payment edge function) is untouched;
// callers branch to this function instead of submitOrder when the admin chose
// the showroom save. It does exactly what the payment path would have done
// for the order rows, minus the payment:
//   1. insert the rows (payment_status "unpaid", payment_provider "showroom")
//      — the same INSERT the card path makes, same RLS;
//   2. apply the back_transparent_image_url backfill (the card path does this
//      server-side in create-payment-*; admins hold the orders UPDATE policy);
//   3. mark the rows paid through the admin-gated admin_update_order RPC when
//      „გადახდილია" was chosen (sets paid_at) — never by inserting "paid";
//   4. tag order_attribution.manual_channel = "store" so the admin list shows
//      „მაღაზია" as the channel.
// Steps 2–4 are best-effort after the insert: a failure there is returned as
// a warning, the order itself is already saved.

import { supabase } from "@/integrations/supabase/client";

export const SHOWROOM_PROVIDER = "showroom";

/** Admin's choice in the order form: card (normal Flitt path) or a showroom save. */
export type ShowroomMode = "card" | "paid" | "unpaid";

export function showroomSubmitLabel(mode: ShowroomMode, submitting: boolean): string | null {
  if (mode === "card") return null;
  if (submitting) return "ინახება...";
  return "შეკვეთის შენახვა";
}


type Row = Record<string, unknown> & { id: string; cart_id?: string | null };

export interface SaveShowroomOrderParams {
  rows: Row[];
  paid: boolean;
  backTransparentBackfill?: { orderIds: string[]; url: string }[];
  adminUserId: string | null;
}

export interface SaveShowroomOrderResult {
  orderIds: string[];
  warnings: string[];
}

export async function saveShowroomOrder(p: SaveShowroomOrderParams): Promise<SaveShowroomOrderResult> {
  if (!p.rows.length) throw new Error("შეკვეთაში ნივთი არ არის");
  const rows = p.rows.map((r) => ({ ...r, payment_provider: SHOWROOM_PROVIDER, payment_status: "unpaid" }));
  const ids = rows.map((r) => r.id);

  const { error } = await supabase.from("orders").insert(rows as never);
  if (error) throw new Error(error.message);

  const warnings: string[] = [];

  for (const b of p.backTransparentBackfill ?? []) {
    if (!b.orderIds.length || !b.url) continue;
    const { error: e } = await supabase
      .from("orders")
      .update({ back_transparent_image_url: b.url } as never)
      .in("id", b.orderIds);
    if (e) warnings.push(`უკანა პრინტ ფაილი ვერ ჩაიწერა: ${e.message}`);
  }

  if (p.paid) {
    const results = await Promise.allSettled(
      ids.map((id) =>
        supabase.rpc("admin_update_order" as never, { p_order_id: id, p_field: "payment_status", p_value: "paid" } as never),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected" || (r.value as { error?: unknown }).error).length;
    if (failed) warnings.push(`${failed} ნივთი „გადახდილად" ვერ მოინიშნა — ადმინკაში მონიშნე ხელით`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const now = new Date().toISOString();
  const { error: aErr } = await db.from("order_attribution").upsert(
    rows.map((r) => ({
      order_id: r.id,
      cart_id: r.cart_id ?? null,
      manual_channel: "store",
      manual_set_by: p.adminUserId,
      manual_set_at: now,
    })),
    { onConflict: "order_id" },
  );
  if (aErr) warnings.push(`არხი „მაღაზია" ვერ მიეთითა: ${aErr.message}`);

  return { orderIds: ids, warnings };
}
