// URL slugs for the product landing routes (/t-shirt, /hoodie/premium-washed …).
//
// These routes are ENTRY POINTS into the constructor for ad landings: they
// preselect a product and, optionally, a brand, and nothing else. Pricing,
// cart and ordering never see a slug — the constructor receives the same
// catalog ids (PRODUCTS[].type / SUB_PRODUCTS strings) a hand pick produces.
//
// Every slug is checked against catalog.ts at RUNTIME as well (resolve* below),
// so a product hidden or a brand removed in catalog.ts simply stops resolving:
// the product page renders NotFound and an unknown brand falls back to the
// product's default brand. src/test/productSlugs.test.ts fails if a slug
// points at anything catalog.ts no longer has.

import { PRODUCTS, SUB_PRODUCTS, HIDDEN_PRODUCTS, catalog, type ProductType } from "@/lib/catalog";
import { PRODUCT_SLUGS, LANDING_PRODUCT_SLUGS } from "@/lib/productRouteSlugs";

export { PRODUCT_SLUGS, LANDING_PRODUCT_SLUGS };

/** Lowercase Latin, single hyphens: what every slug must look like. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Per product: URL brand slug → exact SUB_PRODUCTS string. */
export const BRAND_SLUGS: Readonly<Partial<Record<ProductType, Readonly<Record<string, string>>>>> = {
  "T-Shirt": {
    "gildan": "GILDAN",
    "sols": "Sol's",
    "gildan-hummer": "GILDAN HUMMER",
    "th": "TH",
    "jel": "JEL T-Shirt",
    "giordano": "GIORDANO",
    "khundadze": "Khundadze",
    "nike": "NIKE",
    "polo": "Polo",
    "oversize": "Oversize",
    "gildan-kids": "GILDAN KIDS",
  },
  "Hoodie": {
    "gildan": "GILDAN Hoodie",
    "premium-washed": "Premium Washed Hoodie",
    "jel-standard": "JEL Standard Hoodie",
    "jel-zipper": "JEL Zipper",
    "jel-standard-zipper": "JEL Standard Zipper",
    "gildan-bomber": "GILDAN Bomber",
  },
};

/** A product slug that is in the map AND names a visible catalog product. */
export function resolveProductSlug(slug: string): ProductType | null {
  const product = Object.prototype.hasOwnProperty.call(PRODUCT_SLUGS, slug) ? PRODUCT_SLUGS[slug] : undefined;
  if (!product) return null;
  if (!PRODUCTS.some((p) => p.type === product)) return null;
  if (HIDDEN_PRODUCTS.has(product)) return null;
  return product;
}

/** A brand slug that maps to a SUB_PRODUCTS string of this product, else null. */
export function resolveBrandSlug(product: ProductType, slug: string): string | null {
  const map = BRAND_SLUGS[product];
  if (!map || !Object.prototype.hasOwnProperty.call(map, slug)) return null;
  const brand = map[slug];
  return (SUB_PRODUCTS[product] ?? []).includes(brand) ? brand : null;
}

/** The brand a hand pick of this product starts on (same rule as setProduct). */
export function defaultBrandFor(product: ProductType): string {
  return catalog.getDefaultSubProduct(product);
}
