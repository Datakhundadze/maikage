/**
 * Build the meta description shown to Google for a /design/:slug page.
 *
 * Priority:
 *  1. `meta_description_ka` if the admin / SEO team populated it.
 *  2. The long-form `description_ka` truncated cleanly (~120 chars
 *     ending at a word boundary), with a price + brand tail appended
 *     only when the snippet doesn't already say them.
 *  3. A category-aware fallback that varies the noun phrase so two
 *     designs in different categories don't end up with duplicate
 *     descriptions — the previous fallback used the same template for
 *     every design.
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

  if (categoryLabel) {
    return `${design.title_ka} — უნიკალური ${categoryLabel} დიზაინი მაისურზე. DTF ბეჭდვა მაღალი ხარისხით, ფასი ₾${priceGEL}-დან. შეუკვეთე ონლაინ Maika.ge-ზე.`;
  }
  return `${design.title_ka} — უნიკალური დიზაინი მაისურზე. DTF ბეჭდვა მაღალი ხარისხით, ფასი ₾${priceGEL}-დან. შეუკვეთე ონლაინ Maika.ge-ზე.`;
}
