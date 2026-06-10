import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// Tabs that get a Gmail-style "new since you last looked" badge. The
// other admin tabs (dashboard, analytics) are aggregate views with no
// natural per-row "new item" semantic.
export type BadgeTabId = "orders" | "users" | "designs" | "catalog" | "corporate";

const STORAGE_KEY = "maika-admin-tab-seen-v1";
const POLL_INTERVAL_MS = 30_000;

// Each badge tab counts new rows in this table since the per-tab
// last_seen_at timestamp held in localStorage. The literal union here
// matches the generated Database type so supabase.from(table) stays
// typed end-to-end.
type SourceTable =
  | "orders"
  | "profiles"
  | "generations"
  | "catalog_designs"
  | "corporate_inquiries";

const TAB_SOURCE: Record<BadgeTabId, SourceTable> = {
  orders: "orders",
  users: "profiles",
  designs: "generations",
  catalog: "catalog_designs",
  corporate: "corporate_inquiries",
};

const TAB_IDS: BadgeTabId[] = ["orders", "users", "designs", "catalog", "corporate"];

type SeenAtMap = Record<BadgeTabId, string>;
type CountMap = Record<BadgeTabId, number>;

const ZERO_COUNTS: CountMap = { orders: 0, users: 0, designs: 0, catalog: 0, corporate: 0 };

function nowIso(): string {
  return new Date().toISOString();
}

// Read the persisted seen-at timestamps. First-ever load seeds every
// tab with `now` and writes it back, so a fresh admin install doesn't
// flood the new badges with the entire production history's worth of
// rows (which would never get cleared until each tab is opened).
function readSeenAt(): SeenAtMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SeenAtMap>;
      const seed = nowIso();
      return {
        orders: parsed.orders ?? seed,
        users: parsed.users ?? seed,
        designs: parsed.designs ?? seed,
        catalog: parsed.catalog ?? seed,
        corporate: parsed.corporate ?? seed,
      };
    }
  } catch {
    /* fall through to seed */
  }
  const seed = nowIso();
  const seeded: SeenAtMap = {
    orders: seed,
    users: seed,
    designs: seed,
    catalog: seed,
    corporate: seed,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    /* storage disabled — counts will recompute against in-memory state */
  }
  return seeded;
}

function writeSeenAt(map: SeenAtMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage disabled — tolerate; in-memory ref still tracks */
  }
}

/**
 * Tracks "new since you last looked" counts for each badge-eligible
 * admin tab. Polls every 30 s, pauses while the document is hidden.
 *
 * - `counts[tab]`: number of new items in the tab's source table created
 *   after the admin's last visit to that tab. For orders this is order
 *   GROUPS (distinct cart_id; null-cart_id rows count individually) to
 *   match the grouped AdminOrders view; other tabs count rows.
 * - `markSeen(tab)`: call when the admin opens that tab. Resets the
 *   local count to 0 immediately and persists `last_seen_at = now` to
 *   localStorage so the next poll continues to return 0.
 *
 * All state is per-browser via localStorage — no DB schema change.
 * Upgrade path to Supabase Realtime: swap the setInterval inside the
 * effect for a `supabase.channel(...).on('postgres_changes', INSERT)`
 * subscription; the rest of the hook (and its consumers) stay the same.
 */
export function useAdminTabBadges(): {
  counts: CountMap;
  markSeen: (tab: BadgeTabId) => void;
} {
  // Held in a ref so the polling effect can read fresh values without
  // re-subscribing every time markSeen runs.
  const seenAtRef = useRef<SeenAtMap>(readSeenAt());
  const [counts, setCounts] = useState<CountMap>(ZERO_COUNTS);

  const fetchCounts = useCallback(async () => {
    const seenAt = seenAtRef.current;
    const results = await Promise.all(
      TAB_IDS.map(async (tab) => {
        const table = TAB_SOURCE[tab];
        // Orders are displayed grouped by cart_id (a qty=3 checkout inserts
        // 3 rows sharing one cart_id), so the badge counts ORDER GROUPS:
        // distinct cart_id plus each null-cart_id row. PostgREST can't
        // COUNT(DISTINCT) through the JS client, so fetch the new rows'
        // cart_ids and count groups client-side — the new-order volume in
        // a since-last-seen window is small, so this stays cheap.
        if (tab === "orders") {
          const { data, error } = await supabase
            .from("orders")
            .select("id, cart_id")
            .gt("created_at", seenAt[tab]);
          if (error) {
            console.warn(`[useAdminTabBadges] count failed for ${table}:`, error.message);
            return [tab, 0] as const;
          }
          const cartIds = new Set<string>();
          let singles = 0;
          for (const row of data ?? []) {
            if (row.cart_id) cartIds.add(row.cart_id);
            else singles += 1;
          }
          return [tab, cartIds.size + singles] as const;
        }
        const { count, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .gt("created_at", seenAt[tab]);
        if (error) {
          console.warn(`[useAdminTabBadges] count failed for ${table}:`, error.message);
          return [tab, 0] as const;
        }
        return [tab, count ?? 0] as const;
      }),
    );
    setCounts((prev) => {
      const next = { ...prev };
      for (const [tab, c] of results) next[tab] = c;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      // Fire immediately so badges populate on first visible mount
      // rather than waiting up to 30 s for the first interval tick.
      if (!cancelled) fetchCounts();
      intervalId = setInterval(() => {
        if (!cancelled) fetchCounts();
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchCounts]);

  const markSeen = useCallback((tab: BadgeTabId) => {
    const next: SeenAtMap = { ...seenAtRef.current, [tab]: nowIso() };
    seenAtRef.current = next;
    writeSeenAt(next);
    setCounts((prev) => (prev[tab] === 0 ? prev : { ...prev, [tab]: 0 }));
  }, []);

  return { counts, markSeen };
}
