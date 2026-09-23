import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Inbox, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  attachmentTypes,
  groupConversations,
  messagePreview,
  shortCustomerId,
  sortThread,
  type Conversation,
  type SocialChannel,
  type SocialMessageRow,
} from "@/lib/socialInbox";

// READ-ONLY mirror of Facebook Messenger + Instagram DMs (public.social_messages,
// written by the meta-webhook edge function with the service role). Admins read
// it through the "Admins can read social_messages" SELECT policy. This tab has
// no reply box, no delete, no edit: it never writes.
//
// QUERIES
//   list:   the latest LIST_LIMIT messages (for the current channel filter),
//           grouped client-side into conversations by (channel, customer_id).
//   thread: when a conversation is opened, ALL of its messages up to
//           THREAD_LIMIT, fetched separately, so a long thread is never cut
//           short by the list window.
//
// TEXT is shown exactly as stored (already PII-redacted at write time) and
// only ever as a React text node — never as HTML.
//
// REFRESH follows AdminOrders: a manual button, and a refetch when the tab
// becomes visible or focused again if the last success is older than a minute.
// Nothing polls.

const LIST_LIMIT = 500;
const THREAD_LIMIT = 1000;
const STALE_AFTER_MS = 60_000;

const COLUMNS = "id, channel, customer_id, direction, text, attachments, unsupported, sent_at";

type Filter = "all" | SocialChannel;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ყველა" },
  { id: "messenger", label: "Messenger" },
  { id: "instagram", label: "Instagram" },
];

function ChannelBadge({ channel }: { channel: SocialChannel }) {
  const isIg = channel === "instagram";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isIg ? "bg-pink-500/15 text-pink-600 dark:text-pink-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
      }`}
    >
      {isIg ? "Instagram" : "Messenger"}
    </span>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd.MM.yyyy HH:mm");
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export default function AdminSocialInbox() {
  const { user, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<SocialMessageRow[]>([]);
  // First load only: a background refresh never blanks the list.
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [thread, setThread] = useState<SocialMessageRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const fetchGenRef = useRef(0);
  const threadGenRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastSuccessRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const fetchRef = useRef<() => void>(() => {});

  const conversations = useMemo(() => groupConversations(rows), [rows]);
  const selected: Conversation | null = useMemo(
    () => conversations.find((c) => c.key === selectedKey) ?? null,
    [conversations, selectedKey],
  );

  async function fetchList() {
    const gen = ++fetchGenRef.current;
    inFlightRef.current = true;
    setFetching(true);
    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      let q = supabase
        .from("social_messages")
        .select(COLUMNS)
        .order("sent_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (filter !== "all") q = q.eq("channel", filter);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (gen !== fetchGenRef.current) return;
      setRows((data as SocialMessageRow[]) ?? []);
      setFetchError(null);
      setLastRefresh(new Date());
      lastSuccessRef.current = Date.now();
    } catch (e) {
      if (gen !== fetchGenRef.current) return;
      console.error("[AdminSocialInbox] list fetch error:", e);
      // The last good list stays; the header says the refresh failed.
      setFetchError(e instanceof Error ? e.message : "ქსელის შეცდომა");
    } finally {
      if (gen === fetchGenRef.current) {
        inFlightRef.current = false;
        setFetching(false);
        hasLoadedOnceRef.current = true;
        setLoading(false);
      }
    }
  }

  async function fetchThread(conv: Conversation) {
    const gen = ++threadGenRef.current;
    setThreadLoading(true);
    setThreadError(null);
    try {
      const { data, error } = await supabase
        .from("social_messages")
        .select(COLUMNS)
        .eq("channel", conv.channel)
        .eq("customer_id", conv.customerId)
        .order("sent_at", { ascending: true })
        .limit(THREAD_LIMIT);
      if (error) throw new Error(error.message);
      if (gen !== threadGenRef.current) return;
      setThread(sortThread((data as SocialMessageRow[]) ?? []));
    } catch (e) {
      if (gen !== threadGenRef.current) return;
      console.error("[AdminSocialInbox] thread fetch error:", e);
      setThreadError(e instanceof Error ? e.message : "ქსელის შეცდომა");
    } finally {
      if (gen === threadGenRef.current) setThreadLoading(false);
    }
  }

  // Load (and reload on filter change) once auth has settled.
  useEffect(() => {
    if (authLoading) return;
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, filter]);

  // A filter change can hide the open conversation; close it rather than show
  // a thread that is not in the list.
  useEffect(() => {
    if (selectedKey && !conversations.some((c) => c.key === selectedKey)) {
      setSelectedKey(null);
      setThread([]);
    }
  }, [conversations, selectedKey]);

  // Reload the open thread whenever the list refreshes and it changed.
  const selectedCount = selected?.count;
  const selectedLastAt = selected?.lastAt;
  useEffect(() => {
    if (selected) fetchThread(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, selectedCount, selectedLastAt]);

  useEffect(() => { fetchRef.current = fetchList; });

  // Same visibility-based refresh as AdminOrders.
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

  if (loading) return <Spinner />;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">შეტყობინებები ({conversations.length})</h2>
      <div className="flex flex-wrap items-center gap-3">
        {fetchError && (
          <span className="text-xs text-destructive" title={fetchError}>
            განახლება ვერ მოხერხდა
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          ბოლო: {lastRefresh ? lastRefresh.toLocaleTimeString("ka-GE") : "—"}
        </span>
        <Button variant="outline" size="sm" onClick={fetchList} disabled={fetching}>
          {fetching ? "განახლდება…" : "განახლება"}
        </Button>
      </div>
    </div>
  );

  const filterBar = (
    <div className="flex gap-1 rounded-lg border border-border p-1 w-fit" role="group" aria-label="არხი">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => setFilter(f.id)}
          aria-pressed={filter === f.id}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            filter === f.id ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  const list = (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-muted-foreground">
          <Inbox className="h-8 w-8 opacity-50" />
          <p className="text-sm">შეტყობინებები ჯერ არ არის</p>
          <p className="text-xs">Messenger-ისა და Instagram-ის მიმოწერა აქ გამოჩნდება, როგორც კი პირველი შეტყობინება შემოვა.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-[70vh] overflow-y-auto">
          {conversations.map((c) => {
            const active = c.key === selectedKey;
            return (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(c.key)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${active ? "bg-amber-500/10" : "hover:bg-muted/50"}`}
                >
                  <div className="flex items-center gap-2">
                    <ChannelBadge channel={c.channel} />
                    <span className="font-mono text-xs text-muted-foreground" title={c.customerId}>
                      {shortCustomerId(c.customerId)}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{fmtTime(c.lastAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                      {c.lastDirection === "out" && <span className="text-muted-foreground">თქვენ: </span>}
                      {c.lastPreview}
                    </p>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {c.count}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const threadPane = (
    <div className="rounded-lg border border-border bg-card flex flex-col min-h-[50vh] max-h-[70vh]">
      {!selected ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center text-sm text-muted-foreground">
          აირჩიეთ საუბარი მარცხნივ
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden"
              aria-label="უკან"
              onClick={() => setSelectedKey(null)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <ChannelBadge channel={selected.channel} />
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={selected.customerId}>
              {selected.customerId}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{selected.count} შეტყობინება</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {threadLoading && thread.length === 0 ? (
              <Spinner />
            ) : threadError ? (
              <p className="py-10 text-center text-sm text-destructive">საუბრის ჩატვირთვა ვერ მოხერხდა</p>
            ) : (
              thread.map((m) => {
                const out = m.direction === "out";
                const types = attachmentTypes(m.attachments);
                const text = m.text ?? "";
                return (
                  <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        out ? "bg-amber-500 text-black rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                      }`}
                    >
                      {text ? (
                        <p className="whitespace-pre-wrap break-words">{text}</p>
                      ) : types.length === 0 ? (
                        <p className="italic opacity-70">{messagePreview(m)}</p>
                      ) : null}
                      {types.length > 0 && (
                        <div className={`flex flex-wrap gap-1 ${text ? "mt-1.5" : ""}`}>
                          {types.map((t, i) => (
                            <span
                              key={`${t}-${i}`}
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                                out ? "bg-black/10" : "bg-background/60"
                              }`}
                            >
                              <Paperclip className="h-3 w-3" />
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`mt-1 text-[10px] ${out ? "text-black/60 text-right" : "text-muted-foreground"}`}>
                        {fmtTime(m.sent_at)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            მხოლოდ ნახვა — პასუხი იგზავნება Messenger-იდან / Instagram-იდან.
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {header}
      {filterBar}
      {/* Phones: list OR thread, one column pinned to the viewport width
          (minmax(0,1fr)) so a long preview truncates instead of widening the
          column. Desktop: both side by side. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className={`min-w-0 ${selected ? "hidden lg:block" : ""}`}>{list}</div>
        <div className={`min-w-0 ${selected ? "" : "hidden lg:block"}`}>{threadPane}</div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        ნაჩვენებია ბოლო {LIST_LIMIT} შეტყობინება{filter === "all" ? "" : ` (${filter === "messenger" ? "Messenger" : "Instagram"})`}.
      </p>
    </div>
  );
}
