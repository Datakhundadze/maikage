// <title> and meta description of the product landing routes (/t-shirt,
// /hoodie/premium-washed, …).
//
// ONE SOURCE for both places that emit them: ProductLandingPage (SeoHead, at
// runtime) and scripts/prerender.mjs (the static file a crawler gets before
// any JS). They must match — Helmet replaces the static <title> on mount, so a
// title that existed only in the static file would never be what Google
// indexes for a JS-rendering crawl.
//
// No prices, by rule: prices are computed at runtime by pricing.ts only.
// Every fact below already appears on the site: DTF printing and delivery
// across Georgia (FAQ, lib/faqContent.ts), the lead time (LEAD_TIME_KA),
// photo / text / AI design (the constructor itself), the Tbilisi showroom
// (/contact).
import type { ProductType } from "@/lib/catalog";
import { LEAD_TIME_KA } from "@/lib/leadTime";

/** Plural product names for the product-route titles. */
export const LANDING_PLURAL_KA: Readonly<Partial<Record<ProductType, string>>> = {
  "T-Shirt": "მაისურები",
  "Hoodie": "ჰუდები",
  "Tote Bag": "ჩანთები",
  "Cap": "კეპები",
  "Apron": "წინსაფრები",
  "Phone Case": "ქეისები",
  "Mug": "ჭიქები",
};

/** The shared second half of every landing description; public/llms.txt quotes it too. */
export const LANDING_TAIL_KA = `შენი ფოტოთი, ტექსტით ან AI დიზაინით. DTF ბეჭდვა, მზადდება ${LEAD_TIME_KA}. შოურუმი თბილისში, მიწოდება მთელ საქართველოში.`;

/**
 * Bare product routes whose title / description lead with the exact search
 * term (Search Console: "მაისური", "მაისურების დამზადება", "ჰუდი"). Every
 * other route keeps the generic "{plural} ბეჭდვით — …" title.
 */
export const LANDING_SEO_OVERRIDES_KA: Readonly<Partial<Record<ProductType, { title: string; description: string }>>> = {
  "T-Shirt": {
    title: "მაისური — მაისურების დამზადება და ბეჭდვა თბილისში | maika.ge",
    description: `მაისურების დამზადება და ბეჭდვა ${LANDING_TAIL_KA}`,
  },
  "Hoodie": {
    title: "ჰუდი შენი დიზაინით — ჰუდებზე ბეჭდვა თბილისში | maika.ge",
    description: `ჰუდებზე ბეჭდვა ${LANDING_TAIL_KA}`,
  },
};

/**
 * @param product   catalog product type
 * @param productKa its Georgian label (i18n productTypeKa)
 * @param brand     the brand string from the URL (SUB_PRODUCTS), or null for /<product>
 */
export function landingSeo(
  product: ProductType,
  productKa: string,
  brand: string | null,
): { title: string; description: string } {
  if (brand) {
    return {
      title: `${productKa} ${brand} ბეჭდვით — შენი დიზაინით | maika.ge`,
      description: `${productKa} ${brand} ${LANDING_TAIL_KA}`,
    };
  }
  const override = LANDING_SEO_OVERRIDES_KA[product];
  if (override) return { ...override };
  const plural = LANDING_PLURAL_KA[product] ?? productKa;
  return {
    title: `${plural} ბეჭდვით — შენი დიზაინით, თბილისი | maika.ge`,
    description: `${plural} ${LANDING_TAIL_KA}`,
  };
}
