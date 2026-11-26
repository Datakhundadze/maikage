// "Not handled yet" for the admin order list (2026-11-26).
//
// WHY: a paid order used to look exactly like every handled one (all sit at
// status "confirmed"), so one that arrived after hours or while the tab showed
// an older list was simply buried under newer rows — nobody had to refresh at
// the right moment to lose it. Now a paid order stays PINNED on top of the
// admin list, and counted in the tab badge, until a person presses „მივიღე",
// which moves it to "in_production" through the existing admin_update_order
// RPC. No schema change: the order's own status is the acknowledgement.
//
// Not pinned: unpaid / failed checkouts (not orders to make), showroom orders
// (typed in by the staff themselves), and anything before ACK_SINCE — older
// paid orders were never moved off "confirmed" and would all light up at once.

// Owner 26.11.2026 13:23: start from now on — the older paid orders were
// already handled by the team, only new ones are pinned.
export const ACK_SINCE_ISO = "2026-11-26T09:00:00.000Z"; // 26.11.2026 13:00 Tbilisi
export const ACK_STATUS = "in_production";
export const SHOWROOM_PROVIDER_ID = "showroom";

export interface AckFields {
  status: string;
  payment_status: string;
  payment_provider?: string | null;
  created_at: string;
}

const ACK_SINCE_MS = Date.parse(ACK_SINCE_ISO);

export function needsAck(o: AckFields): boolean {
  return (
    o.payment_status === "paid" &&
    (o.status === "pending" || o.status === "confirmed") &&
    o.payment_provider !== SHOWROOM_PROVIDER_ID &&
    // created_at arrives in varying ISO shapes — compare instants, not strings.
    new Date(o.created_at).getTime() >= ACK_SINCE_MS
  );
}
