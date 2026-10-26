// /design/:slug — <title> and the fallback meta description.
//
// ONE SOURCE for the live page (DesignDetailPage's SeoHead, and
// lib/designMetaDescription.ts for the description) and the static prerender
// (scripts/prerender.mjs, which loads this module through
// scripts/lib/appModules.mjs), so the static <title> is the one Helmet keeps.
//
// Some published designs carry a file-name placeholder instead of a name
// ("დიზაინი 1 (11)", "1 (3)", "Design 12 (2)", "დიზაინი~10"). Those never
// reach the <title> or the description: a placeholder is a name with no
// letters left once the word "დიზაინი" / "design" is removed.
import { LEAD_TIME_KA } from "@/lib/leadTime";

const BRAND = " | maika.ge";
const SUFFIX = " — მაისური ქართული დიზაინით";
const SHORT_SUFFIX = " — მაისური";
const GENERIC = "მაისური ქართული დიზაინით";
export const DESIGN_TITLE_MAX = 60;

/** True when the name is only a numbered placeholder. */
export function isPlaceholderDesignName(name: string | null | undefined): boolean {
  const rest = String(name ?? "")
    .replace(/დიზაინი|design/giu, "")
    .replace(/[^\p{L}]/gu, "");
  return rest.length === 0;
}

/**
 * "{name} — მაისური ქართული დიზაინით | maika.ge"; a long name keeps only
 * " — მაისური", so the title stays within DESIGN_TITLE_MAX whenever it can.
 * A placeholder name gives "მაისური ქართული დიზაინით — {category} | maika.ge"
 * (or without the category when there is none).
 */
export function designSeoTitle(name: string, categoryLabel: string | null): string {
  const trimmed = String(name ?? "").trim();
  if (isPlaceholderDesignName(trimmed)) {
    return categoryLabel ? `${GENERIC} — ${categoryLabel}${BRAND}` : `${GENERIC}${BRAND}`;
  }
  const full = `${trimmed}${SUFFIX}${BRAND}`;
  return full.length <= DESIGN_TITLE_MAX ? full : `${trimmed}${SHORT_SUFFIX}${BRAND}`;
}

/**
 * Meta description for a design without meta_description_ka / a long
 * description_ka. `priceGEL` is the live page's "from" price; the static
 * prerender passes null and the price clause is left out (SeoHead adds it on
 * mount).
 */
export function designFallbackDescription(
  name: string,
  categoryLabel: string | null,
  priceGEL: number | null,
): string {
  const trimmed = String(name ?? "").trim();
  const lead = isPlaceholderDesignName(trimmed) ? GENERIC : `„${trimmed}“ — ${GENERIC}`;
  const category = categoryLabel ? `, კატეგორია „${categoryLabel}“` : "";
  const price = priceGEL != null && Number.isFinite(priceGEL) && priceGEL > 0 ? `, ფასი ₾${priceGEL}-დან` : "";
  return `${lead}${category}. დაბეჭდე მაისურზე ან ჰუდზე, მზადდება ${LEAD_TIME_KA}ში${price}. შეუკვეთე ონლაინ Maika.ge-ზე.`;
}
