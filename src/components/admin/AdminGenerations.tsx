import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ImageOff } from "lucide-react";
import { transformedDisplayUrl } from "@/lib/imageTransform";

// Full, paginated generations history attributed to the user's email. Reads via
// the admin_list_generations SECURITY DEFINER RPC (admin-gated; joins
// generations → auth.users.email + profiles.display_name and flags whether the
// user has a paid order — context for the upcoming over-15-gens-no-order block).
// `generations` / the RPC are schema-ahead-of-types, so the rpc call is cast
// (supabase as any), mirroring the MyDesignsPage / admin convention.

interface GenRow {
  id: string;
  user_id: string | null;
  created_at: string;
  product: string;
  color: string;
  style: string | null;
  prompt: string | null;
  mockup_image_path: string | null;
  is_guest: boolean;
  user_email: string | null;
  user_display_name: string | null;
  user_paid_order_count: number;
  user_gen_count: number;
}

const PAGE_SIZE = 50;

// generations thumbnails live in the public "designs" bucket; getPublicUrl is
// synchronous and needs no auth round-trip. Already-absolute paths pass through.
function thumbUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  return supabase.storage.from("designs").getPublicUrl(path).data.publicUrl;
}

function whoLabel(g: GenRow): string {
  return g.user_email || g.user_display_name || (g.is_guest || !g.user_id ? "სტუმარი" : "—");
}

export default function AdminGenerations() {
  const [rows, setRows] = useState<GenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const { toast } = useToast();

  const fetchPage = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    // RPC + table are schema-ahead-of-types → cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any).rpc("admin_list_generations", {
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (err) {
      setError(err.message);
      if (offset === 0) setRows([]);
    } else {
      const page = ((data as GenRow[]) || []).map((r) => ({
        ...r,
        user_gen_count: Number(r.user_gen_count),
        user_paid_order_count: Number(r.user_paid_order_count),
      }));
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

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
        <h2 className="text-lg font-semibold">გენერაციები ({rows.length}{hasMore ? "+" : ""})</h2>
        <Button variant="outline" size="sm" onClick={() => fetchPage(0)}>განახლება</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchPage(0)}>განახლება</Button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((g) => {
          const url = thumbUrl(g.mockup_image_path);
          return (
            <div key={g.id} className="flex gap-3 rounded-lg border border-border bg-card p-3">
              <div className="h-16 w-16 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                {url ? (
                  <img src={transformedDisplayUrl(url, { width: 128 })} alt="" className="h-full w-full object-contain" loading="lazy" />
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{whoLabel(g)}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{format(new Date(g.created_at), "dd.MM.yy HH:mm")}</span>
                </div>
                {g.prompt && <p className="text-xs text-muted-foreground line-clamp-2">{g.prompt}</p>}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] text-muted-foreground">{g.product} · {g.color}{g.style ? ` · ${g.style}` : ""}</span>
                  {!g.is_guest && g.user_id && (
                    <>
                      {/* Per-USER totals (not this generation): cumulative
                          generations + how many PAID orders the user has. */}
                      <Badge variant="outline" className="text-[10px]" title="მომხმარებლის გენერაციები სულ">{g.user_gen_count} გენ.</Badge>
                      <Badge
                        variant="outline"
                        title="მომხმარებლის გადახდილი შეკვეთები სულ"
                        className={`text-[10px] ${g.user_paid_order_count > 0 ? "text-green-600 border-green-600/30" : "text-muted-foreground"}`}
                      >
                        🛒 {g.user_paid_order_count} შეკვეთა
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && !error && (
          <div className="text-center py-12 text-muted-foreground">გენერაციები არ მოიძებნა</div>
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
