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

import { catalog, COLORS, SUB_PRODUCTS, type ProductColor, type ProductType } from "@/lib/catalog";
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
// availability are derived below. Zip hoodies (JEL Zipper, JEL Standard
// Zipper) are deliberately absent: the zipper runs down the front, so a
// front print can't be made on them (owner decision, 2026-10-22).
const CANDIDATES: readonly SwitchableDef[] = [
  { type: "T-Shirt", subProduct: "Sol's", kindKa: "მაისური", brand: "Sol's" },
  { type: "Hoodie", subProduct: "GILDAN Hoodie", kindKa: "ჰუდი", brand: "GILDAN" },
  { type: "Hoodie", subProduct: "Premium Washed Hoodie", kindKa: "ჰუდი", brand: "Premium Washed" },
  { type: "Hoodie", subProduct: "JEL Standard Hoodie", kindKa: "ჰუდი", brand: "JEL Standard" },
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

// ── Colour on product switch ───────────────────────────────────────────────

/** A palette entry: a colour name, or a swatch {name, hex} (hex used only
 *  when the name isn't in catalog COLORS, e.g. admin products.colors). */
export type PaletteColour = string | { name: string; hex?: string | null };

const paletteName = (c: PaletteColour): string => (typeof c === "string" ? c : c.name);

function hexFor(name: string, fallbackHex?: string | null): string | null {
  const entry = COLORS.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return entry?.hex ?? fallbackHex ?? null;
}

/** WCAG relative luminance (0 = black, 1 = white) of a #RRGGBB hex. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// Luminance where black and white text have equal contrast — above it a
// colour counts as "light" (tie-break prefers White), below as "dark" (Black).
const LIGHT_DARK_SPLIT = 0.179;
const TIE_EPSILON = 0.005;

/**
 * Colour to show after switching to a product with `palette`.
 *  a) the customer manually picked `manualColour` and the palette has it
 *     (case-insensitive) → keep it;
 *  b) otherwise derive from the design's DEFAULT colour (never from the
 *     current, possibly already-substituted one, so it can't drift): the
 *     palette's own entry for it if present, else the palette colour whose
 *     luminance is closest to the default's. Ties prefer White for a light
 *     default and Black for a dark one, then the lighter / darker colour,
 *     then palette order.
 * A missing / unknown default counts as White (normalizeColor's rule).
 * Returns the palette's own spelling; "White" for an empty palette.
 */
export function pickColourForProduct(
  defaultColour: string | null | undefined,
  palette: readonly PaletteColour[],
  manualColour?: string | null,
): string {
  const names = palette.map(paletteName);
  if (names.length === 0) return "White";
  const find = (want: string | null | undefined) =>
    want ? names.find((n) => n.toLowerCase() === want.toLowerCase()) : undefined;

  const manual = find(manualColour);
  if (manual) return manual;

  const exact = find(defaultColour);
  if (exact) return exact;

  const defaultHex = (defaultColour && hexFor(defaultColour)) || "#FFFFFF";
  const target = relativeLuminance(defaultHex);
  const light = target >= LIGHT_DARK_SPLIT;
  const anchor = light ? "white" : "black";

  const scored = palette.map((c, i) => {
    const name = paletteName(c);
    const hex = hexFor(name, typeof c === "string" ? null : c.hex);
    const lum = hex ? relativeLuminance(hex) : null;
    return { name, i, lum, dist: lum === null ? Infinity : Math.abs(lum - target) };
  });
  scored.sort((a, b) => {
    if (Math.abs(a.dist - b.dist) > TIE_EPSILON) return a.dist - b.dist;
    const aa = a.name.toLowerCase() === anchor ? 0 : 1;
    const ba = b.name.toLowerCase() === anchor ? 0 : 1;
    if (aa !== ba) return aa - ba;
    if (a.lum !== null && b.lum !== null && a.lum !== b.lum) return light ? b.lum - a.lum : a.lum - b.lum;
    return a.i - b.i;
  });
  return scored[0].name;
}
