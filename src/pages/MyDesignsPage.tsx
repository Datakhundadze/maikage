import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { getGuestSessionId } from "@/lib/guestSession";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Trash2, Globe, GlobeLock, Eye } from "lucide-react";
import Lightbox from "@/components/Lightbox";

interface Design {
  id: string;
  title: string;
  prompt: string | null;
  product: string;
  color: string;
  mockup_image_path: string | null;
  transparent_image_path: string | null;
  is_published: boolean;
  likes_count: number;
  created_at: string;
}

interface Generation {
  id: string;
  prompt: string | null;
  product: string;
  color: string;
  mockup_image_path: string | null;
  transparent_image_path: string | null;
  created_at: string;
}

function resolveImageUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const { data } = supabase.storage.from("designs").getPublicUrl(path);
  return data.publicUrl;
}

export default function MyDesignsPage() {
  const { user } = useAuth();
  const { lang } = useAppState();
  const { deleteDesign, togglePublish } = useDesignStorage();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [guestGenerations, setGuestGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const fetchDesigns = useCallback(async () => {
    setLoading(true);

    if (user) {
      // Logged-in users: only show designs table (auto-saved on generation)
      const { data } = await supabase
        .from("designs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setDesigns((data as Design[]) || []);
      setGuestGenerations([]);
    } else {
      // Guest users: show generations by session
      setDesigns([]);
      const sessionId = getGuestSessionId();
      const { data: genData } = await supabase
        .from("generations")
        .select("id, prompt, product, color, mockup_image_path, transparent_image_path, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      setGuestGenerations((genData as Generation[]) || []);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { fetchDesigns(); }, [fetchDesigns]);

  const handleDelete = async (d: Design) => {
    if (!confirm(t(lang, "myDesigns.deleteConfirm"))) return;
    const ok = await deleteDesign(d.id, d.transparent_image_path, d.mockup_image_path);
    if (ok) setDesigns((prev) => prev.filter((x) => x.id !== d.id));
  };

  const handleTogglePublish = async (d: Design) => {
    const ok = await togglePublish(d.id, d.is_published);
    if (ok) setDesigns((prev) => prev.map((x) => x.id === d.id ? { ...x, is_published: !x.is_published } : x));
  };

  const totalCount = designs.length + guestGenerations.length;

  return (
    <>
      <AppLayout
        sidebar={
          <div className="space-y-4">
            <h2 className="text-lg font-bold">{t(lang, "myDesigns.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t(lang, "myDesigns.count", totalCount)}
            </p>
          </div>
        }
        main={
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : totalCount === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <p className="text-lg">{t(lang, "myDesigns.empty")}</p>
                <p className="text-sm">{t(lang, "myDesigns.emptyHint")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Saved designs (with full controls) */}
                {designs.map((d) => (
                  <div key={d.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
                    <div className="relative aspect-square bg-muted">
                      {resolveImageUrl(d.mockup_image_path) && (
                        <img
                          src={resolveImageUrl(d.mockup_image_path)!}
                          alt={d.title}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { const u = resolveImageUrl(d.mockup_image_path); if (u) setLightboxSrc(u); }}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleTogglePublish(d)}>
                          {d.is_published ? <GlobeLock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(d)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium line-clamp-3 whitespace-pre-wrap">{d.prompt || d.title}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">{d.product} · {d.color}</span>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {d.is_published && <Globe className="h-3 w-3 text-primary" />}
                          <span>♥ {d.likes_count}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Guest/session generations (view only) */}
                {guestGenerations.map((g) => {
                  const imgUrl = resolveImageUrl(g.mockup_image_path) || resolveImageUrl(g.transparent_image_path);
                  return (
                    <div key={g.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
                      <div className="relative aspect-square bg-muted">
                        {imgUrl && (
                          <img
                            src={imgUrl}
                            alt={g.prompt || "Generation"}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button size="sm" variant="secondary" onClick={() => imgUrl && setLightboxSrc(imgUrl)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium line-clamp-3 whitespace-pre-wrap">{g.prompt || "Untitled"}</p>
                        <span className="text-xs text-muted-foreground">{g.product} · {g.color}</span>
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
