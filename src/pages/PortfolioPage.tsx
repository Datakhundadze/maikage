import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Paintbrush } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import PortfolioLightbox from "@/components/PortfolioLightbox";
import { supabase } from "@/integrations/supabase/client";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import { normalizePortfolioCategory, orderPortfolioCategories, portfolioCountLabel } from "@/lib/portfolioCategories";
import { useAppState } from "@/hooks/useAppState";
import { Skeleton } from "@/components/ui/skeleton";

interface PortfolioItem {
  title: string | null;
  url: string;
  srcSet: string;
  /** 1200w render for the lightbox. */
  largeUrl: string;
  category: string;
  alt: string;
}

/** Tiles rendered at first, and added per "მეტის ნახვა" click. */
const PAGE_SIZE = 24;
/** ImageGallery JSON-LD lists at most this many images. */
const SCHEMA_IMAGE_LIMIT = 60;
/** ?cat=<label> deep-links a category chip. */
const CATEGORY_PARAM = "cat";

const chipClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
    active
      ? "border-[#26BB89] bg-[#26BB89]/10 text-[#26BB89]"
      : "border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white"
  }`;

export default function PortfolioPage() {
  const navigate = useNavigate();
  const { setMode } = useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `portfolio_items` is schema-ahead-of-types — cast mirrors AdminPortfolio.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("portfolio_items")
        .select("title, image_path, category, alt_text")
        .eq("active", true)
        // Hybrid: manually pinned first (sort_order ASC), then newest first.
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const rows = ((data ?? []) as { title: string | null; image_path: string; category: string | null; alt_text: string | null }[]).map((r) => {
        const publicUrl = supabase.storage.from("portfolio").getPublicUrl(r.image_path).data.publicUrl;
        // Display-only downscale (aspect-preserving contain transform). Serve a
        // 400w/800w srcset so the ~180px mobile slot fetches 400w instead of a
        // flat 800w; the sizes attr on the <img> matches the 2-col mobile /
        // 3-col sm / 4-col lg grid. The lightbox gets a 1200w render.
        // quality + resize=contain are unchanged (the helper's defaults).
        return {
          title: r.title,
          category: normalizePortfolioCategory(r.category),
          url: transformedDisplayUrl(publicUrl, { width: 400 }),
          srcSet: `${transformedDisplayUrl(publicUrl, { width: 400 })} 400w, ${transformedDisplayUrl(publicUrl, { width: 800 })} 800w`,
          largeUrl: transformedDisplayUrl(publicUrl, { width: 1200 }),
          // alt_text drives the <img> alt for SEO; fall back to title, then brand.
          alt: r.alt_text || r.title || "Maika.ge პორტფოლიო",
        };
      });
      setItems(rows);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Chips: fixed order (lib/portfolioCategories.ts), empty ones hidden.
  const categories = useMemo(() => orderPortfolioCategories(items), [items]);

  // The ?cat= value counts only when that chip exists; anything else is "ყველა".
  const requestedCategory = searchParams.get(CATEGORY_PARAM);
  const activeCategory = categories.some((c) => c.label === requestedCategory) ? requestedCategory : null;

  const selectCategory = (label: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (label) next.set(CATEGORY_PARAM, label);
    else next.delete(CATEGORY_PARAM);
    setSearchParams(next, { replace: true });
  };

  // A new category starts again from the first page.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [activeCategory]);

  const shown = useMemo(
    () => (activeCategory ? items.filter((it) => it.category === activeCategory) : items),
    [items, activeCategory],
  );
  const visible = shown.slice(0, visibleCount);
  const lightboxImages = useMemo(() => shown.map((it) => ({ src: it.largeUrl, alt: it.alt })), [shown]);

  // CollectionPage + ImageGallery JSON-LD, built from the loaded items (mirrors
  // the FAQPage / LocalBusiness schema pattern emitted via SeoHead's `schemas`).
  const schemas = useMemo(() => {
    if (items.length === 0) return [];
    return [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "ჩვენი ნამუშევრები | Maika.ge",
      url: `${SITE_URL}/portfolio`,
      description: "Maika.ge-ის ნამუშევრების გალერეა — დაბეჭდილი მაისურები, ჰუდები, სპორტული ფორმები და კორპორატიული შეკვეთები.",
      mainEntity: {
        "@type": "ImageGallery",
        name: "Maika.ge-ის ნამუშევრები",
        image: items.slice(0, SCHEMA_IMAGE_LIMIT).map((it) => ({
          "@type": "ImageObject",
          contentUrl: it.url,
          caption: it.alt,
        })),
      },
    }];
  }, [items]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <SeoHead
        title="ჩვენი ნამუშევრები — დაბეჭდილი მაისურები და ჰუდები | maika.ge"
        description="ჩვენი ნამუშევრები — დაბეჭდილი მაისურები, ჰუდები, სპორტული ფორმები და კორპორატიული შეკვეთები კომპანიების, გუნდებისა და ღონისძიებებისთვის."
        url={`${SITE_URL}/portfolio`}
        schemas={schemas}
      />
      <div className="max-w-5xl mx-auto px-4 py-12">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          მთავარი გვერდი
        </button>

        <h1 className="text-3xl sm:text-4xl font-bold mb-3">ჩვენი ნამუშევრები</h1>
        <p className="max-w-2xl text-gray-500 dark:text-white/50 leading-relaxed mb-3">
          ვბეჭდავთ მაისურებს, ჰუდებსა და სპორტულ ფორმებს, ვასრულებთ კორპორატიულ შეკვეთებს კომპანიებისთვის, გუნდებისა და ღონისძიებებისთვის.
        </p>
        <p className="mb-8 h-5 text-sm font-semibold text-[#26BB89]">
          {items.length > 0 ? portfolioCountLabel(items.length) : null}
        </p>

        {/* Category filter — only when items carry categories. */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label="კატეგორიები">
            <button
              type="button"
              aria-pressed={activeCategory === null}
              onClick={() => selectCategory(null)}
              className={chipClass(activeCategory === null)}
            >
              ყველა
              <span className="tabular-nums opacity-60">{items.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={activeCategory === c.label}
                onClick={() => selectCategory(c.label)}
                className={chipClass(activeCategory === c.label)}
              >
                {c.label}
                <span className="tabular-nums opacity-60">{c.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Loading: placeholder tiles in the grid's own shape. */}
        {!loaded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Gallery — renders nothing until active items exist. */}
        {visible.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map((it, i) => (
              <figure
                key={`${it.url}-${i}`}
                className="group relative aspect-[4/5] rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5"
              >
                {/* Skeleton sits behind the lazy image; the image paints over
                    it once it decodes, so no shift and no empty box. */}
                <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
                <button
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  aria-label={`${it.alt} — გადიდება`}
                  className="relative block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#26BB89]"
                >
                  <img
                    src={it.url}
                    srcSet={it.srcSet}
                    sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
                    alt={it.alt}
                    className="h-full w-full object-cover object-[center_40%] transition duration-300 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              </figure>
            ))}
          </div>
        )}

        {visible.length < shown.length && (
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-white/15 px-6 py-3 text-sm font-semibold text-gray-700 dark:text-white/80 hover:border-[#26BB89] hover:text-[#26BB89] transition-colors"
            >
              მეტის ნახვა
              <span className="tabular-nums text-gray-400 dark:text-white/40">({shown.length - visible.length})</span>
            </button>
          </div>
        )}

        {/* CTA — start a design in the constructor (lives at "/" behind the
            "simple" mode, same as NotFound's link) or go to /corporate. */}
        <section className="mt-16 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] px-6 py-10 text-center">
          <h2 className="text-2xl font-bold mb-6">გინდა შენი დიზაინით?</h2>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              to="/"
              onClick={() => setMode("simple")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#26BB89] px-6 py-3 text-sm font-semibold text-white hover:bg-[#26BB89]/90 transition-colors"
            >
              <Paintbrush className="h-4 w-4" />
              შექმენი შენი დიზაინი
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/corporate"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#26BB89] px-6 py-3 text-sm font-semibold text-[#26BB89] hover:bg-[#26BB89]/10 transition-colors"
            >
              <Building2 className="h-4 w-4" />
              კორპორატიული შეკვეთა
            </Link>
          </div>
        </section>
      </div>

      <PortfolioLightbox
        images={lightboxImages}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
