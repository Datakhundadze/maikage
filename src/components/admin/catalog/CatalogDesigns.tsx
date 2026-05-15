import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Star, Trash2, Upload, Package } from "lucide-react";
import DesignUploadDialog from "./DesignUploadDialog";
import BulkDesignUploadDialog from "./BulkDesignUploadDialog";
import MockupColorPicker from "./MockupColorPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLORS } from "@/lib/catalog";

interface CatalogDesign {
  id: string;
  slug: string;
  title_ka: string;
  title_en: string | null;
  thumbnail_url: string | null;
  print_file_url: string;
  category: string | null;
  tags: string[];
  is_published: boolean;
  is_featured: boolean;
  view_count: number;
  order_count: number;
  created_at: string;
  default_color: string | null;
}

const STATUS_FILTERS = ["all", "published", "draft", "featured"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function CatalogDesigns() {
  const { toast } = useToast();
  const [designs, setDesigns] = useState<CatalogDesign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("catalog_designs")
      .select("id, slug, title_ka, title_en, thumbnail_url, print_file_url, category, tags, is_published, is_featured, view_count, order_count, created_at, default_color")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    } else {
      setDesigns((data || []) as CatalogDesign[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    designs.forEach((d) => d.category && set.add(d.category));
    return Array.from(set).sort();
  }, [designs]);

  const filtered = useMemo(() => {
    return designs.filter((d) => {
      if (statusFilter === "published" && !d.is_published) return false;
      if (statusFilter === "draft" && d.is_published) return false;
      if (statusFilter === "featured" && !d.is_featured) return false;
      if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
      if (search && !`${d.title_ka} ${d.title_en ?? ""} ${d.slug}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [designs, search, statusFilter, categoryFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkSetPublished = async (publish: boolean) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await (supabase as any)
      .from("catalog_designs")
      .update({ is_published: publish, published_at: publish ? new Date().toISOString() : null })
      .in("id", ids);
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: publish ? "გამოქვეყნდა" : "უკან აღება", description: `${ids.length} დიზაინი` });
    setSelected(new Set());
    load();
  };

  const toggleFeatured = async (d: CatalogDesign) => {
    const { error } = await (supabase as any)
      .from("catalog_designs")
      .update({ is_featured: !d.is_featured })
      .eq("id", d.id);
    if (error) toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    else load();
  };

  const togglePublished = async (d: CatalogDesign) => {
    const next = !d.is_published;
    const { error } = await (supabase as any)
      .from("catalog_designs")
      .update({ is_published: next, published_at: next ? new Date().toISOString() : null })
      .eq("id", d.id);
    if (error) toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    else load();
  };

  const remove = async (d: CatalogDesign) => {
    if (!confirm(`წავშალო „${d.title_ka}"?`)) return;
    const { error } = await (supabase as any).from("catalog_designs").delete().eq("id", d.id);
    if (error) toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    else load();
  };

  const updateMockupColor = async (d: CatalogDesign, color: string) => {
    // Optimistic update
    setDesigns((prev) => prev.map((x) => x.id === d.id ? { ...x, default_color: color } : x));
    const { error } = await (supabase as any)
      .from("catalog_designs")
      .update({ default_color: color })
      .eq("id", d.id);
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
      load();
    } else {
      toast({ title: "ფერი განახლდა", description: `${d.title_ka} → ${color}` });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="ძიება..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">ყველა</option>
          <option value="published">გამოქვეყნებული</option>
          <option value="draft">დრაფტი</option>
          <option value="featured">გამორჩეული</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">ყველა კატეგორია</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => bulkSetPublished(true)}>
                <Eye className="h-4 w-4 mr-1" /> გამოქვეყნება ({selected.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkSetPublished(false)}>
                <EyeOff className="h-4 w-4 mr-1" /> უკან აღება
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => setBulkUploadOpen(true)}>
            <Package className="h-4 w-4 mr-1" /> ჯგუფური ატვირთვა
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> ახლის ატვირთვა
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">იტვირთება...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">დიზაინები არ არის. ატვირთე პირველი.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              className={`relative rounded-lg border bg-card overflow-hidden ${selected.has(d.id) ? "ring-2 ring-primary" : "border-border"}`}
            >
              <button
                onClick={() => toggleSelect(d.id)}
                className="absolute top-1.5 left-1.5 h-5 w-5 rounded border bg-background/80 z-10 flex items-center justify-center text-xs"
              >
                {selected.has(d.id) ? "✓" : ""}
              </button>
              <div className="aspect-square bg-muted/30 flex items-center justify-center">
                {d.thumbnail_url || d.print_file_url ? (
                  <img src={d.thumbnail_url || d.print_file_url} alt={d.title_ka} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-xs text-muted-foreground">no image</span>
                )}
              </div>
              <div className="p-2 space-y-1">
                <p className="text-xs font-medium truncate" title={d.title_ka}>{d.title_ka}</p>
                <p className="text-[10px] text-muted-foreground truncate">{d.category || "—"}</p>
                <div className="flex items-center justify-between gap-1 pt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.is_published ? "bg-green-500/15 text-green-500" : "bg-muted text-muted-foreground"}`}>
                    {d.is_published ? "live" : "draft"}
                  </span>
                  <div className="flex gap-0.5">
                    <button onClick={() => toggleFeatured(d)} title="გამორჩეული" className="p-1 hover:bg-accent rounded">
                      <Star className={`h-3 w-3 ${d.is_featured ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`} />
                    </button>
                    <button onClick={() => togglePublished(d)} title="ხილვადობა" className="p-1 hover:bg-accent rounded">
                      {d.is_published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                    </button>
                    <button onClick={() => remove(d)} title="წაშლა" className="p-1 hover:bg-destructive/15 rounded">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DesignUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => { setUploadOpen(false); load(); }}
      />

      <BulkDesignUploadDialog
        open={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
        onUploaded={() => { load(); }}
      />
    </div>
  );
}
