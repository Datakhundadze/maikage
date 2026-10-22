// Catalog SALE — ready-made catalog t-shirt designs sold on Sol's at a promo
// price, below the regular Sol's price in pricing.ts PRICES.
//
// THE ONE PLACE TO EDIT. Price, brand, label and end date live here; the
// design page (/design/:slug), the /designs banner and the FAQ all read this.
//
// Add-only by design: calculatePrice and PRICES stay byte-stable. The promo is
// applied ON TOP of calculatePrice's result by applyCatalogPromo, and only on
// the catalog design page — the constructor, landing pages, chatbot and the
// showroom keep charging/quoting the regular PRICES.
//
// Pure data + pure functions (no React, no Supabase): lib/faqContent.ts imports
// this, and the build-time prerender loads faqContent through Vite
// (scripts/lib/appModules.mjs).

import { PRICES, type PriceBreakdown } from "@/lib/pricing";

export interface CatalogPromoConfig {
  /** pricing.ts PRICES key (= catalog SUB_PRODUCTS name) the promo applies to. */
  subProduct: string;
  /** Promo unit price in GEL, front-only print. */
  price: number;
  /** ISO timestamp the promo ends (exclusive), or null for no end date. */
  endsAt: string | null;
  /** Badge text. */
  label: string;
}

export const CATALOG_PROMO: Readonly<CatalogPromoConfig> = Object.freeze({
  subProduct: "Sol's",
  price: 45,
  endsAt: null,
  label: "SALE",
});

/** Is the promo running at `now`? No end date = always on. An unparseable end date = off. */
export function isCatalogPromoActive(now: Date = new Date(), promo: CatalogPromoConfig = CATALOG_PROMO): boolean {
  if (promo.endsAt === null) return true;
  const end = Date.parse(promo.endsAt);
  if (Number.isNaN(end)) return false;
  return now.getTime() < end;
}

/** The promo brand's regular front-only price, straight from pricing.ts PRICES. */
export function catalogPromoRegularPrice(promo: CatalogPromoConfig = CATALOG_PROMO): number | undefined {
  return PRICES[promo.subProduct]?.frontOnly;
}

/**
 * Returns the breakdown with the promo price applied when ALL hold:
 *   - subProduct is the promo brand,
 *   - front-only print (front yes, back no), no AI-studio surcharge,
 *   - the promo is active,
 *   - the promo price is actually lower than the current total.
 * Otherwise returns the SAME breakdown object, unchanged.
 *
 * basePrice and total are both set to the promo price (backExtra and
 * aiSurcharge are 0 by the checks above), so basePrice + backExtra +
 * aiSurcharge === total still holds for any UI that lists line items.
 */
export function applyCatalogPromo(
  breakdown: PriceBreakdown,
  subProduct: string,
  now: Date = new Date(),
  promo: CatalogPromoConfig = CATALOG_PROMO,
): PriceBreakdown {
  if (subProduct !== promo.subProduct) return breakdown;
  if (!breakdown.hasFront || breakdown.hasBack || breakdown.isStudio) return breakdown;
  if (breakdown.backExtra !== 0 || breakdown.aiSurcharge !== 0) return breakdown;
  if (!isCatalogPromoActive(now, promo)) return breakdown;
  if (!(promo.price > 0) || promo.price >= breakdown.total) return breakdown;
  return { ...breakdown, basePrice: promo.price, total: promo.price };
}
