import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { SHOWROOM_ORDER_MARK } from "@/lib/attribution";
import { FUNNEL_STEPS, funnelBy, shareOfOpen, sourceLabel, type FunnelRow, type StepCounts } from "@/lib/tour/showroomFunnel";

// The virtual showroom's funnel (showroomStats.ts → public.showroom_events,
// counted by admin_showroom_funnel) and the orders that carry the showroom
// mark in order_attribution. Neither is in the generated types (manual
// migrations), hence the untyped client.
const db = supabase as unknown as SupabaseClient;

interface ShowroomOrder {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  product: string;
  sub_product: string | null;
  total_price: number;
  payment_status: string;
}

const PERIODS = [7, 14, 30] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("ka-GE", { day: "2-digit", month: "2-digit" });

function Table({ head, rows, total }: { head: string; rows: { key: string; counts: StepCounts }[]; total?: StepCounts }) {
  const line = (key: string, c: StepCounts, strong = false) => (
    <tr key={key} className={strong ? "border-t border-border font-semibold" : "border-t border-border/50"}>
      <td className="whitespace-nowrap py-1.5 pr-3 text-left">{key}</td>
      {FUNNEL_STEPS.map(({ step }) => (
        <td key={step} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
          {c[step] ?? 0}
          {shareOfOpen(c, step) && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{shareOfOpen(c, step)}</span>}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1.5 pr-3 text-left font-medium">{head}</th>
            {FUNNEL_STEPS.map(({ step, label }) => (
              <th key={step} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => line(r.key, r.counts))}
          {total && line("სულ", total, true)}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminShowroomStats() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(14);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [orders, setOrders] = useState<ShowroomOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [funnel, marked] = await Promise.all([
        db.rpc("admin_showroom_funnel", { p_days: days }),
        db.from("order_attribution").select("order_id").ilike("lt_landing_page", `%${SHOWROOM_ORDER_MARK}%`).gte("created_at", since).limit(500),
      ]);
      if (funnel.error) throw new Error(funnel.error.message);
      setRows((funnel.data ?? []) as FunnelRow[]);
      const ids = ((marked.data ?? []) as { order_id: string }[]).map((r) => r.order_id);
      if (ids.length) {
        const o = await supabase
          .from("orders")
          .select("id, created_at, first_name, last_name, product, sub_product, total_price, payment_status")
          .in("id", ids)
          .order("created_at", { ascending: false });
        setOrders((o.data ?? []) as ShowroomOrder[]);
      } else setOrders([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);

  const bySource = funnelBy(rows, (r) => sourceLabel(r.source, r.medium));
  bySource.groups.sort((a, b) => (b.counts.open ?? 0) - (a.counts.open ?? 0));
  const byDay = funnelBy(rows, (r) => r.day);
  byDay.groups.sort((a, b) => b.key.localeCompare(a.key));
  const paid = orders.filter((o) => o.payment_status === "paid");

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">ვირტუალური შოურუმი — სტატისტიკა</h2>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <Button key={p} size="sm" variant={p === days ? "default" : "outline"} onClick={() => setDays(p)}>
              {p} დღე
            </Button>
          ))}
          <Button size="icon" variant="ghost" className="h-8 w-8" title="განახლება" onClick={() => void load()}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">ვერ ჩაიტვირთა: {error}</p>}
      {!error && rows.length === 0 && !loading && <p className="text-sm text-muted-foreground">ამ პერიოდში ჩანაწერი არ არის.</p>}
      {rows.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            რიცხვი = უნიკალური ვიზიტი (ერთი ჩანართი). პროცენტი = გვერდის გამხსნელთა წილი. „გვერდი გახსნა" ბოტებსაც ითვლის — რეალური სტუმარი „კარში შევიდა"-დან იწყება.
          </p>
          <Table head="წყარო" rows={bySource.groups} total={bySource.total} />
          <Table head="დღე" rows={byDay.groups.map((g) => ({ ...g, key: day(g.key) }))} />
        </>
      )}
      <div>
        <h3 className="mb-1 text-sm font-semibold">
          შეკვეთები შოურუმიდან: {orders.length} (გადახდილი {paid.length}, ₾{paid.reduce((s, o) => s + Number(o.total_price || 0), 0).toFixed(2)})
        </h3>
        {orders.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border/50">
                    <td className="whitespace-nowrap py-1.5 pr-3">{new Date(o.created_at).toLocaleString("ka-GE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-1.5 pr-3">{o.first_name} {o.last_name}</td>
                    <td className="py-1.5 pr-3">{o.sub_product || o.product}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">₾{Number(o.total_price).toFixed(2)}</td>
                    <td className="whitespace-nowrap py-1.5">{o.payment_status === "paid" ? "გადახდილი" : o.payment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
