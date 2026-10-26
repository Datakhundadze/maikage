import { designFallbackDescription } from "@/lib/designSeo";

/**
 * Build the meta description shown to Google for a /design/:slug page.
 *
 * Priority:
 *  1. `meta_description_ka` if the admin / SEO team populated it.
 *  2. The long-form `description_ka` truncated cleanly (~120 chars
 *     ending at a word boundary), with a price + brand tail appended
 *     only when the snippet doesn't already say them.
 *  3. designFallbackDescription (lib/designSeo.ts): the design's name,
 *     its category and the "from" price — unique per design, and shared
 *     with the static prerender.
 */
export function buildDesignMetaDescription(
  design: { title_ka: string; meta_description_ka: string | null; description_ka: string | null },
  priceGEL: number,
  categoryLabel: string | null,
): string {
  const explicit = design.meta_description_ka?.trim();
  if (explicit) return explicit;

  const longForm = design.description_ka?.trim();
  if (longForm && longForm.length >= 40) {
    const MAX_PREFIX = 120;
    let prefix = longForm.length > MAX_PREFIX ? longForm.slice(0, MAX_PREFIX) : longForm;
    if (longForm.length > MAX_PREFIX) {
      const lastSpace = prefix.lastIndexOf(" ");
      if (lastSpace > 60) prefix = prefix.slice(0, lastSpace);
      prefix = prefix.trimEnd().replace(/[,.;:!?—–-]+$/u, "");
    }
    // Avoid double-stating price / brand if the snippet already does.
    const alreadyHasPrice = /ფას[აეთიოუ]/u.test(prefix);
    const alreadyHasBrand = /maika\.ge/i.test(prefix);
    let tail = "";
    if (!alreadyHasPrice) tail += ` ფასი ₾${priceGEL}-დან.`;
    if (!alreadyHasBrand) tail += " შეუკვეთე Maika.ge-ზე.";
    return (prefix + tail).trim();
  }

  // Fallback: lib/designSeo.ts — the same sentence the static prerender
  // writes (there without the price clause); a placeholder name
  // ("დიზაინი 1 (11)") is never quoted.
  return designFallbackDescription(design.title_ka, categoryLabel, priceGEL);
}
