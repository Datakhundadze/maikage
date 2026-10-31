// ⚠️ COPY of src/lib/pricing.ts, byte-for-byte below this header except the one
// import line (edge functions cannot import from src/; ProductType is a plain
// string here). pricing.ts is byte-stable and must not be edited to share it.
// If it changes, re-copy it. src/test/socialOrder.test.ts asserts the copy
// matches the original (with that one substitution) so drift fails CI.
// ── end of header ──
// Pricing rules for all products
// Prices in GEL: [frontOnly, backPhoto, backText]

type ProductType = string; // was: import type { ProductType } from "@/lib/catalog";

export type BackType = "none" | "photo" | "text";

// Size of the BACK print when both sides carry a design. "small" = lettering /
// small logo, charged at tier.backText; "big" = large image/print, charged at
// tier.backPhoto. Default "big" keeps every pre-existing caller byte-identical.
export type BackPrintSize = "small" | "big";

interface PriceTier {
  frontOnly: number;
  backPhoto: number;
  backText: number;
}

// Prices keyed by subProduct (brand) name. Exported read-only for the FAQ
// (lib/faqContent.ts), which quotes these numbers instead of retyping them.
export const PRICES: Record<string, PriceTier> = {
  // T-Shirt brands
  "GILDAN":         { frontOnly: 35, backPhoto: 50, backText: 45 },
  "Sol's":          { frontOnly: 50, backPhoto: 65, backText: 60 },
  "GILDAN HUMMER":  { frontOnly: 60, backPhoto: 75, backText: 70 },
  "TH":             { frontOnly: 45, backPhoto: 60, backText: 55 },
  "GIORDANO":       { frontOnly: 70, backPhoto: 85, backText: 80 },
  "JEL T-Shirt":    { frontOnly: 70, backPhoto: 85, backText: 80 },
  "Khundadze":      { frontOnly: 55, backPhoto: 70, backText: 65 },
  "Polo":           { frontOnly: 45, backPhoto: 60, backText: 55 },
  "NIKE":           { frontOnly: 100, backPhoto: 115, backText: 110 },
  "Oversize":       { frontOnly: 70, backPhoto: 85, backText: 80 },
  "GILDAN KIDS":    { frontOnly: 35, backPhoto: 50, backText: 45 },

  // Hoodie brands
  "GILDAN Hoodie":       { frontOnly: 80, backPhoto: 95, backText: 90 },
  "Premium Washed Hoodie":      { frontOnly: 95, backPhoto: 110, backText: 105 },
  "JEL Standard Hoodie": { frontOnly: 85, backPhoto: 100, backText: 95 },
  "JEL Standard Zipper": { frontOnly: 95, backPhoto: 110, backText: 105 },
  "JEL Zipper":          { frontOnly: 105, backPhoto: 120, backText: 115 },
  "GILDAN Bomber":       { frontOnly: 70, backPhoto: 85, backText: 80 },

  // Sport
  "Sport Set": { frontOnly: 65, backPhoto: 80, backText: 75 },

  // Other products (keyed by product type since no sub-brands)
  "Tote Bag":    { frontOnly: 35, backPhoto: 50, backText: 45 },
  "Apron":       { frontOnly: 45, backPhoto: 45, backText: 45 },
  "Mug":         { frontOnly: 25, backPhoto: 25, backText: 25 },
  "Cap":         { frontOnly: 25, backPhoto: 25, backText: 25 },
  "Phone Case":  { frontOnly: 20, backPhoto: 20, backText: 20 },
};

const AI_SURCHARGE = 5;

export interface PriceBreakdown {
  basePrice: number;
  backExtra: number;
  aiSurcharge: number;
  total: number;
  hasFront: boolean;
  hasBack: boolean;
  isStudio: boolean;
  /** Back print size that was charged. Present ONLY when both sides have
   *  content (the only case a back surcharge applies), so front-only /
   *  back-only breakdowns keep exactly their previous shape. */
  backSize?: BackPrintSize;
}

export function calculatePrice(
  product: ProductType,
  subProduct: string,
  hasFront: boolean,
  hasBack: boolean,
  isStudio: boolean,
  backSize: BackPrintSize = "big",
): PriceBreakdown {
  // For standalone products (no sub-brands), key is the product type
  const key = subProduct === product ? product : subProduct;
  const tier = PRICES[key] || { frontOnly: 0, backPhoto: 0, backText: 0 };

  const basePrice = tier.frontOnly;
  // Charge the second-side surcharge only when BOTH sides have content.
  // Back-only or front-only orders pay just the base price.
  // The surcharge depends on the back print size: small → backText, big → backPhoto.
  const bothSides = hasFront && hasBack;
  const backExtra = bothSides
    ? (backSize === "small" ? tier.backText : tier.backPhoto) - tier.frontOnly
    : 0;
  const aiSurcharge = isStudio ? AI_SURCHARGE : 0;

  return {
    basePrice,
    backExtra,
    aiSurcharge,
    total: basePrice + backExtra + aiSurcharge,
    hasFront,
    hasBack,
    isStudio,
    ...(bothSides ? { backSize } : {}),
  };
}

/** Back-print surcharges (₾ over the front-only price) for the size picker,
 *  read from the same PRICES tier calculatePrice charges. Returns null when
 *  the product has no size distinction (backText === backPhoto, e.g. Mug,
 *  Cap, Apron, Phone Case) or no tier at all — the picker is then hidden. */
export function getBackPrintExtras(
  product: ProductType,
  subProduct: string,
): { small: number; big: number } | null {
  const key = subProduct === product ? product : subProduct;
  const tier = PRICES[key];
  if (!tier || tier.backText === tier.backPhoto) return null;
  return { small: tier.backText - tier.frontOnly, big: tier.backPhoto - tier.frontOnly };
}
