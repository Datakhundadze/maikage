import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CORPORATE_PARTNERS,
  CORPORATE_PARTNERS_HEADING,
  CORPORATE_WORK_COLUMNS,
  CORPORATE_WORK_COPY,
  CORPORATE_WORK_LIMIT,
  CORPORATE_WORK_SIZES,
  CORPORATE_WORK_TILE,
  corporateWorkImage,
  selectCorporateWork,
  type CorporateWorkImage,
  type CorporateWorkRow,
} from "@/lib/corporateWork";

// "ჩვენი კორპორატიული ნამუშევრები" (12 portfolio photos) and the
// "ვისთან ვთანამშრომლობთ" partner names, on /corporate and
// /korporatiuli-sachukrebi only (lib/corporateWork.ts CORPORATE_WORK_PATHS).
// Copy, partner list and photo selection: lib/corporateWork.ts — the prerender
// (scripts/lib/seo.mjs corporateWorkHtml) writes the same block into the raw
// HTML. A failed fetch or no matching photos hides the gallery; the partner
// strip always shows.
//
// The partner strip sits right under the pages' own "ვისთან ვთანამშრომლობთ"
// text section, so it carries that name as its aria-label, not a second
// visible heading.

type Status = "loading" | "ready" | "empty";

// "copy": inside LandingCopySection tone="page" (/corporate), its h2 size.
// "service": ServicePage's section h2 size (/korporatiuli-sachukrebi).
const HEADING = {
  copy: "text-base font-bold leading-snug text-gray-900 dark:text-white",
  service: "text-xl font-bold leading-snug text-gray-900 dark:text-white",
} as const;

function PartnersStrip() {
  return (
    <ul
      aria-label={CORPORATE_PARTNERS_HEADING}
      className="flex flex-wrap gap-2 text-xs font-medium text-gray-700 dark:text-white/70"
    >
      {CORPORATE_PARTNERS.map((name) => (
        <li key={name} className="rounded-full border border-gray-200 dark:border-white/15 px-3 py-1">
          {name}
        </li>
      ))}
    </ul>
  );
}

export default function CorporateWorkGallery({ tone = "service" }: { tone?: keyof typeof HEADING }) {
  const [images, setImages] = useState<CorporateWorkImage[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // `portfolio_items` is schema-ahead-of-types — cast mirrors PortfolioPage.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("portfolio_items")
          .select(CORPORATE_WORK_COLUMNS)
          .eq("active", true);
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setStatus("empty");
          return;
        }
        const picked = selectCorporateWork(data as CorporateWorkRow[]).map((r) =>
          corporateWorkImage(r, supabase.storage.from("portfolio").getPublicUrl(r.image_path as string).data.publicUrl),
        );
        setImages(picked);
        setStatus(picked.length > 0 ? "ready" : "empty");
      } catch {
        if (!cancelled) setStatus("empty");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <PartnersStrip />

      {status !== "empty" && (
        <section aria-labelledby="corporate-work-title" className="space-y-4">
          <h2 id="corporate-work-title" className={HEADING[tone]}>
            {CORPORATE_WORK_COPY.heading}
          </h2>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-white/60">{CORPORATE_WORK_COPY.intro}</p>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {status === "loading"
              ? Array.from({ length: CORPORATE_WORK_LIMIT }, (_, i) => (
                  <li key={i} aria-hidden="true" className="aspect-square rounded-xl bg-gray-100 dark:bg-white/5" />
                ))
              : images.map((img) => (
                  <li key={img.id}>
                    <img
                      src={img.src}
                      srcSet={img.srcSet}
                      sizes={CORPORATE_WORK_SIZES}
                      alt={img.alt}
                      width={CORPORATE_WORK_TILE}
                      height={CORPORATE_WORK_TILE}
                      loading="lazy"
                      decoding="async"
                      className="block w-full aspect-square object-cover rounded-xl bg-gray-100 dark:bg-white/5"
                    />
                  </li>
                ))}
          </ul>
          <p>
            <Link
              to={CORPORATE_WORK_COPY.allLink.href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white underline underline-offset-2 hover:text-amber-500 transition-colors"
            >
              {CORPORATE_WORK_COPY.allLink.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
