import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import type { ProductType } from "@/lib/catalog";

// Real photos for the product landing hero, from the same public gallery the
// /portfolio page reads (portfolio_items, active rows only — RLS allows exactly
// that to the anon key). An admin picks a product's photos by setting the
// row's category to the label below in the existing "პორტფოლიო" admin tab.
//
// Products with no label (Phone Case, Mug) get no photos. Any failure or an
// empty result is just an empty list: the hero renders without a strip and
// shows no error.

/** portfolio_items.category label per product type. */
export const LANDING_PHOTO_CATEGORY: Readonly<Partial<Record<ProductType, string>>> = {
  "Hoodie": "ჰუდი",
  "T-Shirt": "მაისური",
  "Tote Bag": "ჩანთა",
  "Cap": "კეპი",
  "Apron": "წინსაფარი",
};

export const LANDING_PHOTO_LIMIT = 4;

export interface LandingPhoto {
  url: string;
  srcSet: string;
  alt: string;
}

export function useLandingPhotos(product: ProductType): LandingPhoto[] {
  const [photos, setPhotos] = useState<LandingPhoto[]>([]);
  const category = LANDING_PHOTO_CATEGORY[product] ?? null;

  useEffect(() => {
    setPhotos([]);
    if (!category) return;
    let cancelled = false;
    (async () => {
      try {
        // `portfolio_items` is schema-ahead-of-types — cast mirrors PortfolioPage.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from("portfolio_items")
          .select("title, image_path, alt_text")
          .eq("active", true)
          .eq("category", category)
          // Same order as /portfolio: pinned first (sort_order ASC), then newest.
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(LANDING_PHOTO_LIMIT);
        if (cancelled || !Array.isArray(data)) return;
        const rows = (data as { title: string | null; image_path: string; alt_text: string | null }[]).map((r) => {
          // URLs built exactly as PortfolioPage.tsx does (400w / 800w srcset).
          const publicUrl = supabase.storage.from("portfolio").getPublicUrl(r.image_path).data.publicUrl;
          return {
            url: transformedDisplayUrl(publicUrl, { width: 400 }),
            srcSet: `${transformedDisplayUrl(publicUrl, { width: 400 })} 400w, ${transformedDisplayUrl(publicUrl, { width: 800 })} 800w`,
            alt: r.alt_text || r.title || "Maika.ge პორტფოლიო",
          };
        });
        setPhotos(rows);
      } catch {
        /* no strip — the hero is complete without it */
      }
    })();
    return () => { cancelled = true; };
  }, [category]);

  return photos;
}
