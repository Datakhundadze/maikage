import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// Customer feedback list (newest-first, paginated). Read via direct admin-RLS
// SELECT (the "Admins can read feedback" policy), mirroring AdminCorporate.
// `feedback` is schema-ahead-of-types, so reads/writes are cast (supabase as any).

interface FeedbackRow {
  id: string;
  message: string;
  email: string | null;
  page: string | null;
  user_id: string | null;
  handled: boolean;
  created_at: string;
}

const PAGE_SIZE = 50;

export default function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const { toast } = useToast();

  const fetchPage = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (err) {
      setError(err.message);
      if (offset === 0) setRows([]);
    } else {
      const page = (data as FeedbackRow[]) || [];
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  // Optimistic handled toggle; revert on error.
  const toggleHandled = async (r: FeedbackRow) => {
    const next = !r.handled;
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, handled: next } : x)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from("feedback").update({ handled: next }).eq("id", r.id);
    if (err) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, handled: r.handled } : x)));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">შენიშვნები ({rows.length}{hasMore ? "+" : ""})</h2>
        <Button variant="outline" size="sm" onClick={() => fetchPage(0)}>განახლება</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchPage(0)}>განახლება</Button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className={`rounded-lg border border-border bg-card p-3 space-y-1.5 ${r.handled ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm whitespace-pre-wrap break-words flex-1">{r.message}</p>
              <Button
                size="sm"
                variant={r.handled ? "outline" : "default"}
                className="shrink-0"
                onClick={() => toggleHandled(r)}
              >
                {r.handled ? "დამუშავებული ✓" : "მონიშვნა"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{format(new Date(r.created_at), "dd.MM.yy HH:mm")}</span>
              {r.email && (
                <a href={`mailto:${r.email}`} className="text-primary hover:underline">{r.email}</a>
              )}
              {r.page && <Badge variant="outline" className="text-[10px]">{r.page}</Badge>}
              {r.user_id && <span title="user id">👤 {r.user_id.slice(0, 8)}</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && !error && (
          <div className="text-center py-12 text-muted-foreground">შენიშვნები არ მოიძებნა</div>
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={() => fetchPage(rows.length)} disabled={loadingMore}>
            {loadingMore ? "იტვირთება…" : "მეტის ჩვენება"}
          </Button>
        </div>
      )}
    </div>
  );
}
