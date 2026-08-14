import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";

// FAQ chatbot history. Sessions (newest activity first, paginated) via the
// admin_list_chat_sessions RPC; expanding a session loads its messages via
// admin_list_chat_messages. Both are SECURITY DEFINER + has_role-gated; the
// chat_logs table is deny-all (written only by the proxy's service role).
// chat_logs / the RPCs are schema-ahead-of-types → (supabase as any).

interface SessionRow {
  session_id: string;
  user_id: string | null;
  user_email: string | null;
  first_at: string;
  last_at: string;
  message_count: number;
  last_user_snippet: string | null;
}

interface MessageRow {
  role: string;
  content: string;
  lang: string | null;
  created_at: string;
  /** Object path in the PRIVATE chat-uploads bucket, or null. */
  image_path: string | null;
}

const PAGE_SIZE = 50;

// Customer photos live in the PRIVATE "chat-uploads" bucket, so unlike
// AdminGenerations — which reads the public "designs" bucket and can call
// getPublicUrl synchronously — every URL here has to be SIGNED. Signing is a
// privileged read: it succeeds only because of the admin-only SELECT policy on
// the bucket, and returns an error for anyone else. One hour is plenty for
// looking through a conversation and short enough that a copied link dies.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

async function signChatUpload(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("chat-uploads")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  // A missing object is expected and harmless: the path is written when the
  // message is logged and the upload completes in the background, so a failed
  // upload leaves a row pointing at nothing. Show the text alone, as before.
  return error ? null : (data?.signedUrl ?? null);
}

function whoLabel(s: SessionRow): string {
  return s.user_email || (s.user_id ? "—" : "სტუმარი");
}

export default function AdminChatHistory() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, MessageRow[]>>({});
  const [msgLoading, setMsgLoading] = useState(false);
  // path → signed URL, resolved once per expand and cached for the session.
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const fetchPage = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any).rpc("admin_list_chat_sessions", {
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (err) {
      setError(err.message);
      if (offset === 0) setRows([]);
    } else {
      const page = ((data as SessionRow[]) || []).map((r) => ({ ...r, message_count: Number(r.message_count) }));
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  const toggle = async (sessionId: string) => {
    if (expanded === sessionId) { setExpanded(null); return; }
    setExpanded(sessionId);
    if (!messages[sessionId]) {
      setMsgLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase as any).rpc("admin_list_chat_messages", {
        p_session_id: sessionId,
      });
      const rowsIn = (data as MessageRow[]) || [];
      if (!err) setMessages((prev) => ({ ...prev, [sessionId]: rowsIn }));
      setMsgLoading(false);

      // Sign whatever photos this conversation carries, in parallel. Failures
      // resolve to null and are simply omitted, so one missing object never
      // blocks the others or the transcript.
      const paths = rowsIn.map((m) => m.image_path).filter((p): p is string => !!p);
      if (paths.length) {
        const signed = await Promise.all(paths.map(async (p) => [p, await signChatUpload(p)] as const));
        setSignedUrls((prev) => {
          const next = { ...prev };
          for (const [p, url] of signed) if (url) next[p] = url;
          return next;
        });
      }
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
        <h2 className="text-lg font-semibold">ჩატის ისტორია ({rows.length}{hasMore ? "+" : ""})</h2>
        <Button variant="outline" size="sm" onClick={() => fetchPage(0)}>განახლება</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchPage(0)}>განახლება</Button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((s) => {
          const isOpen = expanded === s.session_id;
          const msgs = messages[s.session_id];
          return (
            <div key={s.session_id} className="rounded-lg border border-border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(s.session_id)}
                className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted/40 transition-colors"
              >
                {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{whoLabel(s)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{format(new Date(s.last_at), "dd.MM.yy HH:mm")}</span>
                  </div>
                  {s.last_user_snippet && <p className="text-xs text-muted-foreground line-clamp-2">{s.last_user_snippet}</p>}
                  <Badge variant="outline" className="text-[10px]">{s.message_count} შეტყობინება</Badge>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border p-3 space-y-2 bg-background">
                  {msgLoading && !msgs ? (
                    <div className="flex justify-center py-4">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  ) : (msgs || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">შეტყობინებები არ მოიძებნა</p>
                  ) : (
                    (msgs || []).map((m, i) => (
                      <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            m.role === "user" ? "bg-foreground text-background rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                          }`}
                        >
                          {/* Plain text only — React escapes (no dangerouslySetInnerHTML). */}
                          {m.content}
                          {/* The customer's own photo, where the "[image]"
                              marker sits in the text. Click opens the full
                              size in a new tab; the href is a signed URL that
                              expires, and rel/noopener keep the tab isolated. */}
                          {m.image_path && signedUrls[m.image_path] && (
                            <a
                              href={signedUrls[m.image_path]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 block"
                            >
                              <img
                                src={signedUrls[m.image_path]}
                                alt="ატვირთული ფოტო"
                                className="max-h-64 w-auto rounded-lg border border-border/40"
                                loading="lazy"
                              />
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && !error && (
          <div className="text-center py-12 text-muted-foreground">ჩატები არ მოიძებნა</div>
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
