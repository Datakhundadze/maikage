import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppState } from "@/hooks/useAppState";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import { HOME_WORK_LIMIT, homeShowcaseCopy } from "@/lib/homeShowcaseCopy";

// Home "ჩვენი ნამუშევრები" — six real photos from the public portfolio
// gallery (portfolio_items, active rows; RLS gives the anon key exactly
// those). Same order and URL building as /portfolio (PortfolioPage.tsx) and
// the product-landing strip (hooks/useLandingPhotos.ts): sort_order ASC with
// nulls last, then newest; 400w/800w display transforms. 4:5 tiles, lazy.
// Any failure or no rows → renders nothing.

interface Photo {
  url: string;
  srcSet: string;
  /** null → the localized fallback (copy.workAlt) at render. */
  alt: string | null;
}

// Bulk uploads keep camera file names as titles ("image00007") — not an alt text.
const FILE_NAME_TITLE = /^(image|img|dsc|photo|pxl)[\s_-]?\d+$/i;

export default function HomeWorkStrip() {
  const { lang, theme } = useAppState();
  const isGreen = theme === "green";
  const copy = homeShowcaseCopy(lang);
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // `portfolio_items` is schema-ahead-of-types — cast mirrors PortfolioPage.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from("portfolio_items")
          .select("title, image_path, alt_text")
          .eq("active", true)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(HOME_WORK_LIMIT);
        if (cancelled || !Array.isArray(data)) return;
        setPhotos(
          (data as { title: string | null; image_path: string; alt_text: string | null }[]).map((r) => {
            const publicUrl = supabase.storage.from("portfolio").getPublicUrl(r.image_path).data.publicUrl;
            const title = r.title && !FILE_NAME_TITLE.test(r.title.trim()) ? r.title : null;
            return {
              url: transformedDisplayUrl(publicUrl, { width: 400 }),
              srcSet: `${transformedDisplayUrl(publicUrl, { width: 400 })} 400w, ${transformedDisplayUrl(publicUrl, { width: 800 })} 800w`,
              alt: r.alt_text || title,
            };
          }),
        );
      } catch {
        /* no strip — the home page is complete without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (photos.length === 0) return null;

  return (
    <section aria-labelledby="home-work-title" className="w-full max-w-5xl mx-auto mb-16 sm:mb-20">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="home-work-title" className="text-xl sm:text-2xl font-bold" style={{ color: isGreen ? "white" : undefined }}>
          {copy.workTitle}
        </h2>
        <Link
          to="/portfolio"
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
          style={{ color: isGreen ? "white" : "rgba(255,255,255,0.75)" }}
        >
          {copy.workAll} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        {photos.map((p, i) => (
          <li key={p.url}>
            <Link
              to="/portfolio"
              className={`block aspect-[4/5] overflow-hidden rounded-xl border ${isGreen ? "border-white/40 bg-white/20" : "border-white/[0.08] bg-white/5"}`}
            >
              <img
                src={p.url}
                srcSet={p.srcSet}
                sizes="(min-width: 1024px) 160px, (min-width: 640px) 16vw, 33vw"
                alt={p.alt ?? copy.workAlt}
                width={400}
                height={500}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.04]"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
