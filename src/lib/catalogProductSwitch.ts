// Product switcher for the catalog design page (/design/:slug): which
// garments a ready-made catalog design can be ordered on, how each chip is
// labelled, and what each one costs.
//
// Prices are NEVER typed here: every number comes from calculatePrice
// (pricing.ts PRICES, front-only, no back, no studio) passed through
// applyCatalogPromo — the exact pair the page's price box, add-to-cart and
// OrderDialog use, so a chip can't show a price checkout won't charge.
//
// Pure module (no React, no Supabase) so it is unit-testable.

import { catalog, SUB_PRODUCTS, type ProductColor, type ProductType } from "@/lib/catalog";
import { PRICES, calculatePrice, type PriceBreakdown } from "@/lib/pricing";
import { applyCatalogPromo } from "@/lib/catalogPromo";

interface SwitchableDef {
  type: ProductType;
  subProduct: string;
  /** Garment kind shown on the chip. */
  kindKa: string;
  /** Brand / line shown on the chip. */
  brand: string;
}

// Chip order: Sol's t-shirt first, then hoodies. Labels only — the price and
// availability are derived below.
const CANDIDATES: readonly SwitchableDef[] = [
  { type: "T-Shirt", subProduct: "Sol's", kindKa: "მაისური", brand: "Sol's" },
  { type: "Hoodie", subProduct: "GILDAN Hoodie", kindKa: "ჰუდი", brand: "GILDAN" },
  { type: "Hoodie", subProduct: "Premium Washed Hoodie", kindKa: "ჰუდი", brand: "Premium Washed" },
  { type: "Hoodie", subProduct: "JEL Standard Hoodie", kindKa: "ჰუდი", brand: "JEL Standard" },
  { type: "Hoodie", subProduct: "JEL Standard Zipper", kindKa: "ზიპ-ჰუდი", brand: "JEL Standard" },
  { type: "Hoodie", subProduct: "JEL Zipper", kindKa: "ზიპ-ჰუდი", brand: "JEL" },
  { type: "Hoodie", subProduct: "GILDAN Bomber", kindKa: "ბომბერი", brand: "GILDAN" },
];

/** A candidate is offered only if it is a real catalog sub-product, has a
 *  PRICES tier, and has a front mockup compositeDesignOnProduct can draw on. */
function isSupported(def: SwitchableDef): boolean {
  if (!(SUB_PRODUCTS[def.type] ?? []).includes(def.subProduct)) return false;
  if (!PRICES[def.subProduct] || !(PRICES[def.subProduct].frontOnly > 0)) return false;
  // Same rule as compositeDesignOnProduct's lookup (findImageForColor): some
  // colour of this sub-product must have a real FRONT photo — an exact match
  // is drawn as-is, otherwise it is tinted. findProduct is used instead of
  // findImageForColor only to avoid its WebP probe at module load.
  return catalog
    .getAvailableColors(def.type, def.subProduct)
    .some((c: ProductColor) => !!catalog.findProduct(def.type, def.subProduct, c, "front")?.imageUrl);
}

/** Statically supported options, in chip order. */
export const SWITCHABLE_PRODUCTS: readonly SwitchableDef[] = CANDIDATES.filter(isSupported);

/** Candidates dropped by isSupported (reported, never offered). */
export const UNSUPPORTED_SWITCH_CANDIDATES: readonly string[] = CANDIDATES
  .filter((d) => !isSupported(d))
  .map((d) => d.subProduct);

export const SWITCHABLE_SUB_PRODUCTS: readonly string[] = SWITCHABLE_PRODUCTS.map((d) => d.subProduct);

export function isSwitchableSubProduct(subProduct: string | null | undefined): boolean {
  return !!subProduct && SWITCHABLE_SUB_PRODUCTS.includes(subProduct);
}

export interface CatalogPrice {
  /** Regular price (pricing.ts), kept for the SALE strikethrough. */
  regular: PriceBreakdown;
  /** The price the page charges (regular with the catalog SALE applied). */
  final: PriceBreakdown;
  onSale: boolean;
}

/** Front-only, no back, no studio — the catalog design page's fixed config. */
export function catalogDesignPrice(type: string, subProduct: string, now: Date = new Date()): CatalogPrice {
  const regular = calculatePrice(type as ProductType, subProduct, true, false, false);
  const final = applyCatalogPromo(regular, subProduct, now);
  return { regular, final, onSale: final.total < regular.total };
}

/** Minimal products-row shape the switcher needs. */
export interface SwitchRow {
  id: string;
  type: string;
  sub_product: string | null;
}

export interface SwitchOption<R extends SwitchRow> {
  subProduct: string;
  kindKa: string;
  brand: string;
  row: R;
  price: CatalogPrice;
}

/**
 * Chips for a design: every supported option that has a products row (the
 * default product's row plus the active rows fetched for the switcher), in
 * chip order. Missing / inactive rows are simply absent — their chip hides.
 * Returns [] when the default product isn't switchable (e.g. a mug design),
 * so the page shows no switcher there.
 */
export function buildSwitchOptions<R extends SwitchRow>(
  defaultRow: R | null,
  rows: readonly R[],
  now: Date = new Date(),
): SwitchOption<R>[] {
  if (!defaultRow || !isSwitchableSubProduct(defaultRow.sub_product)) return [];
  const bySub = new Map<string, R>();
  for (const r of rows) {
    if (r.sub_product && !bySub.has(r.sub_product)) bySub.set(r.sub_product, r);
  }
  // The default row always wins for its own sub-product.
  bySub.set(defaultRow.sub_product as string, defaultRow);
  const out: SwitchOption<R>[] = [];
  for (const def of SWITCHABLE_PRODUCTS) {
    const row = bySub.get(def.subProduct);
    if (!row || row.type !== def.type) continue;
    const price = catalogDesignPrice(def.type, def.subProduct, now);
    if (!(price.final.total > 0)) continue;
    out.push({ subProduct: def.subProduct, kindKa: def.kindKa, brand: def.brand, row, price });
  }
  return out;
}
