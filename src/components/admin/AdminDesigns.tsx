import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface Design {
  id: string;
  title: string;
  prompt: string | null;
  product: string;
  color: string;
  is_published: boolean;
  likes_count: number;
  created_at: string;
  user_id: string;
  transparent_image_path: string | null;
  mockup_image_path: string | null;
}

export default function AdminDesigns() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDesigns();
  }, []);

  async function fetchDesigns() {
    setLoading(true);
    const { data } = await supabase.from("designs").select("*").order("created_at", { ascending: false });
    setDesigns((data as Design[]) || []);
    setLoading(false);
  }

  function getImageUrl(path: string | null) {
    if (!path) return null;
    const { data } = supabase.storage.from("designs").getPublicUrl(path);
    return data.publicUrl;
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">დიზაინები ({designs.length})</h2>
        <Button variant="outline" size="sm" onClick={fetchDesigns}>განახლება</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {designs.map(design => {
          const imgUrl = getImageUrl(design.mockup_image_path) || getImageUrl(design.transparent_image_path);
          return (
            <div key={design.id} className="rounded-lg border border-border overflow-hidden bg-card">
              <div className="aspect-square bg-muted flex items-center justify-center">
                {imgUrl ? (
                  <img src={imgUrl} alt={design.title} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-muted-foreground text-sm">ფოტო არ არის</span>
                )}
              </div>
              <div className="p-3 space-y-1">
                <h3 className="font-medium text-sm truncate">{design.title}</h3>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{design.product} • {design.color}</span>
                  <span>❤️ {design.likes_count}</span>
                </div>
                {design.prompt && (
                  <p className="text-xs text-muted-foreground truncate">{design.prompt}</p>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(design.created_at), "dd.MM.yy")}</span>
                  <span className="font-mono">{design.user_id.slice(0, 8)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {designs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          დიზაინები არ მოიძებნა
        </div>
      )}
    </div>
  );
}
