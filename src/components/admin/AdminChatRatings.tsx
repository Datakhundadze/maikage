import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { summarizeRatings, type RatingRow } from "@/lib/chatRating";

// Summary of the site assistant's end-of-chat ratings, shown at the top of the
// „ჩატის ისტორია" tab. Reads public.chat_ratings directly — the table's only
// SELECT policy is has_role(admin). Schema-ahead-of-types → (supabase as any).

interface CommentRow {
  session_id: string;
  rating: number;
  comment: string;
  created_at: string;
}

const PERIODS = [7, 30] as const;
type Period = (typeof PERIODS)[number];
const LATEST_COMMENTS = 10;

export default function AdminChatRatings() {
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const [r, c] = await Promise.all([
      db.from("chat_ratings").select("rating, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
      db
        .from("chat_ratings")
        .select("session_id, rating, comment, created_at")
        .not("comment", "is", null)
        .order("created_at", { ascending: false })
        .limit(LATEST_COMMENTS),
    ]);
    const err = r?.error || c?.error;
    if (err) {
      setError(err.message || String(err));
      setRows([]);
      setComments([]);
    } else {
      setRows((r.data as RatingRow[]) || []);
      setComments(((c.data as CommentRow[]) || []).filter((x) => x.comment && x.comment.trim()));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summarizeRatings(rows, period), [rows, period]);
  const max = Math.max(1, ...summary.distribution);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3" data-testid="admin-chat-ratings">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">ჩატის შეფასებები</h3>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <Button key={p} variant={period === p ? "default" : "outline"} size="sm" className="h-7 px-2 text-xs" onClick={() => setPeriod(p)}>
              {p} დღე
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex items-center justify-between gap-2">
          <span>შეფასებები ვერ ჩაიტვირთა: {error}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void load()}>განახლება</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[110px]">
              <div className="flex items-center gap-1 text-2xl font-bold tabular-nums">
                {summary.average === null ? "—" : summary.average.toFixed(1)}
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
              </div>
              <p className="text-xs text-muted-foreground">{summary.count} შეფასება · ბოლო {period} დღე</p>
            </div>
            <div className="flex-1 min-w-[180px] space-y-1">
              {[5, 4, 3, 2, 1].map((n) => {
                const v = summary.distribution[n - 1];
                return (
                  <div key={n} className="flex items-center gap-2 text-xs" data-testid={`rating-dist-${n}`}>
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{n}★</span>
                    <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${(v / max) * 100}%` }} />
                    </div>
                    <span className="w-8 shrink-0 text-right tabular-nums">{v}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">ბოლო კომენტარები</p>
            {comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">კომენტარები ჯერ არ არის</p>
            ) : (
              comments.map((m, i) => (
                <div key={`${m.session_id}-${i}`} className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="text-amber-500">{"★".repeat(Math.max(0, Math.min(5, Number(m.rating))))}</span>
                    <span className="shrink-0">{format(new Date(m.created_at), "dd.MM.yy HH:mm")}</span>
                  </div>
                  {/* Plain text only — React escapes. */}
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{m.comment}</p>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
