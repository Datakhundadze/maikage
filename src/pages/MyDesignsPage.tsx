import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDesignStorage } from "@/hooks/useDesignStorage";
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

export default function MyDesignsPage() {
  const { user } = useAuth();
  const { deleteDesign, togglePublish, getPublicUrl } = useDesignStorage();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const fetchDesigns = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("designs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setDesigns((data as Design[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchDesigns(); }, [fetchDesigns]);

  const handleDelete = async (d: Design) => {
    if (!confirm("Delete this design?")) return;
    const ok = await deleteDesign(d.id, d.transparent_image_path, d.mockup_image_path);
    if (ok) setDesigns((prev) => prev.filter((x) => x.id !== d.id));
  };

  const handleTogglePublish = async (d: Design) => {
    const ok = await togglePublish(d.id, d.is_published);
    if (ok) setDesigns((prev) => prev.map((x) => x.id === d.id ? { ...x, is_published: !x.is_published } : x));
  };

  return (
    <>
      <AppLayout
        sidebar={
          <div className="space-y-4">
            <h2 className="text-lg font-bold">My Designs</h2>
            <p className="text-sm text-muted-foreground">
              {designs.length} design{designs.length !== 1 ? "s" : ""} saved
            </p>
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
                <p className="text-lg">No designs yet</p>
                <p className="text-sm">Generate your first design in the Studio!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {designs.map((d) => (
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
                        <Button size="sm" variant="secondary" onClick={() => handleTogglePublish(d)}>
                          {d.is_published ? <GlobeLock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(d)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium truncate">{d.title}</p>
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
              </div>
            )}
          </div>
        }
      />
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}
