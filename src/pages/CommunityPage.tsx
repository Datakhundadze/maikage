import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Heart, Eye } from "lucide-react";
import Lightbox from "@/components/Lightbox";

interface CommunityDesign {
  id: string;
  title: string;
  product: string;
  color: string;
  mockup_image_path: string | null;
  likes_count: number;
  created_at: string;
  user_id: string;
}

export default function CommunityPage() {
  const { user } = useAuth();
  const { lang } = useAppState();
  const { toggleLike, getPublicUrl } = useDesignStorage();
  const [designs, setDesigns] = useState<CommunityDesign[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const fetchDesigns = useCallback(async () => {
    const { data } = await supabase
      .from("designs")
      .select("id, title, product, color, mockup_image_path, likes_count, created_at, user_id")
      .eq("is_published", true)
      .order("created_at", { ascending: false });
    setDesigns((data as CommunityDesign[]) || []);
    setLoading(false);
  }, []);

  const fetchLikes = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("design_likes")
      .select("design_id")
      .eq("user_id", user.id);
    setLikedIds(new Set((data || []).map((d: any) => d.design_id)));
  }, [user]);

  useEffect(() => { fetchDesigns(); fetchLikes(); }, [fetchDesigns, fetchLikes]);

  useEffect(() => {
    const channel = supabase
      .channel("community-designs")
      .on("postgres_changes", { event: "*", schema: "public", table: "designs", filter: "is_published=eq.true" }, () => {
        fetchDesigns();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDesigns]);

  const handleLike = async (d: CommunityDesign) => {
    const isLiked = likedIds.has(d.id);
    const ok = await toggleLike(d.id, isLiked);
    if (ok) {
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (isLiked) next.delete(d.id); else next.add(d.id);
        return next;
      });
      setDesigns((prev) => prev.map((x) =>
        x.id === d.id ? { ...x, likes_count: x.likes_count + (isLiked ? -1 : 1) } : x
      ));
    }
  };

  return (
    <>
      <AppLayout
        sidebar={
          <div className="space-y-4">
            <h2 className="text-lg font-bold">{t(lang, "community.title")}</h2>
            <p className="text-sm text-muted-foreground">{t(lang, "community.subtitle")}</p>
          </div>
        }
        main={
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : designs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <p className="text-lg">{t(lang, "community.empty")}</p>
                <p className="text-sm">{t(lang, "community.emptyHint")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {designs.map((d) => {
                  const isLiked = likedIds.has(d.id);
                  return (
                    <div key={d.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
                      <div className="relative aspect-square bg-muted">
                        {d.mockup_image_path && (
                          <img
                            src={getPublicUrl(d.mockup_image_path)}
                            alt={d.title}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button size="sm" variant="secondary" onClick={() => d.mockup_image_path && setLightboxSrc(getPublicUrl(d.mockup_image_path))}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium truncate">{d.title}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">{d.product} · {d.color}</span>
                          <button
                            onClick={() => handleLike(d)}
                            className={`flex items-center gap-1 text-xs transition-colors ${
                              isLiked ? "text-destructive" : "text-muted-foreground hover:text-destructive"
                            }`}
                          >
                            <Heart className={`h-3.5 w-3.5 ${isLiked ? "fill-current" : ""}`} />
                            {d.likes_count}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        }
      />
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}
