import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LAST_CHECKED } from "@/lib/aiCostRates";
import {
  aggregateAiSpend,
  countConfirmedOrders,
  fetchAllPages,
  formatUsd,
  periodRange,
  queryBounds,
  shortId,
  tbilisiDay,
  TBILISI_TZ,
  type AiCallRow,
  type CallTally,
  type DayRange,
  type PaidOrderRow,
  type PeriodPreset,
  type WhoRow,
} from "@/lib/aiSpend";

// Estimated AI spend from public.ai_calls (one row per gateway call, written by
// gemini-proxy's logAiCall). READ-ONLY: three admin-RLS SELECTs and nothing
// else —
//   ai_calls  "Admins can read ai_calls"        the calls for the period
//   profiles  "Admins can read all profiles"    who a user_id is
//   orders    "Admins can read all orders"      paid orders per user
// Every read is paged with explicit .range() (fetchAllPages) so PostgREST's
// row ceiling cannot silently cut a period short. All arithmetic lives in
// src/lib/aiSpend.ts; the dollar figures are list-price estimates
// (src/lib/aiCostRates.ts), never billed amounts.

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "დღეს" },
  { id: "7d", label: "7 დღე" },
  { id: "30d", label: "30 დღე" },
  { id: "custom", label: "პერიოდი" },
];

const AI_CALL_COLUMNS = "created_at, action, model, user_id, session_id, is_guest, success";
/** Ids per .in() filter — keeps the request URL well under proxy limits. */
const ID_CHUNK = 100;

interface ProfileInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_anonymous: boolean | null;
}

const chunk = <T,>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TBILISI_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
// dd.MM.yy HH:mm, as the other admin tabs show times — but in Tbilisi time.
const formatTbilisi = (iso: string) => dateTimeFormatter.format(new Date(iso)).replace(",", "").replace(/\//g, ".");
const formatDay = (day: string) => day.split("-").reverse().join(".");

function Tally({ t, muted }: { t: CallTally | undefined; muted?: boolean }) {
  if (!t || (t.calls === 0 && t.failed === 0)) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`whitespace-nowrap ${muted ? "text-muted-foreground" : ""}`}>
      {t.calls} · {formatUsd(t.usd)}
      {t.failed > 0 && <span className="ml-1 text-[11px] text-destructive">({t.failed}✕)</span>}
    </span>
  );
}

export default function AdminAiSpend() {
  const [preset, setPreset] = useState<PeriodPreset>("7d");
  const [today, setToday] = useState(() => tbilisiDay(new Date()));
  const [custom, setCustom] = useState<DayRange>(() => periodRange("7d", tbilisiDay(new Date())));
  const [costFailed, setCostFailed] = useState(false);

  const [rows, setRows] = useState<AiCallRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [orderCounts, setOrderCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const loadId = useRef(0);

  const range = useMemo(() => periodRange(preset, today, custom), [preset, today, custom]);

  const load = useCallback(async (r: DayRange) => {
    const id = ++loadId.current;
    setLoading(true);
    setError(null);
    setSideError(null);
    try {
      const { fromIso, toIso } = queryBounds(r);
      const calls = await fetchAllPages<AiCallRow>(async (from, to) => {
        const { data, error: err, count } = await supabase
          .from("ai_calls")
          .select(AI_CALL_COLUMNS, from === 0 ? { count: "exact" } : undefined)
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (err) throw err;
        return { rows: (data ?? []) as AiCallRow[], total: count ?? null };
      });
      if (id !== loadId.current) return;

      // Who the user_ids are, and their paid orders. Secondary: a failure here
      // keeps the cost tables and shows a warning instead.
      const userIds = [...new Set(calls.rows.map((c) => c.user_id).filter((u): u is string => !!u))];
      const profileMap = new Map<string, ProfileInfo>();
      const paidRows: PaidOrderRow[] = [];
      let side: string | null = null;
      try {
        for (const ids of chunk(userIds, ID_CHUNK)) {
          const prof = await fetchAllPages<ProfileInfo>(async (from, to) => {
            const { data, error: err } = await supabase
              .from("profiles")
              .select("user_id, display_name, avatar_url, is_anonymous")
              .in("user_id", ids)
              .order("user_id", { ascending: true })
              .range(from, to);
            if (err) throw err;
            return { rows: (data ?? []) as ProfileInfo[], total: null };
          });
          prof.rows.forEach((p) => profileMap.set(p.user_id, p));

          const paid = await fetchAllPages<PaidOrderRow>(async (from, to) => {
            const { data, error: err } = await supabase
              .from("orders")
              .select("id, cart_id, user_id")
              .eq("payment_status", "paid")
              .in("user_id", ids)
              .order("id", { ascending: true })
              .range(from, to);
            if (err) throw err;
            return { rows: (data ?? []) as PaidOrderRow[], total: null };
          });
          paidRows.push(...paid.rows);
        }
      } catch (e) {
        side = e instanceof Error ? e.message : String(e);
      }
      if (id !== loadId.current) return;

      setRows(calls.rows);
      setTotal(calls.total);
      setTruncated(calls.truncated);
      setProfiles(profileMap);
      setOrderCounts(countConfirmedOrders(paidRows));
      setSideError(side);
      setLastRefresh(new Date());
    } catch (e) {
      if (id !== loadId.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotal(null);
      setTruncated(false);
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, []);

  // Keyed on the day strings, not the range object, so only a real change of
  // period triggers a load. No polling: the button below is the only refresh.
  const { fromDay, toDay } = range;
  useEffect(() => {
    load({ fromDay, toDay });
  }, [load, fromDay, toDay]);

  const refresh = () => {
    // A refresh after midnight Tbilisi moves "today" (and the presets) along;
    // when that changes the period, the effect above does the load.
    const now = tbilisiDay(new Date());
    const next = periodRange(preset, now, custom);
    setToday(now);
    if (next.fromDay === fromDay && next.toDay === toDay) load({ fromDay, toDay });
  };

  const summary = useMemo(() => aggregateAiSpend(rows, range, { costFailed }), [rows, range, costFailed]);

  const whoCell = (w: WhoRow) => {
    if (w.kind === "unknown") return <span className="font-medium">სტუმარი (უცნობი)</span>;
    if (w.kind === "session") {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">სესია</Badge>
          <span className="font-mono text-xs text-muted-foreground">{shortId(w.sessionId ?? "")}</span>
        </div>
      );
    }
    // Same identity AdminUsers shows: avatar/initial, display name or
    // "უსახელო", the სტუმარი/რეგ. badge from profiles.is_anonymous, short id.
    const p = profiles.get(w.userId ?? "");
    return (
      <div className="flex items-center gap-2">
        {p?.avatar_url ? (
          <img src={p.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
            {(p?.display_name || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium whitespace-nowrap">{p ? p.display_name || "უსახელო" : "—"}</span>
            {p && (
              <Badge variant={p.is_anonymous ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0">
                {p.is_anonymous ? "სტუმარი" : "რეგ."}
              </Badge>
            )}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">{(w.userId ?? "").slice(0, 12)}...</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">AI ხარჯი</h2>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground">ბოლო: {lastRefresh.toLocaleTimeString("ka-GE")}</span>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            განახლება
          </Button>
        </div>
      </div>

      {/* Period */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant={preset === p.id ? "default" : "outline"} onClick={() => setPreset(p.id)}>
            {p.label}
          </Button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-2"
              value={custom.fromDay}
              max={today}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, fromDay: e.target.value }))}
            />
            <span className="text-muted-foreground">—</span>
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-2"
              value={custom.toDay}
              max={today}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, toDay: e.target.value }))}
            />
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDay(range.fromDay)}{range.fromDay !== range.toDay ? ` — ${formatDay(range.toDay)}` : ""} · თბილისის დრო
        </span>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
        <p className="font-medium">დაახლოებითი ხარჯი საჯარო ტარიფით</p>
        <p className="text-xs text-muted-foreground">
          ერთი გამოძახების სავარაუდო ფასი, არა ინვოისის თანხა. ტარიფები შემოწმდა: {LAST_CHECKED}.{" "}
          {costFailed ? "წარუმატებელი გამოძახებებიც ითვლება." : "ითვლება მხოლოდ წარმატებული გამოძახებები."}
        </p>
        <label className="flex items-center gap-2 text-xs pt-1 cursor-pointer w-fit">
          <input type="checkbox" checked={costFailed} onChange={(e) => setCostFailed(e.target.checked)} />
          წარუმატებელი გამოძახებებიც ჩაითვალოს
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={refresh}>განახლება</Button>
        </div>
      )}
      {truncated && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          ჩაიტვირთა {rows.length} / {total ?? "?"} ჩანაწერი — პერიოდი ძალიან დიდია, შეამცირე.
        </div>
      )}
      {sideError && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          მომხმარებლების ან შეკვეთების ჩატვირთვა ვერ მოხერხდა: {sideError}
        </div>
      )}
      {summary.unknownModels.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
          <p className="font-medium">ტარიფი უცნობია — ეს გამოძახებები $0-ად ითვლება:</p>
          {summary.unknownModels.map((m) => (
            <p key={m.model} className="font-mono">{m.model} · {m.calls}</p>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">გამოძახებები</p>
              <p className="text-2xl font-bold">{summary.totals.calls}</p>
              <p className="text-xs text-muted-foreground">წარუმატებელი: {summary.totals.failed}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">სავარაუდო ჯამი</p>
              <p className="text-2xl font-bold">{formatUsd(summary.totals.usd)}</p>
              {summary.totals.unknownRateCalls > 0 && (
                <p className="text-xs text-amber-600">ტარიფი უცნობია: {summary.totals.unknownRateCalls}</p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">ყველაზე ძვირი ქმედება</p>
              {summary.topAction ? (
                <>
                  <p className="text-lg font-bold font-mono truncate">{summary.topAction.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {summary.topAction.calls} გამოძახება · {formatUsd(summary.topAction.usd)}
                  </p>
                </>
              ) : (
                <p className="text-lg font-bold text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {/* Table A — by day */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">დღეების მიხედვით</h3>
            <div className="rounded-lg border border-border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>დღე</TableHead>
                    {/* Total first: the action columns can outgrow the screen. */}
                    <TableHead>ჯამი</TableHead>
                    {summary.actions.map((a) => (
                      <TableHead key={a} className="font-mono text-xs whitespace-nowrap">{a}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byDay.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell className="whitespace-nowrap">{formatDay(d.day)}</TableCell>
                      <TableCell className="font-semibold"><Tally t={d} /></TableCell>
                      {summary.actions.map((a) => (
                        <TableCell key={a} className="text-sm"><Tally t={d.perAction[a]} /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Table B — by user */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">მომხმარებლების მიხედვით ({summary.byWho.length})</h3>
            <div className="rounded-lg border border-border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ვინ</TableHead>
                    <TableHead>გამოძახებები</TableHead>
                    <TableHead>სავარაუდო $</TableHead>
                    <TableHead>ქმედებები</TableHead>
                    <TableHead>პირველი</TableHead>
                    <TableHead>ბოლო</TableHead>
                    <TableHead>დადასტ. შეკვეთები</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byWho.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        ამ პერიოდში გამოძახება არ არის
                      </TableCell>
                    </TableRow>
                  )}
                  {summary.byWho.map((w) => (
                    <TableRow key={w.key}>
                      <TableCell>{whoCell(w)}</TableCell>
                      <TableCell>
                        {w.calls}
                        {w.failed > 0 && <span className="ml-1 text-[11px] text-destructive">({w.failed}✕)</span>}
                      </TableCell>
                      <TableCell className="font-semibold">{formatUsd(w.usd)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {summary.actions.filter((a) => w.perAction[a]).map((a) => (
                            <Badge key={a} variant="outline" className="font-mono text-[10px] font-normal">
                              {a} {w.perAction[a].calls} · {formatUsd(w.perAction[a].usd)}
                              {w.perAction[a].failed > 0 && ` (${w.perAction[a].failed}✕)`}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatTbilisi(w.firstAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatTbilisi(w.lastAt)}</TableCell>
                      <TableCell>
                        {w.kind === "user" ? orderCounts.get(w.userId ?? "") ?? 0 : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              დადასტურებული შეკვეთა = გადახდილი (payment_status = paid), ყველა დროის; ერთი კალათა = ერთი შეკვეთა.
              ✕ = წარუმატებელი გამოძახება.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
