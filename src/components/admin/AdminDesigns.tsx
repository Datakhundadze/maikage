import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Trash2, RefreshCw } from "lucide-react";
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

// Image resolver — bucket "designs" is public, so use getPublicUrl (no auth call needed).
// Falls back to a signed URL in case the public flag was not applied yet.
async function resolveImageUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  // Primary: public URL (instant, no network call, works for public bucket)
  const { data: pub } = supabase.storage.from("designs").getPublicUrl(path);
  if (pub?.publicUrl) return pub.publicUrl;
  // Fallback: signed URL (requires SELECT policy, works for private buckets)
  const { data, error } = await supabase.storage.from("designs").createSignedUrl(path, 3600);
  if (!error && data?.signedUrl) return data.signedUrl;
  return null;
}

// Lazy image card that resolves its URL asynchronously
function GenerationCard({
  gen,
  onDelete,
  deleting,
}: {
  gen: Generation;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [transparentUrl, setTransparentUrl] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    resolveImageUrl(gen.mockup_image_path).then(setMockupUrl);
    resolveImageUrl(gen.transparent_image_path).then(setTransparentUrl);
  }, [gen.mockup_image_path, gen.transparent_image_path]);

  const imgUrl = mockupUrl || transparentUrl;

  const download = async (url: string, filename: string) => {
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
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card">
      {/* Image */}
      <div className="aspect-square bg-muted flex items-center justify-center relative">
        {imgUrl ? (
          <>
            {!imgLoaded && !imgError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            <img
              src={imgUrl}
              alt={gen.prompt || "Generated design"}
              className={`w-full h-full object-contain transition-opacity ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => { setImgError(true); setImgLoaded(true); }}
            />
            {imgError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                <span className="text-muted-foreground text-xs">სურათი ვერ ჩაიტვირთა</span>
                <span className="text-[10px] text-muted-foreground font-mono break-all px-2 text-center">
                  {gen.mockup_image_path || gen.transparent_image_path || "—"}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="text-muted-foreground text-sm">ფოტო არ არის</span>
            {(gen.mockup_image_path || gen.transparent_image_path) && (
              <span className="text-[10px] text-muted-foreground font-mono px-2 text-center">
                path: {gen.mockup_image_path || gen.transparent_image_path}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-3 space-y-2">
        <div>
          <span className="text-[10px] uppercase text-muted-foreground font-semibold">პრომპტი:</span>
          <p className="text-sm leading-snug break-words text-muted-foreground italic">
            {gen.prompt || "(პრომპტი არ შენახულა — Gemini-ს ტექსტური პასუხი ცარიელია)"}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <div><span className="text-muted-foreground">პროდუქტი: </span><span className="font-medium">{gen.product}</span></div>
          <div><span className="text-muted-foreground">ფერი: </span><span className="font-medium">{gen.color}</span></div>
          {gen.style && <div><span className="text-muted-foreground">სტილი: </span><span className="font-medium">{gen.style}</span></div>}
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border">
          <span>{format(new Date(gen.created_at), "dd.MM.yyyy HH:mm")}</span>
          <span className="font-mono">
            {gen.is_guest
              ? `სტუმარი:${(gen.session_id || "-").slice(0, 8)}`
              : `მომხ:${(gen.user_id || "-").slice(0, 8)}`}
          </span>
        </div>
        <div className="flex gap-1 pt-1">
          {mockupUrl && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
              onClick={() => download(mockupUrl, `${gen.id}-mockup.png`)}>
              <Download className="h-3 w-3" /> მოკაპი
            </Button>
          )}
          {transparentUrl && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
              onClick={() => download(transparentUrl, `${gen.id}-print.png`)}>
              <Download className="h-3 w-3" /> პრინტი
            </Button>
          )}
          <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
            disabled={deleting} onClick={() => onDelete(gen.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminDesigns() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [slowLoad, setSlowLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchGenerations = useCallback(async () => {
    setLoading(true);
    setSlowLoad(false);
    setError(null);

    // Show "waking up DB" message after 4 seconds (Supabase free tier cold start)
    const slowTimer = setTimeout(() => setSlowLoad(true), 4000);

    try {
      const { data, error: fetchError } = await supabase
        .from("generations")
        .select("id, created_at, prompt, product, color, style, mockup_image_path, transparent_image_path, is_guest, user_id, session_id")
        .order("created_at", { ascending: false })
        .limit(50);

      if (fetchError) {
        setError(`${fetchError.code}: ${fetchError.message}`);
        setGenerations([]);
      } else {
        setGenerations((data as Generation[]) || []);
      }
    } catch (e: any) {
      setError(e.message || "უცნობი შეცდომა");
      setGenerations([]);
    } finally {
      clearTimeout(slowTimer);
      setLoading(false);
      setSlowLoad(false);
    }
  }, []);

  useEffect(() => {
    fetchGenerations();
  }, [fetchGenerations]);

  const handleDelete = async (id: string) => {
    if (!confirm("წაშალოთ ეს გენერაცია?")) return;
    setDeleting(id);
    const { error } = await supabase.from("generations").delete().eq("id", id);
    if (error) {
      toast({ title: "შეცდომა წაშლისას", description: error.message, variant: "destructive" });
    } else {
      setGenerations(prev => prev.filter(d => d.id !== id));
      toast({ title: "წაიშალა წარმატებით" });
    }
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        {slowLoad && (
          <p className="text-sm text-muted-foreground animate-pulse">
            მონაცემთა ბაზა იღვიძებს... (Supabase free tier cold start)
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">გენერაციები ({generations.length})</h2>
        <Button variant="outline" size="sm" onClick={fetchGenerations} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> განახლება
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-2">
          <p className="font-medium">შეცდომა: {error}</p>
          <Button variant="outline" size="sm" onClick={fetchGenerations}>კვლავ ცდა</Button>
        </div>
      )}

      {generations.length === 0 && !error && (
        <div className="rounded-lg border border-border p-6 text-center space-y-1">
          <p className="text-muted-foreground">გენერაციები არ მოიძებნა</p>
          <p className="text-xs text-muted-foreground">ცხრილი ცარიელია ან RLS policy ბლოკავს</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {generations.map((gen) => (
          <GenerationCard
            key={gen.id}
            gen={gen}
            onDelete={handleDelete}
            deleting={deleting === gen.id}
          />
        ))}
      </div>
    </div>
  );
}
