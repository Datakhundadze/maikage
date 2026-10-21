import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Admin-only: loads public.order_attribution rows for the orders currently
// listed in AdminOrders and lets an admin tag the channel by hand. Separate
// from AdminOrders.fetchOrders on purpose — that fetch is untouched, and a
// missing table (migration not applied yet) only hides the badges.
// Table / RPC: supabase/migrations/20261021120000_order_attribution.sql.

export const MANUAL_CHANNELS = ["messenger", "instagram", "whatsapp", "phone", "store", "other"] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

export const MANUAL_CHANNEL_LABELS: Record<ManualChannel, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  phone: "ტელეფონი",
  store: "მაღაზია",
  other: "სხვა",
};

export interface OrderAttributionRow {
  order_id: string;
  cart_id: string | null;
  ft_source: string | null;
  ft_medium: string | null;
  ft_campaign: string | null;
  ft_content: string | null;
  ft_term: string | null;
  ft_fbclid: string | null;
  ft_gclid: string | null;
  ft_referrer: string | null;
  ft_landing_page: string | null;
  ft_seen_at: string | null;
  lt_source: string | null;
  lt_medium: string | null;
  lt_campaign: string | null;
  lt_content: string | null;
  lt_term: string | null;
  lt_fbclid: string | null;
  lt_gclid: string | null;
  lt_referrer: string | null;
  lt_landing_page: string | null;
  lt_seen_at: string | null;
  in_app: string | null;
  manual_channel: ManualChannel | null;
  manual_note: string | null;
  manual_set_by: string | null;
  manual_set_at: string | null;
  created_at: string;
}

type TouchPrefix = "ft" | "lt";

/** Human label for one touch, or null when the touch carries no signal. */
export function touchLabel(row: OrderAttributionRow, t: TouchPrefix): string | null {
  const src = row[`${t}_source`];
  const med = row[`${t}_medium`];
  if (src || med) return [src, med].filter(Boolean).join(" / ");
  if (row[`${t}_fbclid`]) return "Meta";
  if (row[`${t}_gclid`]) return "Google";
  const ref = row[`${t}_referrer`];
  if (ref) return ref.split("/")[0] || ref;
  return null;
}

/** Badge text + tooltip for a group's attribution rows (any row of the cart). */
export function attributionSummary(rows: OrderAttributionRow[]): { label: string; title: string; manual: boolean } | null {
  if (rows.length === 0) return null;
  const manualRow = rows.find((r) => r.manual_channel);
  const auto = rows.find((r) => touchLabel(r, "ft") || touchLabel(r, "lt") || r.in_app) ?? rows[0];
  const ft = touchLabel(auto, "ft");
  const lt = touchLabel(auto, "lt");
  const inApp = auto.in_app ? `${auto.in_app} app` : null;
  const autoLabel = ft ?? lt ?? inApp ?? "direct/unknown";

  const lines: string[] = [];
  if (ft) lines.push(`პირველი შეხება: ${ft}${auto.ft_campaign ? ` · ${auto.ft_campaign}` : ""}`);
  if (lt && lt !== ft) lines.push(`ბოლო შეხება: ${lt}${auto.lt_campaign ? ` · ${auto.lt_campaign}` : ""}`);
  if (inApp) lines.push(`ბრაუზერი: ${inApp}`);

  if (manualRow?.manual_channel) {
    lines.unshift(`ხელით: ${MANUAL_CHANNEL_LABELS[manualRow.manual_channel] ?? manualRow.manual_channel}`);
    return {
      label: MANUAL_CHANNEL_LABELS[manualRow.manual_channel] ?? manualRow.manual_channel,
      title: lines.join("\n"),
      manual: true,
    };
  }
  return { label: autoLabel, title: lines.join("\n") || "წყარო უცნობია", manual: false };
}

const CHUNK = 100;

// order_attribution is not in the generated types (types are not regenerated
// for manual migrations), so query it through an untyped view of the client.
const db = supabase as unknown as SupabaseClient;

export function useOrderAttribution(orderIds: string[]) {
  const [byOrderId, setByOrderId] = useState<Record<string, OrderAttributionRow>>({});
  const genRef = useRef(0);
  const idsKey = orderIds.join(",");

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;
    const gen = ++genRef.current;
    (async () => {
      const next: Record<string, OrderAttributionRow> = {};
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await db
          .from("order_attribution")
          .select("*")
          .in("order_id", ids.slice(i, i + CHUNK));
        if (error) {
          // Table not created yet / RLS — badges simply stay hidden.
          console.warn("[useOrderAttribution]", error.message);
          return;
        }
        for (const r of (data as unknown as OrderAttributionRow[] | null) || []) next[r.order_id] = r;
      }
      if (gen !== genRef.current) return;
      setByOrderId(next);
    })().catch((e) => console.warn("[useOrderAttribution]", e));
  }, [idsKey]);

  /** Upsert manual_channel for one order (inserts a row if none exists). */
  const setManualChannel = useCallback(
    async (orderId: string, cartId: string | null, channel: ManualChannel | null, userId: string | null) => {
      const payload = {
        order_id: orderId,
        cart_id: cartId,
        manual_channel: channel,
        manual_set_by: userId,
        manual_set_at: new Date().toISOString(),
      };
      const { data, error } = await db
        .from("order_attribution")
        .upsert(payload, { onConflict: "order_id" })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as unknown as OrderAttributionRow | null;
      if (row) setByOrderId((prev) => ({ ...prev, [row.order_id]: row }));
    },
    [],
  );

  return { byOrderId, setManualChannel };
}
