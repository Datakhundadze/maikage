import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LandingCopy } from "@/lib/landingCopy";

// The text section under the constructor on a bare product landing route
// (/t-shirt). Purely presentational: the copy is lib/landingCopy.ts, the price
// is handed in by ProductLandingPage (lib/landingPrice.ts, the same "from"
// price the hero shows). With no price the ფასი section simply starts at its
// second sentence — never a placeholder.
//
// Rendered at the end of the constructor's own scroll column (SimplePage
// `afterContent`), so it flows after the order buttons and never sits over
// any of the constructor's controls.
//
// Also used by /corporate (pages/CorporatePage.tsx, copy in
// lib/corporateCopy.ts, price always null, tone "page"). A section may carry
// `bullets` (bold term — text) instead of, or after, its body. /t-shirt has no
// bullets and uses the default tone, so its markup is unchanged.
//
// Optional `images` (after the intro) and FAQ (`faqHeading` + `faq`, after the
// sections): /hoodie and /corporate. /t-shirt has neither.

// "sidebar" (default): the constructor column's theme tokens — the exact
// classes /t-shirt always had. "page": CorporatePage's own palette; that page
// paints bg-white / dark:bg-[#0a0a0a] itself, so the sidebar tokens
// (near-white in the green theme) would be unreadable on it.
const TONES = {
  sidebar: {
    section: "max-w-prose border-t border-sidebar-border pt-6 space-y-4 text-sm leading-relaxed text-muted-foreground",
    h2: "text-base font-bold leading-snug text-sidebar-foreground",
    h3: "text-sm font-semibold text-sidebar-foreground",
    strong: "font-semibold text-sidebar-foreground",
    link: "font-medium text-sidebar-foreground underline underline-offset-2 hover:text-primary",
    img: "w-full h-auto rounded-xl bg-muted object-contain",
  },
  page: {
    section:
      "max-w-prose border-t border-gray-200 dark:border-white/10 pt-6 space-y-4 text-sm leading-relaxed text-gray-600 dark:text-white/60",
    h2: "text-base font-bold leading-snug text-gray-900 dark:text-white",
    h3: "text-sm font-semibold text-gray-900 dark:text-white",
    strong: "font-semibold text-gray-900 dark:text-white",
    link: "font-medium text-gray-900 dark:text-white underline underline-offset-2 hover:text-amber-500",
    img: "w-full h-auto rounded-xl bg-gray-100 dark:bg-white/5 object-contain",
  },
} as const;

interface LandingCopySectionProps {
  copy: LandingCopy;
  /** Whole lari, or null while unknown. */
  price: number | null;
  tone?: keyof typeof TONES;
  /** Rendered after the sections, before the FAQ (/corporate: CorporateWorkGallery). */
  beforeFaq?: ReactNode;
}

export default function LandingCopySection({ copy, price, tone = "sidebar", beforeFaq }: LandingCopySectionProps) {
  // Same format as LandingHero's "{price} ₾-დან".
  const priceText = price != null && Number.isFinite(price) && price > 0 ? `${price} ₾` : null;
  const t = TONES[tone];

  return (
    <section aria-labelledby="landing-copy-title" className={t.section}>
      <h2 id="landing-copy-title" className={t.h2}>
        {copy.h2}
      </h2>
      <p>{copy.intro}</p>
      {copy.images && copy.images.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {copy.images.map((img) => (
            <img
              key={img.src}
              src={img.src}
              alt={img.alt}
              width={img.width}
              height={img.height}
              loading="lazy"
              decoding="async"
              className={t.img}
            />
          ))}
        </div>
      )}
      {copy.sections.map((s) => (
        <div key={s.h3} className="space-y-1">
          <h3 className={t.h3}>{s.h3}</h3>
          {s.body !== undefined && (
            <p>{s.priceLead && priceText ? `${s.priceLead(priceText)} ${s.body}` : s.body}</p>
          )}
          {s.bullets && s.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {s.bullets.map((b) => (
                <li key={b.term}>
                  <strong className={t.strong}>{b.term}</strong> — {b.text}
                </li>
              ))}
            </ul>
          )}
          {s.link && (
            <p>
              <Link to={s.link.href} className={t.link}>
                {s.link.label}
              </Link>
            </p>
          )}
        </div>
      ))}
      {beforeFaq}
      {copy.faq && copy.faq.length > 0 && (
        <div className="space-y-3">
          {copy.faqHeading && <h2 className={t.h2}>{copy.faqHeading}</h2>}
          {copy.faq.map((item) => (
            <div key={item.q} className="space-y-1">
              <h3 className={t.h3}>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
