import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, Download, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SOCIAL_UPLOAD_BUCKET } from "@/lib/socialInbox";
import {
  CHANNEL_LABEL,
  isNewSketch,
  sketchCustomerLabel,
  sketchFileName,
  type BotSketchRow,
  type SocialContact,
} from "@/lib/botSketches";

// BOT SKETCHES (owner 2026-11-26): every sketch the Messenger / Instagram bot
// sent, newest first, with the customer's name (public.social_contacts, from
// Meta) so the team can find the chat in Business Suite, and the print file
// one click away. A sketch is "ახალი" until someone downloads its file (or
// marks it seen); the tab badge counts those. The only write is
// social_sketch_files.downloaded_at (admin UPDATE policy).

const PRINT_BUCKET = "designs";
const LIMIT = 300;
const POLL_MS = 60_000;

function ChannelPill({ channel }: { channel: string }) {
  const cls =
    channel === "instagram"
      ? "bg-pink-500/15 text-pink-700 dark:text-pink-400"
      : channel === "whatsapp"
        ? "bg-green-500/15 text-green-700 dark:text-green-400"
        : "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {CHANNEL_LABEL[channel] ?? channel}
    </span>
  );
}

export default function AdminBotSketches() {
  const [rows, setRows] = useState<BotSketchRow[]>([]);
  const [contacts, setContacts] = useState<Record<string, SocialContact>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error: e } = await db
      .from("social_sketch_files")
      .select("id, conversation_key, channel, kind, sketch_url, print_path, source_path, created_at, downloaded_at")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (e) {
      setError(e.message ?? "ჩატვირთვა ვერ მოხერხდა");
      setLoading(false);
      return;
    }
    const list = (data ?? []) as BotSketchRow[];
    setRows(list);
    setError(null);
    setLoading(false);
    const keys = [...new Set(list.map((r) => r.conversation_key))];
    if (keys.length > 0) {
      const { data: cs } = await db.from("social_contacts").select("conversation_key, name, username").in("conversation_key", keys);
      const map: Record<string, SocialContact> = {};
      for (const c of (cs ?? []) as SocialContact[]) map[c.conversation_key] = c;
      setContacts(map);
    }
    const paths = list.filter((r) => !r.print_path && r.source_path).map((r) => r.source_path as string);
    if (paths.length > 0) {
      const { data: urls } = await supabase.storage.from(SOCIAL_UPLOAD_BUCKET).createSignedUrls(paths, 60 * 60);
      const map: Record<string, string> = {};
      for (const u of urls ?? []) if (u.path && u.signedUrl) map[u.path] = u.signedUrl;
      setSigned(map);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const fileUrl = (r: BotSketchRow): string | undefined =>
    r.print_path
      ? supabase.storage.from(PRINT_BUCKET).getPublicUrl(r.print_path).data.publicUrl
      : r.source_path
        ? signed[r.source_path]
        : undefined;

  const markSeen = async (r: BotSketchRow) => {
    if (!isNewSketch(r)) return;
    const at = new Date().toISOString();
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, downloaded_at: at } : x)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase as any).from("social_sketch_files").update({ downloaded_at: at }).eq("id", r.id);
    if (e) {
      console.warn("[AdminBotSketches] mark downloaded failed:", e.message);
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, downloaded_at: null } : x)));
    }
  };

  const download = async (r: BotSketchRow, label: string) => {
    const url = fileUrl(r);
    if (!url) return;
    setBusyId(r.id);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext = r.print_path ? "png" : (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = sketchFileName(label, r.created_at, ext);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      window.open(url, "_blank", "noopener");
    } finally {
      setBusyId(null);
    }
    await markSeen(r);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyNew && !isNewSketch(r)) return false;
      if (!q) return true;
      return sketchCustomerLabel(r, contacts[r.conversation_key]).toLowerCase().includes(q);
    });
  }, [rows, contacts, onlyNew, query]);
  const newCount = rows.filter(isNewSketch).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">🤖 ბოტის ესკიზები</h2>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="სახელით ძებნა" className="h-9 w-48 pl-8" />
        </div>
        <Button variant={onlyNew ? "default" : "outline"} size="sm" onClick={() => setOnlyNew((v) => !v)}>
          მხოლოდ ახალი{newCount > 0 ? ` (${newCount})` : ""}
        </Button>
        <Button variant="outline" size="sm" onClick={() => load()} aria-label="განახლება">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">იტვირთება…</p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-destructive">{error}</p>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{onlyNew ? "ახალი ესკიზი არ არის" : "ესკიზები ჯერ არ არის"}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => {
            const label = sketchCustomerLabel(r, contacts[r.conversation_key]);
            const url = fileUrl(r);
            const fresh = isNewSketch(r);
            return (
              <div key={r.id} className={`flex gap-3 rounded-lg border bg-card p-3 ${fresh ? "border-primary/60" : "border-border"}`}>
                <a href={r.sketch_url} target="_blank" rel="noreferrer" title="ესკიზი" className="shrink-0">
                  <img src={r.sketch_url} alt="ესკიზი" loading="lazy" className="h-28 w-[5.5rem] rounded-md object-cover" />
                </a>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium" title={label}>{label}</p>
                    {fresh && <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">ახალი</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ChannelPill channel={r.channel} />
                    <span>{format(new Date(r.created_at), "dd.MM.yyyy HH:mm")}</span>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    {url ? (
                      <Button size="sm" onClick={() => download(r, label)} disabled={busyId === r.id}>
                        <Download className="mr-1 h-4 w-4" />
                        {r.print_path ? "საბეჭდი ფაილი" : "კლიენტის ფოტო"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.kind === "text" ? "წარწერა — ფაილი ოპერატორმა გააკეთოს" : "საბეჭდი ფაილი არ არის"}
                      </span>
                    )}
                    {fresh && !url && (
                      <Button size="sm" variant="outline" onClick={() => markSeen(r)}>
                        <Check className="mr-1 h-4 w-4" />
                        ნანახია
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
