import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Download, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import type { DesignState } from "@/lib/designState";
import { isDesignState } from "@/lib/designState";
import { compositePrintFileFromDesignState } from "@/lib/designCompositor";
import { uploadBlobWithRetry } from "@/lib/uploadWithRetry";
// DISPLAY ONLY — every <img> below goes through this, every download button
// keeps the raw stored URL. This was the one admin tab fetching originals
// into thumbnails: each summary row pulled its full 800×800 mockup PNG
// (~1.1MB) into a 40px box and an expanded order pulled 4000×4000 print
// PNGs (~4MB) into 256px boxes, all eagerly. The print file the admin
// DOWNLOADS and sends to production must stay byte-identical, so
// downloadImage() calls are deliberately left on the untransformed URLs.
import { transformedDisplayUrl } from "@/lib/imageTransform";

// Display widths. Generous on purpose — a soft thumbnail is a worse bug than
// one that loads in 40ms instead of 20: the 40px summary chip gets 128
// (AdminGenerations' size for the same kind of chip, 3.2× the box), and the
// 256px mockup/print views and 160px originals share 512 (2-3.2× their
// boxes, crisp on a 2× display). resize=contain + height ride along inside
// the helper — that exact shape is load-bearing, see imageTransform.ts.
const THUMB_W = 128;
const VIEW_W = 512;

// How stale the list must be before RETURNING TO THE TAB refetches it.
//
// This tab had exactly two triggers — mount and the „განახლება" button — and
// useAutoLogout deliberately suspends its idle timer while the tab is hidden,
// so a backgrounded admin tab is never signed out AND never refetched. A real
// incident: a tab last loaded at 16:52 still showed that snapshot at 12:43 the
// next day, three orders missing, with a „ბოლო" stamp from the previous
// afternoon to match.
//
// ONE MINUTE, and the number is a rate limit, not a freshness target. Coming
// back to the tab is a human-paced act; a minute is short enough that the list
// is current by the time the admin has read the header, and long enough that
// somebody alt-tabbing between this and a courier app cannot fire more than
// one unbounded select("*") per minute. It is NOT polling — nothing fires
// while the tab sits in front of you untouched.
const STALE_AFTER_MS = 60_000;

interface Order {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  product: string;
  sub_product: string | null;
  color: string | null;
  total_price: number;
  product_price: number;
  delivery_price: number;
  delivery_type: string;
  delivery_address: string | null;
  status: string;
  payment_status: string;
  is_studio: boolean;
  comment: string | null;
  created_at: string;
  bog_order_id: string | null;
  front_mockup_url: string | null;
  back_mockup_url: string | null;
  transparent_image_url: string | null;
  back_transparent_image_url: string | null;
  prompt: string | null;
  size: string | null;
  paid_at: string | null;
  cart_id: string | null;
  payment_provider: string;
  /** JSONB column added 2026-05-15; null for orders placed before then. */
  design_state: DesignState | null;
}

const STATUS_OPTIONS = ["pending", "confirmed", "in_production", "shipped", "delivered", "cancelled"];
const PAYMENT_OPTIONS = ["unpaid", "paid", "failed", "refunded"];

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "გადაუხდელი",
  paid: "გადახდილია",
  failed: "გადახდა ვერ განხორციელდა",
  refunded: "დაბრუნებული",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "მოლოდინში",
  confirmed: "დადასტურებული",
  in_production: "წარმოებაში",
  shipped: "გაგზავნილი",
  delivered: "მიტანილი",
  cancelled: "გაუქმებული",
};

const DELIVERY_LABELS: Record<string, string> = {
  pickup: "მაღაზიიდან გატანა",
  courier_tbilisi: "კურიერი თბილისში",
  courier_outside: "კურიერი რეგიონში",
};

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, "_blank");
  }
}

// Extract just the user's typed text from the saved prompt metadata.
// SimplePage stores prompt in this format:
//   "წინა მხარე:\n  ტექსტი: <text>\n  ფონტი: ...\n  ფერი: #..."
// We pull the value after "ტექსტი:" so the printed PNG shows clean text only.
function extractDesignText(prompt: string): string {
  const lines = prompt.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*ტექსტი:\s*(.*)$/);
    if (m && m[1].trim()) out.push(m[1]);
  }
  return out.length ? out.join("\n") : prompt;
}

// Render order text to a high-res transparent PNG so the print shop can use it
// even if the saved transparent_image_url is missing or low-res.
function renderTextToCanvas(rawPrompt: string): HTMLCanvasElement | null {
  const text = extractDesignText(rawPrompt);
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const W = 3000;
  const fontPx = 240;
  const lineH = Math.round(fontPx * 1.2);
  const H = Math.max(800, lines.length * lineH + lineH);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.font = `bold ${fontPx}px "Noto Sans Georgian", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * lineH);
  });

  return canvas;
}

function downloadTextAsPng(rawPrompt: string, filename: string) {
  const canvas = renderTextToCanvas(rawPrompt);
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}

function renderTextDataUrl(rawPrompt: string): string | null {
  const canvas = renderTextToCanvas(rawPrompt);
  return canvas ? canvas.toDataURL("image/png") : null;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  // FIRST LOAD ONLY. `loading` swaps the whole table for a spinner, so a
  // background refresh must never set it — blanking the list on every
  // visibility refetch would be a new bug, and it would also hide the rows
  // that a failed refresh is now supposed to leave standing.
  const [loading, setLoading] = useState(true);
  // A fetch is in flight: disables the button, nothing more.
  const [fetching, setFetching] = useState(false);
  // Last fetch FAILED. Shown in the header, cleared by the next success — a
  // silently stale list is the thing being fixed, so the failure is visible.
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Expanded card is keyed by GROUP key (cart_id, or `single-${id}` for
  // ungrouped single-unit orders), not by a row id.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // LAST SUCCESSFUL FETCH — null until one succeeds. It used to be stamped
  // after every attempt including failures, and to start at mount time, so it
  // could assert freshness for a list that had never loaded or had just failed
  // to reload. „ბოლო" now means what an admin reads it as.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // Monotonic request id. Only the NEWEST response may touch state: there was
  // no abort, no generation counter and no in-flight flag, so a slow earlier
  // response could land after a fast later one and overwrite fresh rows with
  // stale ones. Not the cause of the incident above, but the visibility
  // refetch makes concurrent fetches reachable, so it is closed here.
  const fetchGenRef = useRef(0);
  // Mirrors `fetching` for the auto-trigger, which needs a SYNCHRONOUS answer:
  // visibilitychange and focus can fire in the same tick, and state would still
  // read false for the second one.
  const inFlightRef = useRef(false);
  // Epoch ms of the last SUCCESS, read by the staleness gate. A ref so the
  // listener can be registered once and never re-subscribed.
  const lastSuccessRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Always the current fetchOrders, so the visibility listener below is
  // registered once with an empty dep array and still calls the live closure.
  const fetchRef = useRef<() => void>(() => {});
  const [originalPhotos, setOriginalPhotos] = useState<Record<string, { name: string; url: string }[]>>({});
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  // Group orders for display. Multi-unit checkouts (qty>1 or multi-item
  // cart) insert N rows sharing one cart_id; we collapse them into one card
  // here (display-only — no schema/checkout/payment change). Single-unit
  // orders (cart_id null) form a one-row group keyed by `single-${id}`.
  // `orders` is already sorted created_at DESC and a cart's rows share one
  // timestamp, so they're adjacent — Map insertion order preserves DESC.
  const groups = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders) {
      const key = o.cart_id ?? `single-${o.id}`;
      const arr = map.get(key);
      if (arr) arr.push(o);
      else map.set(key, [o]);
    }
    return Array.from(map.entries()).map(([key, rows]) => {
      // Collapse rows into display "units": rows identical across
      // product + sub_product + color + size + front/back mockup + prompt
      // become ONE block with a ×count; any difference splits into its own
      // block so each line item shows its own size/brand/color/design and is
      // fulfillable. (Print-file URLs are derived from the design, so they're
      // intentionally NOT part of the identity key.)
      const unitMap = new Map<string, { rep: Order; count: number }>();
      for (const r of rows) {
        const sig = JSON.stringify([
          r.product, r.sub_product, r.color, r.size,
          r.front_mockup_url, r.back_mockup_url, r.prompt,
        ]);
        const existing = unitMap.get(sig);
        if (existing) existing.count += 1;
        else unitMap.set(sig, { rep: r, count: 1 });
      }
      return {
        key,
        head: rows[0],
        rows,
        units: Array.from(unitMap.values()),
        quantity: rows.length,
        groupTotal: rows.reduce((s, r) => s + (r.total_price ?? 0), 0),
        deliveryTotal: rows.reduce((s, r) => s + (r.delivery_price ?? 0), 0),
        productSubtotal: rows.reduce((s, r) => s + (r.product_price ?? 0), 0),
      };
    });
  }, [orders]);

  // Load full-resolution originals for EVERY row in the expanded group
  // (each unit's originals live under order-originals/{rowId}/).
  useEffect(() => {
    if (!expandedKey) return;
    const group = groups.find((g) => g.key === expandedKey);
    if (!group) return;
    let cancelled = false;
    (async () => {
      for (const row of group.rows) {
        if (originalPhotos[row.id]) continue;
        const { data, error } = await supabase.storage
          .from("designs")
          .list(`order-originals/${row.id}`, { limit: 50 });
        if (cancelled) return;
        if (error || !data) {
          setOriginalPhotos((prev) => ({ ...prev, [row.id]: [] }));
          continue;
        }
        const files = data
          .filter((f) => f.name && !f.name.startsWith("."))
          .map((f) => {
            const { data: pub } = supabase.storage
              .from("designs")
              .getPublicUrl(`order-originals/${row.id}/${f.name}`);
            return { name: f.name, url: pub.publicUrl };
          });
        setOriginalPhotos((prev) => ({ ...prev, [row.id]: files }));
      }
    })();
    return () => { cancelled = true; };
  }, [expandedKey, groups, originalPhotos]);

  useEffect(() => {
    if (authLoading) return;
    fetchOrders();
  }, [user?.id, authLoading]);

  useEffect(() => { fetchRef.current = fetchOrders; });

  // COMING BACK TO THE TAB REFETCHES — the fix for a snapshot that could sit
  // unchanged for twenty hours. Both events, because they answer different
  // questions: `visibilitychange` covers a backgrounded tab, `focus` covers a
  // window that stayed visible beside another one and only lost focus.
  //
  // Three gates, in order, and all three are needed: still hidden → nothing to
  // show yet; already fetching → the two events fire together and the ref is
  // the only synchronous way to see that; fresher than a minute → the admin
  // is switching windows, not waiting on data. Nothing here polls.
  //
  // ⚠️ useAutoLogout is untouched. It suspends its idle timer while hidden on
  // purpose, and this listener does not change when a session ends — a signed
  // out admin's fetch simply returns no rows through RLS, exactly as before.
  useEffect(() => {
    const onReveal = () => {
      if (document.hidden) return;
      if (inFlightRef.current) return;
      if (Date.now() - lastSuccessRef.current < STALE_AFTER_MS) return;
      fetchRef.current();
    };
    document.addEventListener("visibilitychange", onReveal);
    window.addEventListener("focus", onReveal);
    return () => {
      document.removeEventListener("visibilitychange", onReveal);
      window.removeEventListener("focus", onReveal);
    };
  }, []);

  async function fetchOrders() {
    // Claimed BEFORE the await, so a later call supersedes this one by simply
    // being newer. No re-entry block here on purpose: the generation check is
    // what makes concurrency safe, and blocking would leave a hung request
    // able to freeze the tab in exactly the way this change is undoing.
    const gen = ++fetchGenRef.current;
    inFlightRef.current = true;
    setFetching(true);
    if (!hasLoadedOnceRef.current) setLoading(true);

    let rows: Order[];
    try {
      const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      // PostgREST reports failure in `error`; the network layer THROWS. Both
      // funnel into the catch below — the throw used to escape entirely and
      // leave `loading` stuck true with no message at all.
      if (error) throw new Error(error.message);
      rows = (data as any as Order[]) || [];
    } catch (e) {
      // Superseded: a newer fetch owns the flag and will report for itself.
      if (gen !== fetchGenRef.current) return;
      console.error("[AdminOrders] fetch error:", e);
      inFlightRef.current = false;
      setFetching(false);
      hasLoadedOnceRef.current = true;
      setLoading(false);
      // ⚠️ THE ROWS STAY, AND SO DOES „ბოლო". A failed reload used to fall
      // through to `data || []` and blank the table to „შეკვეთები (0)" while
      // stamping a fresh timestamp — one transient blip and the admin was
      // looking at an empty order list that claimed to be current. Now the
      // last good list stands and the header says the refresh failed.
      setFetchError(e instanceof Error ? e.message : "ქსელის შეცდომა");
      toast({
        title: "შეკვეთების განახლება ვერ მოხერხდა",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
      return;
    }

    // A newer fetch already applied its rows — drop these on the floor rather
    // than overwriting fresher data with older data.
    if (gen !== fetchGenRef.current) return;
    inFlightRef.current = false;
    setFetching(false);
    hasLoadedOnceRef.current = true;
    setOrders(rows);
    setLoading(false);
    setFetchError(null);
    setLastRefresh(new Date());
    lastSuccessRef.current = Date.now();

    // Auto-sync any non-paid orders that have a payment provider order id
    const unsynced = rows.filter(
      (o) => o.bog_order_id && o.payment_status !== "paid" && o.payment_status !== "refunded"
    );
    if (unsynced.length > 0) {
      const updates = await Promise.allSettled(
        unsynced.map(async (o) => {
          const fn = (o.payment_provider === "tbc" || o.payment_provider === "tbc_credit")
            ? "check-payment-flitt"
            : "check-payment";
          const { data: res } = await supabase.functions.invoke(fn, { body: { orderId: o.id } });
          return { id: o.id, res };
        })
      );
      let paidCount = 0;
      setOrders((prev) =>
        prev.map((o) => {
          const match = updates.find(
            (u) => u.status === "fulfilled" && (u.value as any)?.id === o.id
          ) as PromiseFulfilledResult<{ id: string; res: any }> | undefined;
          if (!match) return o;
          if (match.value.res?.status === "paid") {
            paidCount += 1;
            return { ...o, payment_status: "paid", status: "confirmed", paid_at: o.paid_at || new Date().toISOString() };
          }
          if (match.value.res?.status === "failed") {
            return { ...o, payment_status: "failed" };
          }
          return o;
        })
      );
      if (paidCount > 0) toast({ title: `გადახდა სინქრონიზდა ${paidCount} შეკვეთისთვის ✓` });
    }
  }

  const [checkingPayment, setCheckingPayment] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  async function regeneratePrintFile(order: Order, side: "front" | "back") {
    if (!isDesignState(order.design_state)) {
      toast({ title: "design_state არ არსებობს", variant: "destructive" });
      return;
    }
    const sideState = order.design_state[side];
    if (!sideState) {
      toast({ title: `${side === "front" ? "წინა" : "უკანა"} მხარის მონაცემები ცარიელია`, variant: "destructive" });
      return;
    }
    const key = `${order.id}:${side}`;
    setRegenerating(key);
    try {
      const blob = await compositePrintFileFromDesignState(sideState);
      if (!blob) {
        toast({ title: "ცარიელი დიზაინი — ფაილი ვერ შეიქმნა", variant: "destructive" });
        return;
      }
      const suffix = side === "front" ? "transparent" : "transparent-back";
      const path = `order-mockups/${order.id}-${suffix}.png`;
      const { publicUrl } = await uploadBlobWithRetry("designs", path, blob, { contentType: "image/png" });
      const column = side === "front" ? "transparent_image_url" : "back_transparent_image_url";
      const { error } = await supabase
        .from("orders")
        .update({ [column]: publicUrl } as any)
        .eq("id", order.id);
      if (error) throw new Error(error.message);
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, [column]: publicUrl } as Order : o)),
      );
      toast({ title: "პრინტ ფაილი დაგენერირდა ✓" });
    } catch (e: any) {
      toast({ title: "შეცდომა", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setRegenerating(null);
    }
  }

  // checkPayment runs once per group (the edge function looks the order up
  // then flips the whole cart in the DB by cart_id). `groupRows` lets us
  // mirror the result onto every unit in local state.
  async function checkPayment(head: Order, groupRows: Order[]) {
    setCheckingPayment(head.id);
    try {
      const fn = (head.payment_provider === "tbc" || head.payment_provider === "tbc_credit")
        ? "check-payment-flitt"
        : "check-payment";
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { orderId: head.id },
      });

      let payload: any = data;
      if (error) {
        console.error("[AdminOrders] check-payment invoke error:", error);
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            payload = await ctx.json();
          }
        } catch {}
        const msg = payload?.error || error.message || "Edge Function returned a non-2xx status code";
        toast({ title: "შეცდომა", description: msg, variant: "destructive" });
        return;
      }

      const ids = new Set(groupRows.map((r) => r.id));
      if (payload?.status === "paid") {
        setOrders(prev => prev.map(o => ids.has(o.id) ? { ...o, payment_status: "paid", status: "confirmed", paid_at: o.paid_at || new Date().toISOString() } : o));
        toast({ title: "გადახდა დადასტურდა ✓" });
      } else if (payload?.status === "failed") {
        setOrders(prev => prev.map(o => ids.has(o.id) ? { ...o, payment_status: "failed" } : o));
        toast({ title: "გადახდა ვერ განხორციელდა", variant: "destructive" });
      } else {
        toast({ title: "სტატუსი", description: `${payload?.bog_status || payload?.tbc_status || payload?.status || "unknown"}` });
      }
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
    }
    setCheckingPayment(null);
  }

  // Status / payment changes apply to the WHOLE group — every row of the
  // cart gets the same value via the existing admin_update_order RPC
  // (one call per row, run in parallel). Display-only grouping means the
  // units are still separate rows in the DB, so each must be updated.
  async function updateOrderGroup(rows: Order[], field: string, value: string) {
    const results = await Promise.all(
      rows.map((r) =>
        (supabase.rpc as any)("admin_update_order", {
          p_order_id: r.id,
          p_field: field,
          p_value: value,
        }),
      ),
    );
    const firstErr = results.find((r) => r.error);
    if (firstErr?.error) {
      toast({ title: "შეცდომა", description: firstErr.error.message, variant: "destructive" });
      return;
    }
    const ids = new Set(rows.map((r) => r.id));
    setOrders((prev) =>
      prev.map((o) => (ids.has(o.id) ? { ...o, [field]: value } : o)),
    );
    toast({ title: rows.length > 1 ? `განახლდა (${rows.length} ერთეული)` : "განახლდა" });
  }

  const paymentBadgeVariant = (s: string) => {
    switch (s) {
      case "paid": return "default";
      case "failed": return "destructive";
      default: return "secondary";
    }
  };

  const statusBadgeVariant = (s: string) => {
    switch (s) {
      case "delivered": return "default";
      case "cancelled": return "destructive";
      case "shipped": return "default";
      default: return "outline";
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">შეკვეთები ({groups.length})</h2>
        <div className="flex items-center gap-3">
          {/* A FAILED REFRESH SAYS SO. The rows below are the last good ones,
              and the timestamp still names when they were fetched — the two
              together say "this is stale and here is how stale", which is the
              honest reading the old silent blank could not give. */}
          {fetchError && (
            <span className="text-xs text-destructive" title={fetchError}>
              განახლება ვერ მოხერხდა
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            ბოლო: {lastRefresh ? lastRefresh.toLocaleTimeString("ka-GE") : "—"}
          </span>
          <Button variant="outline" size="sm" onClick={fetchOrders} disabled={fetching}>
            {fetching ? "განახლდება…" : "განახლება"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((group, i) => {
          const order = group.head;
          const isExpanded = expandedKey === group.key;
          return (
            <div key={group.key} className="rounded-lg border border-border bg-card overflow-hidden">
              {/* Summary row */}
              <button
                onClick={() => setExpandedKey(isExpanded ? null : group.key)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground w-8">#{groups.length - i}</span>
                {order.front_mockup_url ? (
                  <div className="w-10 h-10 rounded border border-border bg-muted overflow-hidden flex-shrink-0">
                    <img src={transformedDisplayUrl(order.front_mockup_url, { width: THUMB_W })} alt="" className="w-full h-full object-contain" loading="lazy" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded border border-border bg-muted flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {order.first_name} {order.last_name}
                    {group.quantity > 1 && (
                      <span className="text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                        × {group.quantity}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {order.product} {order.sub_product ? `• ${order.sub_product}` : ""} • {order.color || "—"}
                    {order.size ? ` • ${order.size}` : <span className="text-destructive"> • ზომა არ არის არჩეული</span>}
                  </div>
                </div>
                <div className="text-sm font-semibold">{group.groupTotal} ₾</div>
                <Badge variant={paymentBadgeVariant(order.payment_status) as any} className="text-[10px]">
                  {PAYMENT_LABELS[order.payment_status] || order.payment_status}
                </Badge>
                <Badge variant={statusBadgeVariant(order.status) as any} className="text-[10px]">
                  {STATUS_LABELS[order.status] || order.status}
                </Badge>
                <span className="text-xs text-muted-foreground hidden sm:block">{format(new Date(order.created_at), "dd.MM.yy HH:mm")}</span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-border bg-muted/30 p-4 space-y-4">
                  {/* Customer info */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">კლიენტი</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">სახელი:</span>
                        <p className="font-medium">{order.first_name} {order.last_name}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ელ.ფოსტა:</span>
                        <p className="font-medium">{order.email}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ტელეფონი:</span>
                        <p className="font-medium">{order.phone}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">მიწოდება:</span>
                        <p className="font-medium">{DELIVERY_LABELS[order.delivery_type] || order.delivery_type}</p>
                      </div>
                      {order.delivery_address && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">მისამართი:</span>
                          <p className="font-medium">{order.delivery_address}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Items — per-unit product details + design/artwork.
                      Identical units (product + sub_product + color + size +
                      front/back mockup + prompt all equal) collapse into one
                      ×count block; any difference becomes its own "ნივთი #i"
                      block so every line item shows its OWN size/brand/color/
                      price/design. Mockups, print files, regenerate and
                      originals stay per-ROW (keyed by that unit's order id). */}
                  {(() => {
                    const units = group.units;
                    const multi = units.length > 1;
                    return (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">ნივთები</h4>
                        <div className="space-y-4">
                          {units.map(({ rep: unit, count }, ui) => (
                            <div key={unit.id} className={multi ? "pt-3 border-t border-border first:border-t-0 first:pt-0" : ""}>
                              {(multi || count > 1) && (
                                <div className="flex items-center gap-2 mb-2">
                                  {multi && <p className="text-xs font-semibold">ნივთი #{ui + 1}</p>}
                                  {count > 1 && (
                                    <span className="text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded">× {count}</span>
                                  )}
                                </div>
                              )}
                              {/* Per-unit product details (type / brand / color / mode / size / price) */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                                <div>
                                  <span className="text-muted-foreground">ტიპი:</span>
                                  <p className="font-medium">{unit.product}</p>
                                </div>
                                {unit.sub_product && (
                                  <div>
                                    <span className="text-muted-foreground">ბრენდი:</span>
                                    <p className="font-medium">{unit.sub_product}</p>
                                  </div>
                                )}
                                <div>
                                  <span className="text-muted-foreground">ფერი:</span>
                                  <p className="font-medium">{unit.color || "—"}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">რეჟიმი:</span>
                                  <p className="font-medium">{unit.is_studio ? "Studio" : "Simple"}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    {unit.product === "Phone Case" ? "მოდელი:" : "ზომა:"}
                                  </span>
                                  <p className={`font-medium ${!unit.size ? "text-destructive" : ""}`}>
                                    {unit.size || "არ არის არჩეული"}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">ფასი:</span>
                                  <p className="font-medium">{count > 1 ? `${unit.product_price} ₾ × ${count}` : `${unit.product_price} ₾`}</p>
                                </div>
                              </div>
                              {/* Per-unit prompt / design text */}
                              {unit.prompt && (
                                <div className="mb-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-xs font-semibold text-muted-foreground uppercase">{unit.is_studio ? "პრომპტი" : "დიზაინის ტექსტი"}</h5>
                                    <div className="flex gap-2">
                                      {!unit.is_studio && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-xs gap-1"
                                          onClick={() => downloadTextAsPng(unit.prompt || "", `order-${unit.id}-text.png`)}
                                        >
                                          <Download className="h-3 w-3" /> ტექსტი PNG
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs gap-1"
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(unit.prompt || "");
                                            toast({ title: "დაკოპირდა" });
                                          } catch {
                                            toast({ title: "ვერ დაკოპირდა", variant: "destructive" });
                                          }
                                        }}
                                      >
                                        დაკოპირება
                                      </Button>
                                    </div>
                                  </div>
                                  <pre className="text-sm bg-background rounded-lg p-3 border border-border whitespace-pre-wrap font-sans">{unit.prompt}</pre>
                                </div>
                              )}
                              {unit.front_mockup_url || unit.back_mockup_url ? (
                                <div className="flex gap-4 flex-wrap">
                                  {unit.front_mockup_url && (
                                    <div className="space-y-1.5">
                                      <p className="text-xs text-muted-foreground">წინა მხარე</p>
                                      <div className="w-64 h-64 rounded-lg border border-border bg-background overflow-hidden">
                                        <img src={transformedDisplayUrl(unit.front_mockup_url, { width: VIEW_W })} alt="წინა მხარე" className="w-full h-full object-contain" loading="lazy" />
                                      </div>
                                      <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                        onClick={() => downloadImage(unit.front_mockup_url!, `order-${unit.id}-front.png`)}>
                                        <Download className="h-3 w-3" /> ჩამოტვირთვა
                                      </Button>
                                    </div>
                                  )}
                                  {unit.back_mockup_url && (
                                    <div className="space-y-1.5">
                                      <p className="text-xs text-muted-foreground">უკანა მხარე</p>
                                      <div className="w-64 h-64 rounded-lg border border-border bg-background overflow-hidden">
                                        <img src={transformedDisplayUrl(unit.back_mockup_url, { width: VIEW_W })} alt="უკანა მხარე" className="w-full h-full object-contain" loading="lazy" />
                                      </div>
                                      <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                        onClick={() => downloadImage(unit.back_mockup_url!, `order-${unit.id}-back.png`)}>
                                        <Download className="h-3 w-3" /> ჩამოტვირთვა
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">პრევიუ არ არის</p>
                              )}
                              {!unit.is_studio && unit.prompt && (() => {
                                const dataUrl = renderTextDataUrl(unit.prompt);
                                return dataUrl ? (
                                  <div className="mt-3 pt-3 border-t border-border">
                                    <p className="text-xs text-muted-foreground mb-1.5">სრული წარწერა (ცალკე ფაილი)</p>
                                    <div className="space-y-1.5 inline-block">
                                      <div className="w-64 h-40 rounded-lg border border-border bg-white overflow-hidden flex items-center justify-center">
                                        {/* data: URL — the helper passes it through untouched; lazy still helps */}
                                        <img src={transformedDisplayUrl(dataUrl, { width: VIEW_W })} alt="სრული წარწერა" className="max-w-full max-h-full object-contain" loading="lazy" />
                                      </div>
                                      <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                        onClick={() => downloadTextAsPng(unit.prompt || "", `order-${unit.id}-text.png`)}>
                                        <Download className="h-3 w-3" /> წარწერა PNG
                                      </Button>
                                    </div>
                                  </div>
                                ) : null;
                              })()}
                              {(unit.transparent_image_url || unit.back_transparent_image_url) && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  <p className="text-xs text-muted-foreground mb-1.5">პრინტ ფაილი (placement zone-ით cropped)</p>
                                  <div className="flex gap-4 flex-wrap">
                                    {unit.transparent_image_url && (
                                      <div className="space-y-1.5">
                                        <p className="text-xs text-muted-foreground">წინა მხარე</p>
                                        <div className="w-64 h-64 rounded-lg border border-border bg-background overflow-hidden">
                                          <img src={transformedDisplayUrl(unit.transparent_image_url, { width: VIEW_W })} alt="წინა პრინტი" className="w-full h-full object-contain" loading="lazy" />
                                        </div>
                                        <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                          onClick={() => downloadImage(unit.transparent_image_url!, `order-${unit.id}-print-front.png`)}>
                                          <Download className="h-3 w-3" /> პრინტ ფაილი
                                        </Button>
                                      </div>
                                    )}
                                    {unit.back_transparent_image_url && (
                                      <div className="space-y-1.5">
                                        <p className="text-xs text-muted-foreground">უკანა მხარე</p>
                                        <div className="w-64 h-64 rounded-lg border border-border bg-background overflow-hidden">
                                          <img src={transformedDisplayUrl(unit.back_transparent_image_url, { width: VIEW_W })} alt="უკანა პრინტი" className="w-full h-full object-contain" loading="lazy" />
                                        </div>
                                        <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                          onClick={() => downloadImage(unit.back_transparent_image_url!, `order-${unit.id}-print-back.png`)}>
                                          <Download className="h-3 w-3" /> პრინტ ფაილი
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                              {/* Regenerate print file from saved design_state.
                                  Available for orders placed after 2026-05-15
                                  (the design_state migration). Per-row. */}
                              {isDesignState(unit.design_state) && (unit.design_state.front || unit.design_state.back) && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  <p className="text-xs text-muted-foreground mb-1.5">
                                    პრინტ ფაილის გენერაცია (design_state-ით)
                                    {!unit.transparent_image_url && !unit.back_transparent_image_url && (
                                      <span className="text-destructive"> — გადახდის დროს ვერ ატვირთა</span>
                                    )}
                                  </p>
                                  <div className="flex gap-2 flex-wrap">
                                    {unit.design_state.front && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs gap-1.5"
                                        disabled={regenerating === `${unit.id}:front`}
                                        onClick={() => regeneratePrintFile(unit, "front")}
                                      >
                                        <RefreshCw className={`h-3 w-3 ${regenerating === `${unit.id}:front` ? "animate-spin" : ""}`} />
                                        {regenerating === `${unit.id}:front` ? "გენერდება..." : "წინა მხარის გადაგენერაცია"}
                                      </Button>
                                    )}
                                    {unit.design_state.back && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs gap-1.5"
                                        disabled={regenerating === `${unit.id}:back`}
                                        onClick={() => regeneratePrintFile(unit, "back")}
                                      >
                                        <RefreshCw className={`h-3 w-3 ${regenerating === `${unit.id}:back` ? "animate-spin" : ""}`} />
                                        {regenerating === `${unit.id}:back` ? "გენერდება..." : "უკანა მხარის გადაგენერაცია"}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                              {originalPhotos[unit.id] && originalPhotos[unit.id].length > 0 && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  <p className="text-xs text-muted-foreground mb-1.5">ორიგინალი ფოტოები (სრული რეზოლუცია)</p>
                                  <div className="flex gap-3 flex-wrap">
                                    {originalPhotos[unit.id].map((photo, pi) => (
                                      <div key={photo.name} className="space-y-1.5">
                                        <p className="text-xs text-muted-foreground">{photo.name.startsWith("back") ? "უკანა" : "წინა"} #{pi + 1}</p>
                                        <div className="w-40 h-40 rounded-lg border border-border bg-background overflow-hidden">
                                          <img src={transformedDisplayUrl(photo.url, { width: VIEW_W })} alt={photo.name} className="w-full h-full object-contain" loading="lazy" />
                                        </div>
                                        <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                          onClick={() => downloadImage(photo.url, `order-${unit.id}-${photo.name}`)}>
                                          <Download className="h-3 w-3" /> ორიგინალი
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Comment */}
                  {order.comment && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">კომენტარი</h4>
                      <p className="text-sm">{order.comment}</p>
                    </div>
                  )}

                  {/* Price breakdown */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">ფასი</h4>
                    <div className="text-sm space-y-1 bg-background rounded-lg p-3 border border-border max-w-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">პროდუქტი:</span>
                        <span>
                          {group.units.length === 1 && group.quantity > 1
                            ? `${order.product_price} ₾ × ${group.quantity} = ${order.product_price * group.quantity} ₾`
                            : `${group.productSubtotal} ₾`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">მიწოდება:</span>
                        <span>{group.deliveryTotal === 0 ? "უფასო" : `${group.deliveryTotal} ₾`}</span>
                      </div>
                      {/* Bag fee is folded into the first row's total_price (no
                          dedicated column), so derive it: total − products −
                          delivery. Renders only when non-zero, so pre-fee
                          orders are displayed exactly as before. */}
                      {group.groupTotal - group.productSubtotal - group.deliveryTotal > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ჩანთა:</span>
                          <span>{group.groupTotal - group.productSubtotal - group.deliveryTotal} ₾</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-1 font-bold">
                        <span>სულ:</span>
                        <span>{group.groupTotal} ₾</span>
                      </div>
                    </div>
                  </div>

                  {/* Payment provider & ID */}
                  <div className="text-xs text-muted-foreground flex items-center gap-3">
                    <span className="font-semibold uppercase">{order.payment_provider === "tbc" ? "TBC" : order.payment_provider === "tbc_credit" ? "TBC Credit" : "BOG"}</span>
                    {order.bog_order_id && (
                      <span>Order ID: <span className="font-mono">{order.bog_order_id}</span></span>
                    )}
                  </div>

                  {/* Status controls */}
                  <div className="flex gap-3 items-end flex-wrap pt-2 border-t border-border">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">გადახდა</span>
                      <Select value={order.payment_status} onValueChange={v => updateOrderGroup(group.rows, "payment_status", v)}>
                        <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_OPTIONS.map(o => <SelectItem key={o} value={o}>{PAYMENT_LABELS[o] || o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">სტატუსი</span>
                      <Select value={order.status} onValueChange={v => updateOrderGroup(group.rows, "status", v)}>
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map(o => <SelectItem key={o} value={o}>{STATUS_LABELS[o] || o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {order.payment_status !== "paid" && order.bog_order_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={checkingPayment === order.id}
                        onClick={() => checkPayment(order, group.rows)}
                      >
                        <RefreshCw className={`h-3 w-3 ${checkingPayment === order.id ? "animate-spin" : ""}`} />
                        გადახდის შემოწმება
                      </Button>
                    )}
                    {order.paid_at && (
                      <span className="text-xs text-emerald-500 self-end pb-1.5">
                        გადახდილია: {format(new Date(order.paid_at), "dd.MM.yy HH:mm")}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          შეკვეთები არ მოიძებნა
        </div>
      )}
    </div>
  );
}
