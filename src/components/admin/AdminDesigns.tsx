import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const fetchGenerations = useCallback(async (isBackground = false) => {
    if (!isBackground) setInitialLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("generations")
      .select("id, prompt, product, color, style, is_guest, user_id, session_id, created_at, transparent_image_path, mockup_image_path")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      if (!isBackground) setGenerations([]);
    } else {
      setGenerations((data as Generation[]) || []);
    }

    if (!isBackground) setInitialLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    fetchGenerations(false);
  }, [user?.id, authLoading, fetchGenerations]);

  const handleDelete = async (gen: Generation) => {
    if (!confirm("წაშალოთ ეს გენერაცია?")) return;
    setDeleting(gen.id);
    try {
      // Delete storage files if they're storage paths
      const paths: string[] = [];
      if (gen.transparent_image_path && !gen.transparent_image_path.startsWith("data:") && !gen.transparent_image_path.startsWith("http")) {
        paths.push(gen.transparent_image_path);
      }
      if (gen.mockup_image_path && !gen.mockup_image_path.startsWith("data:") && !gen.mockup_image_path.startsWith("http")) {
        paths.push(gen.mockup_image_path);
      }
      if (paths.length) await supabase.storage.from("designs").remove(paths);

      const { error } = await supabase.from("generations").delete().eq("id", gen.id);
      if (error) throw error;

      setGenerations((prev) => prev.filter((g) => g.id !== gen.id));
      toast({ title: "გენერაცია წაიშალა" });
    } catch (err: any) {
      toast({ title: "წაშლა ვერ მოხერხდა", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(null);
    }
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
          <Button variant="outline" size="sm" onClick={() => fetchGenerations(false)}>განახლება</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          გენერაციების წამოღება ვერ მოხერხდა: {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {generations.map((generation) => {
          const mockupUrl = resolveImageUrl(generation.mockup_image_path);
          const transparentUrl = resolveImageUrl(generation.transparent_image_path);
          const imgUrl = mockupUrl || transparentUrl;

          return (
            <div key={generation.id} className="rounded-lg border border-border overflow-hidden bg-card">
              <div className="aspect-square bg-muted flex items-center justify-center">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={generation.prompt || "Generated design"}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-muted-foreground text-sm">ფოტო არ არის</span>
                )}
              </div>
              <div className="p-3 space-y-1">
                <h3 className="font-medium text-sm truncate">{generation.prompt || "Untitled generation"}</h3>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{generation.product} • {generation.color}</span>
                  <span>{generation.style || "no-style"}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(generation.created_at), "dd.MM.yy HH:mm")}</span>
                  <span className="font-mono">
                    {generation.is_guest
                      ? `guest:${(generation.session_id || "-").slice(0, 8)}`
                      : `user:${(generation.user_id || "-").slice(0, 8)}`}
                  </span>
                </div>
                {/* Action buttons */}
                <div className="flex gap-1 pt-1">
                  {mockupUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 flex-1"
                      onClick={() => downloadImage(mockupUrl, `${generation.id}-mockup.png`)}
                    >
                      <Download className="h-3 w-3" /> მოკაპი
                    </Button>
                  )}
                  {transparentUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 flex-1"
                      onClick={() => downloadImage(transparentUrl, `${generation.id}-print.png`)}
                    >
                      <Download className="h-3 w-3" /> პრინტი
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs gap-1"
                    disabled={deleting === generation.id}
                    onClick={() => handleDelete(generation)}
                  >
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
