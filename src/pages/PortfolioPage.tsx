import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import { supabase } from "@/integrations/supabase/client";
import { transformedImageUrl, publicImageUrl, imgFallbackToOriginal } from "@/lib/imageTransform";

interface PortfolioItem {
  title: string | null;
  url: string;
  /** Untransformed public URL — onError fallback for the transformed `url`. */
  original: string;
  category: string | null;
  alt: string;
}

export default function PortfolioPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `portfolio_items` is schema-ahead-of-types — cast mirrors AdminPortfolio.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("portfolio_items")
        .select("title, image_path, category, alt_text")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (cancelled || !data) return;
      const rows = (data as { title: string | null; image_path: string; category: string | null; alt_text: string | null }[]).map((r) => ({
        title: r.title,
        category: r.category,
        // Resized/WebP via Supabase transform; `original` is the onError fallback.
        url: transformedImageUrl("portfolio", r.image_path, { width: 800, quality: 65, resize: "contain" }),
        original: publicImageUrl("portfolio", r.image_path),
        // alt_text drives the <img> alt for SEO; fall back to title, then brand.
        alt: r.alt_text || r.title || "Maika.ge პორტფოლიო",
      }));
      setItems(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  // Distinct categories (in sort order), used for the filter chips.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) {
      const c = (it.category || "").trim();
      if (c && !seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [items]);

  const shown = useMemo(
    () => (activeCategory ? items.filter((it) => (it.category || "").trim() === activeCategory) : items),
    [items, activeCategory],
  );

  // CollectionPage + ImageGallery JSON-LD, built from the loaded items (mirrors
  // the FAQPage / LocalBusiness schema pattern emitted via SeoHead's `schemas`).
  const schemas = useMemo(() => {
    if (items.length === 0) return [];
    return [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "პორტფოლიო | Maika.ge",
      url: `${SITE_URL}/portfolio`,
      description: "Maika.ge-ის ნამუშევრების გალერეა — დაბეჭდილი მაისურები, ჰუდები და კასტომ აპარელი.",
      mainEntity: {
        "@type": "ImageGallery",
        name: "Maika.ge პორტფოლიო",
        image: items.map((it) => ({
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
        title="პორტფოლიო — ჩვენი ნამუშევრები | Maika.ge"
        description="Maika.ge-ის ნამუშევრების გალერეა — დაბეჭდილი მაისურები, ჰუდები, ჩანთები და კასტომ აპარელი. ნახე რას ვქმნით და შეუკვეთე შენი დიზაინი."
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

        <h1 className="text-3xl font-bold mb-2">პორტფოლიო</h1>
        <p className="text-gray-500 dark:text-white/50 leading-relaxed mb-8">
          ჩვენი ნამუშევრები — დაბეჭდილი მაისურები, ჰუდები და კასტომ აპარელი.
        </p>

        {/* Category filter — only when items carry categories. */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
                activeCategory === null
                  ? "border-[#26BB89] bg-[#26BB89]/10 text-[#26BB89]"
                  : "border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              ყველა
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCategory(c)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
                  activeCategory === c
                    ? "border-[#26BB89] bg-[#26BB89]/10 text-[#26BB89]"
                    : "border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Gallery — renders nothing until active items exist. */}
        {shown.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {shown.map((it, i) => (
              <figure
                key={`${it.url}-${i}`}
                className="group aspect-square rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5"
              >
                <img
                  src={it.url}
                  alt={it.alt}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  loading="lazy"
                  onError={(e) => imgFallbackToOriginal(e, it.original)}
                />
              </figure>
            ))}
          </div>
        )}

        {/* Catalog CTA — the storefront catalog lives at /designs. */}
        {items.length > 0 && (
          <div className="mt-12 text-center">
            <Link
              to="/designs"
              className="inline-flex items-center gap-2 rounded-xl bg-[#26BB89] px-6 py-3 text-sm font-semibold text-white hover:bg-[#26BB89]/90 transition-colors"
            >
              ნახე კატალოგი
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
