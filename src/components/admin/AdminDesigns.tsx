import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

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

export default function AdminDesigns() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) {
      console.log("[AdminDesigns] Waiting for auth to load...");
      return;
    }
    fetchGenerations();
  }, [user?.id, authLoading]);

  async function fetchGenerations() {
    setLoading(true);
    setError(null);

    console.log("[AdminDesigns] Fetch start", {
      userId: user?.id ?? null,
      authLoading,
    });

    if (user?.id) {
      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      console.log("[AdminDesigns] Admin role lookup", {
        userId: user.id,
        roleData,
        roleError,
      });
    } else {
      console.warn("[AdminDesigns] No authenticated user found while fetching generations");
    }

    const { data, error: fetchError } = await supabase
      .from("generations")
      .select("id, prompt, product, color, style, is_guest, user_id, session_id, created_at, transparent_image_path, mockup_image_path")
      .order("created_at", { ascending: false });

    console.log("[AdminDesigns] generations query result", {
      count: data?.length ?? 0,
      sample: data?.[0]
        ? {
            id: data[0].id,
            created_at: data[0].created_at,
            product: data[0].product,
            color: data[0].color,
            hasMockup: !!data[0].mockup_image_path,
            hasTransparent: !!data[0].transparent_image_path,
          }
        : null,
      error: fetchError,
    });

    if (fetchError) {
      console.error("[AdminDesigns] generations fetch error:", fetchError);
      setError(fetchError.message);
      setGenerations([]);
    } else {
      setGenerations((data as Generation[]) || []);
    }

    setLoading(false);
  }

  if (loading) {
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
        <Button variant="outline" size="sm" onClick={fetchGenerations}>განახლება</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          გენერაციების წამოღება ვერ მოხერხდა: {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {generations.map((generation) => {
          const imgUrl =
            resolveImageUrl(generation.mockup_image_path) ||
            resolveImageUrl(generation.transparent_image_path);

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
                  <span>{format(new Date(generation.created_at), "dd.MM.yy")}</span>
                  <span className="font-mono">
                    {generation.is_guest
                      ? `guest:${(generation.session_id || "-").slice(0, 8)}`
                      : `user:${(generation.user_id || "-").slice(0, 8)}`}
                  </span>
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
