import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Megaphone, Pencil, Plus, RefreshCw, Repeat, Sparkles, Trash2, Wallet,
} from "lucide-react";
import {
  actionLabel,
  costPerResult,
  currentMonth,
  fixedCostMonthlyAmount,
  fixedCostMonthlyUsd,
  formatUsd,
  formatUsdGel,
  isValidRate,
  monthBounds,
  monthLabel,
  normalizeAiRows,
  parseDecimalInput,
  shiftMonth,
  summarizeAiSpend,
  type AiSpendRow,
  type Currency,
  type FixedPeriod,
} from "@/lib/spend";
import { Target } from "lucide-react";
import { formatGel, type MonthBounds } from "@/lib/spend";
import { costPerPaid, normalizeFunnelRows, summarizeFunnel, type AdFunnelRow } from "@/lib/adFunnel";

// Admin "ხარჯები" tab — what maika.ge spends in a month (Asia/Tbilisi):
//   - AI: admin_ai_spend(p_from, p_to) RPC over ai_calls × ai_model_prices
//   - ads: marketing_spend rows entered by hand
//   - subscriptions: fixed_costs (monthly / yearly / one-off), USD or GEL
// One USD→GEL rate lives in spend_settings (single row, id = true); every sum is
// in USD and shown as "$X · Y ₾". All four tables + the RPC are admin-only and
// schema-ahead-of-types → (supabase as any), like AdminGenerations.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

interface ModelPriceRow {
  model: string;
  cost_usd_per_call: number | null;
  note: string | null;
  updated_at: string | null;
}

type Channel = "meta" | "google" | "other";

interface MarketingRow {
  id: string;
  date: string;
  channel: Channel;
  campaign: string | null;
  adset: string | null;
  amount_usd: number;
  results: number | null;
  result_type: string | null;
  note: string | null;
  created_at: string;
}

interface FixedCostRow {
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  period: FixedPeriod;
  start_on: string | null;
  end_on: string | null;
  paid_on: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
}

const CHANNEL_LABELS: Record<Channel, string> = { meta: "Meta", google: "Google", other: "სხვა" };
const PERIOD_LABELS: Record<FixedPeriod, string> = { monthly: "თვიური", yearly: "წლიური", one_off: "ერთჯერადი" };

const errMsg = (e: unknown): string =>
  e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);

const nullIfEmpty = (s: string): string | null => (s.trim() === "" ? null : s.trim());

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between gap-3">
      <span className="break-words min-w-0">{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">განახლება</Button>
      )}
    </div>
  );
}

function SummaryCard({
  title, icon: Icon, usd, rate, children,
}: {
  title: string;
  icon: typeof Wallet;
  usd: number | null;
  rate: number | null;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-bold tabular-nums">{usd == null ? "—" : formatUsd(usd)}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {usd != null && isValidRate(rate) ? `${(usd * rate).toFixed(2)} ₾` : " "}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Model price row (ai_model_prices)
// ---------------------------------------------------------------------------

function ModelPriceEditor({
  row, inTable, onSaved,
}: {
  row: ModelPriceRow;
  /** false = model seen in ai_calls but missing from ai_model_prices. */
  inTable: boolean;
  onSaved: () => void;
}) {
  const initialPrice = row.cost_usd_per_call == null ? "" : String(row.cost_usd_per_call);
  const initialNote = row.note ?? "";
  const [price, setPrice] = useState(initialPrice);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => { setPrice(initialPrice); setNote(initialNote); }, [initialPrice, initialNote]);

  const parsed = parseDecimalInput(price);
  const invalid = parsed != null && (Number.isNaN(parsed) || parsed < 0);
  const dirty = price.trim() !== initialPrice || note !== initialNote || !inTable;
  const isNull = price.trim() === "";

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    const { error } = await db()
      .from("ai_model_prices")
      .upsert(
        { model: row.model, cost_usd_per_call: parsed, note: nullIfEmpty(note), updated_at: new Date().toISOString() },
        { onConflict: "model" },
      );
    setSaving(false);
    if (error) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "ფასი შენახულია", description: row.model });
    onSaved();
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_8rem_minmax(0,1.6fr)_auto] gap-2 items-center py-2 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-xs break-all">{row.model}</div>
        {!inTable && <div className="text-[11px] text-amber-600">ცხრილში არ არის — შენახვა დაამატებს</div>}
      </div>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          inputMode="decimal"
          value={price}
          placeholder="—"
          onChange={(e) => setPrice(e.target.value)}
          aria-label={`${row.model} ფასი`}
          className={`h-8 pl-5 text-sm tabular-nums ${
            invalid ? "border-destructive" : isNull ? "border-amber-500/60 bg-amber-500/10 placeholder:text-amber-600" : ""
          }`}
        />
      </div>
      <Input
        value={note}
        placeholder="შენიშვნა"
        onChange={(e) => setNote(e.target.value)}
        className="h-8 text-sm"
      />
      <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || invalid || saving} onClick={save}>
        {saving ? "…" : "შენახვა"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketing form
// ---------------------------------------------------------------------------

interface MarketingDraft {
  id: string | null;
  date: string;
  channel: Channel;
  campaign: string;
  adset: string;
  amount_usd: string;
  results: string;
  result_type: string;
  note: string;
}

function emptyMarketing(defaultDate: string): MarketingDraft {
  return { id: null, date: defaultDate, channel: "meta", campaign: "", adset: "", amount_usd: "", results: "", result_type: "", note: "" };
}

function MarketingDialog({
  draft, onClose, onSaved,
}: {
  draft: MarketingDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<MarketingDraft | null>(draft);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  useEffect(() => setD(draft), [draft]);

  if (!d) return null;
  const set = <K extends keyof MarketingDraft>(k: K, v: MarketingDraft[K]) => setD({ ...d, [k]: v });

  const amount = parseDecimalInput(d.amount_usd);
  const results = d.results.trim() === "" ? null : Number(d.results.trim());
  const amountBad = amount == null || Number.isNaN(amount) || amount < 0;
  const resultsBad = results != null && (!Number.isInteger(results) || results < 0);
  const dateBad = !/^\d{4}-\d{2}-\d{2}$/.test(d.date);

  const save = async () => {
    if (amountBad || resultsBad || dateBad) return;
    setSaving(true);
    const payload = {
      date: d.date,
      channel: d.channel,
      campaign: nullIfEmpty(d.campaign),
      adset: nullIfEmpty(d.adset),
      amount_usd: amount,
      results,
      result_type: nullIfEmpty(d.result_type),
      note: nullIfEmpty(d.note),
    };
    const q = db().from("marketing_spend");
    const { error } = d.id ? await q.update(payload).eq("id", d.id) : await q.insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: d.id ? "ჩანაწერი განახლდა" : "ჩანაწერი დაემატა" });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.id ? "რეკლამის ხარჯის რედაქტირება" : "რეკლამის ხარჯის დამატება"}</DialogTitle>
          <DialogDescription>თანხა დოლარში ($), როგორც რეკლამის კაბინეტშია.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="ms-date">თარიღი</Label>
            <Input id="ms-date" type="date" value={d.date} onChange={(e) => set("date", e.target.value)} className={dateBad ? "border-destructive" : ""} />
          </div>
          <div className="space-y-1">
            <Label>არხი</Label>
            <Select value={d.channel} onValueChange={(v) => set("channel", v as Channel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
                  <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ms-campaign">კამპანია</Label>
            <Input id="ms-campaign" value={d.campaign} onChange={(e) => set("campaign", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ms-adset">ad set</Label>
            <Input id="ms-adset" value={d.adset} onChange={(e) => set("adset", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ms-amount">თანხა ($)</Label>
            <Input id="ms-amount" inputMode="decimal" value={d.amount_usd} onChange={(e) => set("amount_usd", e.target.value)} className={d.amount_usd && amountBad ? "border-destructive" : ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ms-results">შედეგი (რაოდ.)</Label>
            <Input id="ms-results" inputMode="numeric" value={d.results} onChange={(e) => set("results", e.target.value)} className={resultsBad ? "border-destructive" : ""} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label htmlFor="ms-rtype">შედეგის ტიპი</Label>
            <Input id="ms-rtype" placeholder="მაგ. მესიჯი, კლიკი, შეკვეთა" value={d.result_type} onChange={(e) => set("result_type", e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label htmlFor="ms-note">შენიშვნა</Label>
            <Textarea id="ms-note" rows={2} value={d.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>გაუქმება</Button>
          <Button onClick={save} disabled={saving || amountBad || resultsBad || dateBad}>{saving ? "…" : "შენახვა"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fixed cost form
// ---------------------------------------------------------------------------

interface FixedDraft {
  id: string | null;
  name: string;
  amount: string;
  currency: Currency;
  period: FixedPeriod;
  start_on: string;
  end_on: string;
  paid_on: string;
  active: boolean;
  note: string;
}

const emptyFixed = (): FixedDraft => ({
  id: null, name: "", amount: "", currency: "USD", period: "monthly", start_on: "", end_on: "", paid_on: "", active: true, note: "",
});

function FixedCostDialog({
  draft, onClose, onSaved,
}: {
  draft: FixedDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<FixedDraft | null>(draft);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  useEffect(() => setD(draft), [draft]);

  if (!d) return null;
  const set = <K extends keyof FixedDraft>(k: K, v: FixedDraft[K]) => setD({ ...d, [k]: v });

  const amount = parseDecimalInput(d.amount);
  const amountBad = amount == null || Number.isNaN(amount) || amount < 0;
  const nameBad = d.name.trim() === "";
  const paidBad = d.period === "one_off" && d.paid_on === "";
  const rangeBad = d.start_on !== "" && d.end_on !== "" && d.end_on < d.start_on;

  const save = async () => {
    if (amountBad || nameBad || paidBad || rangeBad) return;
    setSaving(true);
    const payload = {
      name: d.name.trim(),
      amount,
      currency: d.currency,
      period: d.period,
      start_on: d.start_on || null,
      end_on: d.end_on || null,
      paid_on: d.paid_on || null,
      active: d.active,
      note: nullIfEmpty(d.note),
    };
    const q = db().from("fixed_costs");
    const { error } = d.id ? await q.update(payload).eq("id", d.id) : await q.insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: d.id ? "გამოწერა განახლდა" : "გამოწერა დაემატა" });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.id ? "გამოწერის რედაქტირება" : "გამოწერის დამატება"}</DialogTitle>
          <DialogDescription>
            თვიური = სრული თანხა ყოველ თვეს · წლიური = თანხა / 12 · ერთჯერადი = მხოლოდ გადახდის თვეში.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label htmlFor="fc-name">დასახელება</Label>
            <Input id="fc-name" value={d.name} placeholder="მაგ. Lovable, Claude, დომენი" onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fc-amount">თანხა</Label>
            <Input id="fc-amount" inputMode="decimal" value={d.amount} onChange={(e) => set("amount", e.target.value)} className={d.amount && amountBad ? "border-destructive" : ""} />
          </div>
          <div className="space-y-1">
            <Label>ვალუტა</Label>
            <Select value={d.currency} onValueChange={(v) => set("currency", v as Currency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="GEL">GEL (₾)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>პერიოდი</Label>
            <Select value={d.period} onValueChange={(v) => set("period", v as FixedPeriod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIOD_LABELS) as FixedPeriod[]).map((p) => (
                  <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Switch id="fc-active" checked={d.active} onCheckedChange={(v) => set("active", v)} />
            <Label htmlFor="fc-active">აქტიური</Label>
          </div>
          {d.period === "one_off" ? (
            <div className="space-y-1 col-span-2">
              <Label htmlFor="fc-paid">გადახდის თარიღი</Label>
              <Input id="fc-paid" type="date" value={d.paid_on} onChange={(e) => set("paid_on", e.target.value)} className={paidBad ? "border-destructive" : ""} />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="fc-start">დაწყება (არასავალდ.)</Label>
                <Input id="fc-start" type="date" value={d.start_on} onChange={(e) => set("start_on", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fc-end">დასრულება (არასავალდ.)</Label>
                <Input id="fc-end" type="date" value={d.end_on} onChange={(e) => set("end_on", e.target.value)} className={rangeBad ? "border-destructive" : ""} />
              </div>
            </>
          )}
          <div className="space-y-1 col-span-2">
            <Label htmlFor="fc-note">შენიშვნა</Label>
            <Textarea id="fc-note" rows={2} value={d.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>გაუქმება</Button>
          <Button onClick={save} disabled={saving || amountBad || nameBad || paidBad || rangeBad}>{saving ? "…" : "შენახვა"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ads → orders funnel (admin_ad_funnel RPC; rules in adFunnel.ts / the SQL)
// ---------------------------------------------------------------------------

const ORGANIC_LABEL = "ორგანული / უცნობი";

function GelCell({ usd, rate }: { usd: number | null; rate: number | null }) {
  if (usd == null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <div>{formatUsd(usd)}</div>
      <div className="text-[11px] text-muted-foreground">{isValidRate(rate) ? formatGel(usd * rate) : ""}</div>
    </>
  );
}

function RevenueCell({ revenue, missing }: { revenue: number | null; missing: number }) {
  return (
    <>
      <div>{revenue == null ? <span className="text-muted-foreground">—</span> : formatGel(revenue)}</div>
      {missing > 0 && <div className="text-[10px] text-amber-600">+{missing} ფასი უცნობია</div>}
    </>
  );
}

/**
 * Mounted inside the tab's loaded block, so it refetches whenever the tab
 * reloads (month change or „განახლება") — it needs no hook into loadAll.
 * Range = the tab's month (Asia/Tbilisi days, inclusive).
 */
function AdFunnelCard({
  bounds, rate, marketingTotalUsd,
}: {
  bounds: MonthBounds;
  rate: number | null;
  /** Month's marketing_spend total, for the „not linked to an ad" note (null = unknown). */
  marketingTotalUsd: number | null;
}) {
  const [rows, setRows] = useState<AdFunnelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error } = await db().rpc("admin_ad_funnel", { p_from: bounds.firstDay, p_to: bounds.lastDay });
      if (error) { setError(error.message); setRows([]); }
      else { setError(null); setRows(normalizeFunnelRows(data)); }
    } catch (e) { setError(errMsg(e)); setRows([]); }
    setBusy(false);
  }, [bounds]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => summarizeFunnel(rows), [rows]);
  const unlinkedUsd = marketingTotalUsd == null ? null : marketingTotalUsd - totals.spendUsd;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> რეკლამები → შეკვეთები</CardTitle>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="რეკლამები → შეკვეთები: განახლება" onClick={load} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <ErrorBox message={`რეკლამები → შეკვეთები ვერ ჩაიტვირთა: ${error}`} onRetry={load} />
        ) : busy && rows.length === 0 ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">ამ თვეში ახალი მიმოწერა არ დაწყებულა</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>რეკლამა</TableHead>
                  <TableHead className="text-right">ხარჯი</TableHead>
                  <TableHead className="text-right">მიმოწერა</TableHead>
                  <TableHead className="text-right">რეკვიზიტი გაეგზავნა</TableHead>
                  <TableHead className="text-right">გადაიხადა</TableHead>
                  <TableHead className="text-right">შემოსავალი</TableHead>
                  <TableHead className="text-right">1 გადახდილ შეკვეთაზე</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.ad_id ?? "organic"} className={r.ad_id == null ? "text-muted-foreground" : ""}>
                    <TableCell className="py-2 min-w-[10rem]">
                      <div className="text-sm font-medium">{r.ad_id == null ? ORGANIC_LABEL : r.ad_name || r.ad_id}</div>
                      {r.ad_id != null && <div className="text-[11px] text-muted-foreground font-mono">{r.ad_id}</div>}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                      <GelCell usd={r.spend_usd} rate={rate} />
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{r.conversations}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{r.requisites}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{r.paid}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                      <RevenueCell revenue={r.revenue_gel} missing={r.paid_without_price} />
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                      <GelCell usd={r.ad_id == null ? null : costPerPaid(r.spend_usd, r.paid)} rate={rate} />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell className="py-2">სულ</TableCell>
                  <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                    <GelCell usd={totals.spendUsd} rate={rate} />
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{totals.conversations}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{totals.requisites}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{totals.paid}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                    <RevenueCell revenue={totals.revenueGel} missing={totals.paidWithoutPrice} />
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums whitespace-nowrap" title="რეკლამის ხარჯი ÷ რეკლამიდან გადახდილი (ორგანული არ ითვლება)">
                    <GelCell usd={totals.costPerPaidUsd} rate={rate} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        {!error && totals.paidWithoutPrice > 0 && (
          <p className="flex items-center gap-1 text-[11px] text-amber-600">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            ფასი უცნობია: {totals.paidWithoutPrice} გადახდილ შეკვეთაზე „ღირებულება … ლარი" ვერ მოიძებნა — შემოსავალში არ ითვლება
          </p>
        )}
        {!error && unlinkedUsd != null && unlinkedUsd > 0.005 && (
          <p className="flex items-center gap-1 text-[11px] text-amber-600">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            რეკლამის ხარჯიდან {formatUsdGel(unlinkedUsd, rate)} არცერთ რეკლამაზე არ არის მიბმული (ad_id ან ad set) — აქ არ ჩანს
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          მიმოწერა ითვლება პირველი შემოსული მესიჯის თარიღით და მიეწერება ბოლო რეკლამას, რომლითაც კლიენტი შემოვიდა.
          რეკვიზიტი და გადახდა — თანამშრომლის მესიჯებიდან; შემოსავალი — „ღირებულება N ლარი" (საკურიერო არ ითვლება).
          რეკლამის მიბმა 2026-10-20-დან იწყება — მანამდე ყველა მიმოწერა ორგანულია.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function AdminSpend() {
  const [ym, setYm] = useState(() => currentMonth());
  const bounds = useMemo(() => monthBounds(ym.year, ym.month), [ym]);
  const thisMonth = currentMonth();
  const isCurrent = ym.year === thisMonth.year && ym.month === thisMonth.month;

  const [loading, setLoading] = useState(true);
  const [aiRows, setAiRows] = useState<AiSpendRow[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [prices, setPrices] = useState<ModelPriceRow[]>([]);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [marketing, setMarketing] = useState<MarketingRow[]>([]);
  const [marketingError, setMarketingError] = useState<string | null>(null);
  const [fixed, setFixed] = useState<FixedCostRow[]>([]);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSaving, setRateSaving] = useState(false);

  const [marketingDraft, setMarketingDraft] = useState<MarketingDraft | null>(null);
  const [fixedDraft, setFixedDraft] = useState<FixedDraft | null>(null);
  const { toast } = useToast();

  const loadAi = useCallback(async () => {
    try {
      const { data, error } = await db().rpc("admin_ai_spend", { p_from: bounds.fromIso, p_to: bounds.toIso });
      if (error) { setAiError(error.message); setAiRows([]); return; }
      setAiError(null);
      setAiRows(normalizeAiRows(data));
    } catch (e) { setAiError(errMsg(e)); setAiRows([]); }
  }, [bounds]);

  const loadPrices = useCallback(async () => {
    try {
      const { data, error } = await db().from("ai_model_prices").select("*").order("model");
      if (error) { setPricesError(error.message); return; }
      setPricesError(null);
      setPrices(((data as ModelPriceRow[]) || []).map((p) => ({
        ...p,
        cost_usd_per_call: p.cost_usd_per_call == null ? null : Number(p.cost_usd_per_call),
      })));
    } catch (e) { setPricesError(errMsg(e)); }
  }, []);

  const loadMarketing = useCallback(async () => {
    try {
      const { data, error } = await db()
        .from("marketing_spend")
        .select("*")
        .gte("date", bounds.firstDay)
        .lt("date", bounds.nextFirstDay)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) { setMarketingError(error.message); setMarketing([]); return; }
      setMarketingError(null);
      setMarketing(((data as MarketingRow[]) || []).map((r) => ({
        ...r,
        amount_usd: Number(r.amount_usd),
        results: r.results == null ? null : Number(r.results),
      })));
    } catch (e) { setMarketingError(errMsg(e)); setMarketing([]); }
  }, [bounds]);

  const loadFixed = useCallback(async () => {
    try {
      const { data, error } = await db().from("fixed_costs").select("*").order("active", { ascending: false }).order("name");
      if (error) { setFixedError(error.message); setFixed([]); return; }
      setFixedError(null);
      setFixed(((data as FixedCostRow[]) || []).map((r) => ({ ...r, amount: Number(r.amount) })));
    } catch (e) { setFixedError(errMsg(e)); setFixed([]); }
  }, []);

  const loadRate = useCallback(async () => {
    try {
      const { data, error } = await db().from("spend_settings").select("usd_gel").eq("id", true).maybeSingle();
      if (error) { setRateError(error.message); return; }
      setRateError(null);
      const r = data?.usd_gel == null ? null : Number(data.usd_gel);
      setRate(isValidRate(r) ? r : null);
      setRateInput(r == null ? "" : String(r));
    } catch (e) { setRateError(errMsg(e)); }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadAi(), loadPrices(), loadMarketing(), loadFixed(), loadRate()]);
    setLoading(false);
  }, [loadAi, loadPrices, loadMarketing, loadFixed, loadRate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const saveRate = async () => {
    const v = parseDecimalInput(rateInput);
    if (v == null || Number.isNaN(v) || v <= 0) {
      toast({ title: "კურსი არასწორია", description: "მაგ. 2.70", variant: "destructive" });
      return;
    }
    setRateSaving(true);
    const { error } = await db()
      .from("spend_settings")
      .upsert({ id: true, usd_gel: v, updated_at: new Date().toISOString() }, { onConflict: "id" });
    setRateSaving(false);
    if (error) {
      toast({ title: "კურსის შენახვა ვერ მოხერხდა", description: error.message, variant: "destructive" });
      return;
    }
    setRate(v);
    setRateInput(String(v));
    toast({ title: "კურსი შენახულია", description: `1 USD = ${v} ₾` });
  };

  // --- derived ---------------------------------------------------------------
  const ai = useMemo(() => summarizeAiSpend(aiRows), [aiRows]);
  const marketingTotal = useMemo(() => marketing.reduce((s, r) => s + (Number.isFinite(r.amount_usd) ? r.amount_usd : 0), 0), [marketing]);
  const fixedLines = useMemo(
    () => fixed.map((c) => ({
      row: c,
      own: fixedCostMonthlyAmount(c, bounds),
      usd: fixedCostMonthlyUsd(c, bounds, rate),
    })),
    [fixed, bounds, rate],
  );
  const fixedTotal = fixedLines.reduce((s, l) => s + (l.usd ?? 0), 0);
  const fixedMissingRate = fixedLines.some((l) => l.usd == null);
  const grandTotal = ai.cost + marketingTotal + fixedTotal;

  const priceRows = useMemo(() => {
    const known = new Set(prices.map((p) => p.model));
    const extra = [...new Set(aiRows.map((r) => r.model))]
      .filter((m) => m && !known.has(m))
      .sort()
      .map((m) => ({ row: { model: m, cost_usd_per_call: null, note: null, updated_at: null } as ModelPriceRow, inTable: false }));
    return [...extra, ...prices.map((p) => ({ row: p, inTable: true }))];
  }, [prices, aiRows]);

  const maxDayCost = Math.max(0, ...ai.byDay.map((g) => g.cost));
  const maxDayCalls = Math.max(0, ...ai.byDay.map((g) => g.callsOk + g.callsFailed));

  // --- actions ---------------------------------------------------------------
  const deleteMarketing = async (r: MarketingRow) => {
    if (!window.confirm(`წავშალო ჩანაწერი (${r.date}, ${formatUsd(r.amount_usd)})?`)) return;
    const { error } = await db().from("marketing_spend").delete().eq("id", r.id);
    if (error) { toast({ title: "წაშლა ვერ მოხერხდა", description: error.message, variant: "destructive" }); return; }
    toast({ title: "ჩანაწერი წაიშალა" });
    loadMarketing();
  };

  const deleteFixed = async (c: FixedCostRow) => {
    if (!window.confirm(`წავშალო „${c.name}"? ისტორიისთვის სჯობს გამორთვა ან დასრულების თარიღი.`)) return;
    const { error } = await db().from("fixed_costs").delete().eq("id", c.id);
    if (error) { toast({ title: "წაშლა ვერ მოხერხდა", description: error.message, variant: "destructive" }); return; }
    toast({ title: "გამოწერა წაიშალა" });
    loadFixed();
  };

  const toggleFixed = async (c: FixedCostRow, active: boolean) => {
    setFixed((prev) => prev.map((x) => (x.id === c.id ? { ...x, active } : x)));
    const { error } = await db().from("fixed_costs").update({ active }).eq("id", c.id);
    if (error) {
      setFixed((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: c.active } : x)));
      toast({ title: "შენახვა ვერ მოხერხდა", description: error.message, variant: "destructive" });
    }
  };

  const defaultEntryDate = (() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
    return today >= bounds.firstDay && today <= bounds.lastDay ? today : bounds.firstDay;
  })();

  // --- render ----------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header: month + rate */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold mr-2">ხარჯები</h2>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="წინა თვე" onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium">{monthLabel(ym.year, ym.month)}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="შემდეგი თვე" disabled={isCurrent} onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isCurrent && (
            <Button variant="ghost" size="sm" onClick={() => setYm(currentMonth())}>მიმდინარე</Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="usd-gel" className="text-xs text-muted-foreground whitespace-nowrap">1 USD =</Label>
          <Input
            id="usd-gel"
            inputMode="decimal"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveRate(); }}
            className="h-8 w-20 text-sm tabular-nums"
          />
          <span className="text-xs text-muted-foreground">₾</span>
          <Button
            size="sm"
            variant="outline"
            disabled={rateSaving || rateInput.trim() === "" || rateInput.trim() === (rate == null ? "" : String(rate))}
            onClick={saveRate}
          >
            {rateSaving ? "…" : "შენახვა"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> განახლება
          </Button>
        </div>
      </div>

      {rateError && <ErrorBox message={`კურსი: ${rateError}`} onRetry={loadRate} />}
      {!rateError && !loading && rate == null && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          USD→GEL კურსი არ არის მითითებული — ლარი არ გამოჩნდება და ლარში გადახდილი გამოწერები ჯამში არ ჩაითვლება.
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard title="სულ" icon={Wallet} usd={grandTotal} rate={rate}>
              {(aiError || marketingError || fixedError) && (
                <p className="text-[11px] text-destructive">ნაწილი ვერ ჩაიტვირთა — ჯამი არასრულია</p>
              )}
            </SummaryCard>
            <SummaryCard title="AI გენერაციები" icon={Sparkles} usd={aiError ? null : ai.cost} rate={rate}>
              {!aiError && (
                <p className="text-[11px] text-muted-foreground tabular-nums">მაქს.: {formatUsdGel(ai.costMax, rate)}</p>
              )}
              {!aiError && ai.unpricedModels.length > 0 && (
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> ფასი უცნობია: {ai.unpricedModels.length} მოდელი — ჯამში არ ითვლება
                </p>
              )}
            </SummaryCard>
            <SummaryCard title="რეკლამა" icon={Megaphone} usd={marketingError ? null : marketingTotal} rate={rate}>
              {!marketingError && <p className="text-[11px] text-muted-foreground">{marketing.length} ჩანაწერი</p>}
            </SummaryCard>
            <SummaryCard title="გამოწერები" icon={Repeat} usd={fixedError ? null : fixedTotal} rate={rate}>
              {!fixedError && fixedMissingRate && (
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> ლარის ხარჯი კურსის გარეშე არ ითვლება
                </p>
              )}
            </SummaryCard>
          </div>

          {/* AI */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI გენერაციები</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {aiError ? (
                <ErrorBox message={`AI ხარჯი ვერ ჩაიტვირთა: ${aiError}`} onRetry={loadAi} />
              ) : ai.byAction.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">ამ თვეში AI გამოძახება არ ყოფილა</p>
              ) : (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>მოქმედება</TableHead>
                          <TableHead className="text-right">წარმ.</TableHead>
                          <TableHead className="text-right">შეცდ.</TableHead>
                          <TableHead className="text-right">ხარჯი</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ai.byAction.map((g) => (
                          <TableRow key={g.key}>
                            <TableCell className="py-2">
                              <div className="text-sm font-medium">{actionLabel(g.key)}</div>
                              <div className="text-[11px] text-muted-foreground font-mono break-all">
                                {g.models.join(", ")}
                              </div>
                              {g.unpricedModels.length > 0 && (
                                <Badge variant="outline" className="mt-1 text-[10px] border-amber-500/50 text-amber-600">ფასი უცნობია</Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-right tabular-nums">{g.callsOk}</TableCell>
                            <TableCell className={`py-2 text-right tabular-nums ${g.callsFailed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {g.callsFailed}
                              {g.callsFailedMaybeBilled > 0 && (
                                <div className="text-[10px] text-muted-foreground" title="შეცდომა, რომელიც შეიძლება მაინც დაგვერიცხა">
                                  ~{g.callsFailedMaybeBilled} ფას.
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                              <div>{formatUsd(g.cost)}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {isValidRate(rate) ? `${(g.cost * rate).toFixed(2)} ₾` : ""}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-semibold">
                          <TableCell className="py-2">სულ</TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{ai.callsOk}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{ai.callsFailed}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">{formatUsdGel(ai.cost, rate)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">დღეების მიხედვით</h4>
                    <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
                      {ai.byDay.map((g) => {
                        const calls = g.callsOk + g.callsFailed;
                        const pct = maxDayCost > 0 ? (g.cost / maxDayCost) * 100 : maxDayCalls > 0 ? (calls / maxDayCalls) * 100 : 0;
                        return (
                          <div key={g.key} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                            <span className="text-muted-foreground tabular-nums">{g.key.slice(5).replace("-", ".")}</span>
                            <div className="h-3 rounded bg-muted overflow-hidden">
                              <div className="h-full rounded bg-amber-500" style={{ width: `${Math.max(pct, calls > 0 ? 2 : 0)}%` }} />
                            </div>
                            <span className="tabular-nums whitespace-nowrap">
                              {formatUsd(g.cost)} <span className="text-muted-foreground">· {calls}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Model prices */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <h4 className="text-sm font-medium">მოდელების ფასები (1 გამოძახება, $)</h4>
                  <span className="text-[11px] text-muted-foreground">ფასები სავარაუდოა — შეცვლა შეგიძლია</span>
                </div>
                {pricesError ? (
                  <ErrorBox message={`ფასები ვერ ჩაიტვირთა: ${pricesError}`} onRetry={loadPrices} />
                ) : priceRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 text-center">ფასების ცხრილი ცარიელია</p>
                ) : (
                  <div>
                    {priceRows.map(({ row, inTable }) => (
                      <ModelPriceEditor
                        key={row.model}
                        row={row}
                        inTable={inTable}
                        onSaved={() => { loadPrices(); loadAi(); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Marketing */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-4 w-4" /> რეკლამა</CardTitle>
              <Button size="sm" className="gap-1" onClick={() => setMarketingDraft(emptyMarketing(defaultEntryDate))}>
                <Plus className="h-4 w-4" /> დამატება
              </Button>
            </CardHeader>
            <CardContent>
              {marketingError ? (
                <ErrorBox message={`რეკლამის ხარჯი ვერ ჩაიტვირთა: ${marketingError}`} onRetry={loadMarketing} />
              ) : marketing.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">ამ თვეში რეკლამის ხარჯი არ არის შეყვანილი</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>თარიღი</TableHead>
                        <TableHead>არხი</TableHead>
                        <TableHead>კამპანია / ad set</TableHead>
                        <TableHead className="text-right">თანხა</TableHead>
                        <TableHead className="text-right">შედეგი</TableHead>
                        <TableHead className="text-right">1 შედეგი</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {marketing.map((r) => {
                        const cpr = costPerResult(r.amount_usd, r.results);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="py-2 whitespace-nowrap tabular-nums">{r.date}</TableCell>
                            <TableCell className="py-2"><Badge variant="outline">{CHANNEL_LABELS[r.channel] ?? r.channel}</Badge></TableCell>
                            <TableCell className="py-2 min-w-[10rem]">
                              <div className="text-sm">{r.campaign || "—"}</div>
                              {r.adset && <div className="text-[11px] text-muted-foreground">{r.adset}</div>}
                              {r.note && <div className="text-[11px] text-muted-foreground italic">{r.note}</div>}
                            </TableCell>
                            <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">{formatUsdGel(r.amount_usd, rate)}</TableCell>
                            <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                              {r.results == null ? "—" : r.results}
                              {r.result_type && <span className="text-[11px] text-muted-foreground"> {r.result_type}</span>}
                            </TableCell>
                            <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">{cpr == null ? "—" : formatUsdGel(cpr, rate)}</TableCell>
                            <TableCell className="py-2 text-right whitespace-nowrap">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7" aria-label="რედაქტირება"
                                onClick={() => setMarketingDraft({
                                  id: r.id,
                                  date: r.date,
                                  channel: r.channel,
                                  campaign: r.campaign ?? "",
                                  adset: r.adset ?? "",
                                  amount_usd: String(r.amount_usd),
                                  results: r.results == null ? "" : String(r.results),
                                  result_type: r.result_type ?? "",
                                  note: r.note ?? "",
                                })}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="წაშლა" onClick={() => deleteMarketing(r)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold">
                        <TableCell className="py-2" colSpan={3}>სულ</TableCell>
                        <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">{formatUsdGel(marketingTotal, rate)}</TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ads → orders funnel */}
          <AdFunnelCard bounds={bounds} rate={rate} marketingTotalUsd={marketingError ? null : marketingTotal} />

          {/* Fixed costs */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2"><Repeat className="h-4 w-4" /> გამოწერები</CardTitle>
              <Button size="sm" className="gap-1" onClick={() => setFixedDraft(emptyFixed())}>
                <Plus className="h-4 w-4" /> დამატება
              </Button>
            </CardHeader>
            <CardContent>
              {fixedError ? (
                <ErrorBox message={`გამოწერები ვერ ჩაიტვირთა: ${fixedError}`} onRetry={loadFixed} />
              ) : fixed.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">გამოწერები ჯერ არ არის დამატებული</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>აქტ.</TableHead>
                        <TableHead>დასახელება</TableHead>
                        <TableHead className="text-right">თანხა</TableHead>
                        <TableHead>პერიოდი</TableHead>
                        <TableHead className="text-right">{monthLabel(ym.year, ym.month)}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fixedLines.map(({ row: c, own, usd }) => (
                        <TableRow key={c.id} className={c.active ? "" : "opacity-60"}>
                          <TableCell className="py-2">
                            <Switch checked={c.active} onCheckedChange={(v) => toggleFixed(c, v)} aria-label={`${c.name} აქტიური`} />
                          </TableCell>
                          <TableCell className="py-2 min-w-[9rem]">
                            <div className="text-sm font-medium">{c.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {c.period === "one_off"
                                ? c.paid_on ? `გადახდა: ${c.paid_on}` : "გადახდის თარიღი არ არის"
                                : [c.start_on && `${c.start_on}-დან`, c.end_on && `${c.end_on}-მდე`].filter(Boolean).join(" ")}
                            </div>
                            {c.note && <div className="text-[11px] text-muted-foreground italic">{c.note}</div>}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                            {c.currency === "USD" ? formatUsd(c.amount) : `${c.amount.toFixed(2)} ₾`}
                          </TableCell>
                          <TableCell className="py-2 whitespace-nowrap">{PERIOD_LABELS[c.period] ?? c.period}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                            {own === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : usd == null ? (
                              <span className="text-amber-600">{own.toFixed(2)} ₾ (კურსი?)</span>
                            ) : (
                              formatUsdGel(usd, rate)
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-right whitespace-nowrap">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7" aria-label="რედაქტირება"
                              onClick={() => setFixedDraft({
                                id: c.id,
                                name: c.name,
                                amount: String(c.amount),
                                currency: c.currency,
                                period: c.period,
                                start_on: c.start_on ?? "",
                                end_on: c.end_on ?? "",
                                paid_on: c.paid_on ?? "",
                                active: c.active,
                                note: c.note ?? "",
                              })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="წაშლა" onClick={() => deleteFixed(c)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold">
                        <TableCell className="py-2" colSpan={4}>სულ ამ თვეში</TableCell>
                        <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">{formatUsdGel(fixedTotal, rate)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {marketingDraft && (
        <MarketingDialog
          draft={marketingDraft}
          onClose={() => setMarketingDraft(null)}
          onSaved={() => { setMarketingDraft(null); loadMarketing(); }}
        />
      )}
      {fixedDraft && (
        <FixedCostDialog
          draft={fixedDraft}
          onClose={() => setFixedDraft(null)}
          onSaved={() => { setFixedDraft(null); loadFixed(); }}
        />
      )}
    </div>
  );
}
