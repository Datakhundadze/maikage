// Default product + colour for every admin path that creates catalog_designs
// rows (single upload, bulk upload, AI agent). Catalog t-shirts sell on
// Sol's, so new designs must land there unless the uploader picks another
// product on purpose.

export const DEFAULT_CATALOG_PRODUCT_SLUG = "tshirt-sols";

/** Valid Sol's colour (BRAND_COLORS["Sol's"]) and matches existing rows' casing. */
export const DEFAULT_CATALOG_COLOR = "White";

interface ProductLike {
  id: string;
  type: string;
  slug?: string | null;
}

/**
 * Sol's t-shirt by slug; if that row is missing/inactive, fall back to the
 * previous behaviour (first T-Shirt in the given order, then first product).
 */
export function pickDefaultCatalogProductId(products: ProductLike[]): string {
  const sols = products.find((p) => p.slug === DEFAULT_CATALOG_PRODUCT_SLUG);
  if (sols) return sols.id;
  const firstTshirt = products.find((p) => p.type === "T-Shirt");
  return firstTshirt?.id ?? products[0]?.id ?? "";
}
