import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { Phone, MessageCircle } from "lucide-react";
import {
  CALLBACK_STATUS_LABELS,
  CALLBACK_STATUS_ORDER,
  type CallbackStatus,
  chatSessionHref,
  displayPhone,
} from "@/lib/callbacks";

// Callback requests left in the FAQ chat (§9d). Newest first, paginated, read
// and updated through admin-only RLS on public.callback_requests — the same
// direct-SELECT pattern as AdminFeedback. Rows are inserted only by gemini-proxy
// (service role); this tab never creates or deletes them, and a pg_cron job
// purges rows older than 90 days.
// callback_requests is schema-ahead-of-types → (supabase as any).

interface CallbackRow {
  id: string;
  created_at: string;
  phone: string;
  session_id: string | null;
  user_id: string | null;
  lang: string | null;
  /** Last customer message, PII-masked like chat_logs. */
  note: string | null;
  status: CallbackStatus;
  handled_at: string | null;
  handled_by: string | null;
  email_sent_at: string | null;
  email_error: string | null;
}

const PAGE_SIZE = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callbackTable = () => (supabase as any).from("callback_requests");

export default function AdminCallbacks() {
  const [rows, setRows] = useState<CallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const fetchPage = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    const { data, error: err } = await callbackTable()
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (err) {
      setError(err.message);
      if (offset === 0) setRows([]);
    } else {
      const page = (data as CallbackRow[]) || [];
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  // Optimistic status change; revert on error. Records who handled it and when.
  const setStatus = async (r: CallbackRow, status: CallbackStatus) => {
    if (status === r.status) return;
    const fields = {
      status,
      handled_at: status === "new" ? null : new Date().toISOString(),
      handled_by: status === "new" ? null : (user?.id ?? null),
    };
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...fields } : x)));
    const { error: err } = await callbackTable().update(fields).eq("id", r.id);
    if (err) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      setRows((prev) => prev.map((x) => (x.id === r.id ? r : x)));
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
        <h2 className="text-lg font-semibold">დარეკვის მოთხოვნები ({rows.length}{hasMore ? "+" : ""})</h2>
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
          <div
            key={r.id}
            className={`rounded-lg border border-border bg-card p-3 space-y-1.5 ${r.status === "done" ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <a
                href={`tel:${r.phone}`}
                className="inline-flex items-center gap-1.5 text-base font-semibold text-primary hover:underline"
              >
                <Phone className="h-4 w-4" />
                {displayPhone(r.phone)}
              </a>
              <select
                aria-label="სტატუსი"
                value={r.status}
                onChange={(e) => setStatus(r, e.target.value as CallbackStatus)}
                className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-sm"
              >
                {CALLBACK_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{CALLBACK_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            {/* Plain text only — React escapes. Masked like chat_logs. */}
            {r.note && <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">{r.note}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{format(new Date(r.created_at), "dd.MM.yy HH:mm")}</span>
              {r.lang && <Badge variant="outline" className="text-[10px]">{r.lang}</Badge>}
              {r.session_id && (
                <a
                  href={chatSessionHref(r.session_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <MessageCircle className="h-3 w-3" />
                  ჩატის ნახვა
                </a>
              )}
              {r.email_error ? (
                <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive" title={r.email_error}>
                  მეილი ვერ გაიგზავნა
                </Badge>
              ) : r.email_sent_at ? (
                <span title={r.email_sent_at}>✉️ მეილი გაიგზავნა</span>
              ) : null}
              {r.handled_at && <span>დამუშავდა: {format(new Date(r.handled_at), "dd.MM.yy HH:mm")}</span>}
              {r.user_id && <span title="user id">👤 {r.user_id.slice(0, 8)}</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && !error && (
          <div className="text-center py-12 text-muted-foreground">დარეკვის მოთხოვნები არ მოიძებნა</div>
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
