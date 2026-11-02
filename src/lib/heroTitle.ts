// The landing hero's H1 name: the brand alone when the URL names one
// (/hoodie/premium-washed → "Premium Washed Hoodie"), the product's Georgian
// label otherwise (/hoodie → "ჰუდი"). Separate from ProductLandingPage's
// landingName, which keeps feeding the SEO title and description unchanged.
//
// A bare product route may lead with its search phrase instead
// (HERO_TITLE_OVERRIDES_KA): /hoodie → "ჰუდებზე ბეჭდვა", so its H1 reads
// "ჰუდებზე ბეჭდვა — შენი დიზაინით". Brand routes never take the override.
export const HERO_TITLE_OVERRIDES_KA: Readonly<Record<string, string>> = {
  Hoodie: "ჰუდებზე ბეჭდვა",
};

/**
 * @param productKa the product's Georgian label (i18n productTypeKa)
 * @param brand     the brand from the URL, or null for /<product>
 * @param product   the catalog product type (optional; enables the override)
 */
export function heroTitle(productKa: string, brand: string | null, product?: string): string {
  if (brand) return brand;
  if (product && Object.prototype.hasOwnProperty.call(HERO_TITLE_OVERRIDES_KA, product)) {
    return HERO_TITLE_OVERRIDES_KA[product];
  }
  return productKa;
}
