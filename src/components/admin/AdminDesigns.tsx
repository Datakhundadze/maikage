import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Generation {
  id: string;
  prompt: string | null;
  product: string;
  color: string;
  style: string | null;
  is_guest: boolean;
  user_id: string | null;
  session_id: string | null;
  created_at: string;
  transparent_image_path: string | null;
  mockup_image_path: string | null;
}

function resolveImageUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const { data } = supabase.storage.from("designs").getPublicUrl(path);
  return data.publicUrl;
}

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, "_blank");
  }
}

export default function AdminDesigns() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();
  const hasFetched = useRef(false);

  async function fetchGenerations() {
    setInitialLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const { data, error: fetchError } = await supabase
        .from("generations")
        .select("id, created_at, prompt, product, color, style, mockup_image_path, transparent_image_path, is_guest")
        .order("created_at", { ascending: false })
        .limit(30)
        .abortSignal(controller.signal);

      clearTimeout(timeout);

      if (fetchError) {
        setError(fetchError.message);
        setGenerations([]);
      } else {
        setGenerations((data as Generation[]) || []);
      }
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError" || e.message?.includes("abort")) {
        setError("მოთხოვნა დრომ ამოწურა. სცადეთ განახლება.");
      } else {
        setError(e.message || "უცნობი შეცდომა");
      }
      setGenerations([]);
    }

    setInitialLoading(false);
    setLastRefresh(new Date());
  }

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchGenerations();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("წაშალოთ ეს გენერაცია?")) return;
    setDeleting(id);

    const { error } = await supabase
      .from('generations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete error:', error);
      toast({ title: 'შეცდომა წაშლისას', variant: 'destructive' });
      setDeleting(null);
      return;
    }

    setGenerations(prev => prev.filter(d => d.id !== id));
    toast({ title: 'წაიშალა წარმატებით' });
    setDeleting(null);
  };

  if (initialLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">გენერაციები ({generations.length})</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">ბოლო: {lastRefresh.toLocaleTimeString("ka-GE")}</span>
          <Button variant="outline" size="sm" onClick={() => { hasFetched.current = false; fetchGenerations(); }}>განახლება</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          გენერაციების წამოღება ვერ მოხერხდა: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {generations.map((gen) => {
          const mockupUrl = resolveImageUrl(gen.mockup_image_path);
          const transparentUrl = resolveImageUrl(gen.transparent_image_path);
          const imgUrl = mockupUrl || transparentUrl;

          return (
            <div key={gen.id} className="rounded-lg border border-border overflow-hidden bg-card">
              {/* Image */}
              <div className="aspect-square bg-muted flex items-center justify-center">
                {imgUrl ? (
                  <img src={imgUrl} alt={gen.prompt || "Generated design"} className="w-full h-full object-contain" loading="lazy" />
                ) : (
                  <span className="text-muted-foreground text-sm">ფოტო არ არის</span>
                )}
              </div>

              {/* Details */}
              <div className="p-3 space-y-2">
                {/* Prompt */}
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-semibold">პრომპტი:</span>
                  <p className="text-sm leading-snug break-words">{gen.prompt || "პრომპტი არ არის"}</p>
                </div>

                {/* Product & Color */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">პროდუქტი: </span>
                    <span className="font-medium">{gen.product}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">ფერი: </span>
                    <span className="font-medium">{gen.color}</span>
                  </div>
                </div>

                {/* Style */}
                {gen.style && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">სტილი: </span>
                    <span className="font-medium">{gen.style}</span>
                  </div>
                )}

                {/* Date & User */}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border">
                  <span>{format(new Date(gen.created_at), "dd.MM.yyyy HH:mm")}</span>
                  <span className="font-mono">
                    {gen.is_guest
                      ? `სტუმარი:${(gen.session_id || "-").slice(0, 8)}`
                      : `მომხმარებელი:${(gen.user_id || "-").slice(0, 8)}`}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex gap-1 pt-1">
                  {mockupUrl && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
                      onClick={() => downloadImage(mockupUrl, `${gen.id}-mockup.png`)}>
                      <Download className="h-3 w-3" /> მოკაპი
                    </Button>
                  )}
                  {transparentUrl && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
                      onClick={() => downloadImage(transparentUrl, `${gen.id}-print.png`)}>
                      <Download className="h-3 w-3" /> პრინტი
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                    disabled={deleting === gen.id} onClick={() => handleDelete(gen.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {generations.length === 0 && !error && (
        <div className="text-center py-12 text-muted-foreground">
          გენერაციები არ მოიძებნა
        </div>
      )}
    </div>
  );
}
