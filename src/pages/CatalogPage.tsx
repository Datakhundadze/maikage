import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "@/hooks/useAppState";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/AppHeader";
import { CATEGORIES } from "@/lib/categories";
import { ImageOff } from "lucide-react";
import CatalogDesignCard from "@/components/CatalogDesignCard";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import { COLORS } from "@/lib/catalog";
import { transformedDisplayUrl } from "@/lib/imageTransform";

// Map stored color (any case) to canonical COLORS.name; fallback "White".
function normalizeColor(raw: string | null | undefined): string {
  if (!raw) return "White";
  const found = COLORS.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  return found?.name ?? "White";
}

interface CatalogDesignRow {
  id: string;
  slug: string;
  title_ka: string;
  thumbnail_url: string | null;
  print_file_url: string;
  category: string | null;
  created_at: string;
  default_color: string | null;
}

const ALL = "__all__";

const CATEGORY_LABEL_BY_SLUG: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.label_ka]),
);

export default function CatalogPage() {
  const { setMode } = useAppState();
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<CatalogDesignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>(ALL);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    let q = (supabase as any)
      .from("catalog_designs")
      .select("id, slug, title_ka, thumbnail_url, print_file_url, category, created_at, default_color")
      .eq("is_published", true)
      .order("created_at", { ascending: false });
    if (activeCat !== ALL) q = q.eq("category", activeCat);
    q.then(({ data }: { data: CatalogDesignRow[] | null }) => {
      if (cancelled) return;
      setDesigns(data ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeCat]);

  const filterChips = useMemo(
    () => [{ slug: ALL, label_ka: "ყველა" }, ...CATEGORIES.map((c) => ({ slug: c.slug, label_ka: c.label_ka }))],
    [],
  );

  const goToDesign = (slug: string) => {
    setMode("simple");
    navigate(`/design/${slug}`);
  };

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title="კატალოგი — Maika.ge დიზაინები"
        description="აარჩიე მზა დიზაინი Maika.ge-ის კატალოგიდან — ქართული მოტივები, ფიროსმანი, მუსიკა, კინო, პატრიოტული. სხვადასხვა სტილისა და ხარისხის მაისურები."
        url={`${SITE_URL}/designs`}
      />
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-foreground">კატალოგი</h1>
            <p className="text-sm text-muted-foreground mt-1">
              მზა დიზაინები — აირჩიე და დაიბეჭდე ნებისმიერ პროდუქტზე
            </p>
          </div>

          {/* Category filter */}
          <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
            {filterChips.map((c) => {
              const active = activeCat === c.slug;
              return (
                <button
                  key={c.slug}
                  onClick={() => setActiveCat(c.slug)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {c.label_ka}
                </button>
              );
            })}
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : designs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ImageOff className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">დიზაინები ვერ მოიძებნა</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {designs.map((d, idx) => {
                const catLabel = d.category ? CATEGORY_LABEL_BY_SLUG[d.category] ?? d.category : null;
                return (
                  <button
                    key={d.id}
                    onClick={() => goToDesign(d.slug)}
                    className="group flex flex-col text-left rounded-xl border border-border bg-card overflow-hidden hover:border-primary/60 hover:shadow-sm transition-all"
                  >
                    <div className="aspect-square bg-muted/30 flex items-center justify-center overflow-hidden">
                      {d.print_file_url ? (
                        <CatalogDesignCard
                          // Display-only downscale of the full-res print
                          // file (aspect-preserving contain transform);
                          // grid tiles never need full res.
                          printFileUrl={transformedDisplayUrl(d.print_file_url, { width: 600 })}
                          fallbackUrl={d.thumbnail_url}
                          alt={`${d.title_ka}${catLabel ? ` — ${catLabel}` : ""} მაისურზე`}
                          color={normalizeColor(d.default_color)}
                          priority={idx === 0}
                        />
                      ) : (
                        <ImageOff className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="p-3 space-y-1.5">
                      <h3 className="text-sm font-semibold text-foreground line-clamp-2">{d.title_ka}</h3>
                      {catLabel && (
                        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {catLabel}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
