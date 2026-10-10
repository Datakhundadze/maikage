// URL slug → catalog product id for the product landing routes (/hoodie, …).
//
// Kept apart from productSlugs.ts on purpose: App.tsx needs these keys to
// register its routes, and this file imports catalog.ts for its TYPE only
// (erased at build), so the catalog stays out of the entry bundle.
// productSlugs.ts re-exports this map and checks it against catalog.ts at
// runtime; src/test/productSlugs.test.ts fails if a slug here points at a
// product catalog.ts no longer has, or hides.

import type { ProductType } from "@/lib/catalog";

export const PRODUCT_SLUGS: Readonly<Record<string, ProductType>> = {
  "t-shirt": "T-Shirt",
  "hoodie": "Hoodie",
  "tote-bag": "Tote Bag",
  "cap": "Cap",
  "apron": "Apron",
  "phone-case": "Phone Case",
  "mug": "Mug",
};

/** Product slugs App.tsx registers as routes. */
export const LANDING_PRODUCT_SLUGS: readonly string[] = Object.keys(PRODUCT_SLUGS);
