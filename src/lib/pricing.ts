// Pricing rules for all products
// Prices in GEL: [frontOnly, backPhoto, backText]

import type { ProductType } from "@/lib/catalog";

export type BackType = "none" | "photo" | "text";

interface PriceTier {
  frontOnly: number;
  backPhoto: number;
  backText: number;
}

// Prices keyed by subProduct (brand) name
const PRICES: Record<string, PriceTier> = {
  // T-Shirt brands
  "GILDAN":         { frontOnly: 35, backPhoto: 50, backText: 45 },
  "GILDAN HUMMER":  { frontOnly: 60, backPhoto: 75, backText: 70 },
  "TH":             { frontOnly: 45, backPhoto: 60, backText: 55 },
  "GIORDANO":       { frontOnly: 70, backPhoto: 85, backText: 80 },
  "JEL T-Shirt":    { frontOnly: 70, backPhoto: 85, backText: 80 },
  "Khundadze":      { frontOnly: 55, backPhoto: 70, backText: 65 },
  "Polo":           { frontOnly: 45, backPhoto: 60, backText: 55 },
  "NIKE":           { frontOnly: 100, backPhoto: 115, backText: 110 },
  "Oversize":       { frontOnly: 65, backPhoto: 80, backText: 75 },

  // Hoodie brands
  "GILDAN Hoodie":       { frontOnly: 75, backPhoto: 90, backText: 85 },
  "Premium Washed Hoodie":      { frontOnly: 95, backPhoto: 110, backText: 105 },
  "JEL Standard Hoodie": { frontOnly: 80, backPhoto: 95, backText: 90 },
  "JEL Standard Zipper": { frontOnly: 85, backPhoto: 100, backText: 95 },
  "JEL Zipper":          { frontOnly: 100, backPhoto: 115, backText: 110 },
  "GILDAN Bomber":       { frontOnly: 70, backPhoto: 95, backText: 90 },

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
  backType: BackType;
  isStudio: boolean;
}

export function calculatePrice(
  product: ProductType,
  subProduct: string,
  backType: BackType,
  isStudio: boolean,
): PriceBreakdown {
  // For standalone products (no sub-brands), key is the product type
  const key = subProduct === product ? product : subProduct;
  const tier = PRICES[key] || { frontOnly: 0, backPhoto: 0, backText: 0 };

  const basePrice = tier.frontOnly;
  let totalWithBack = basePrice;
  if (backType === "photo") totalWithBack = tier.backPhoto;
  else if (backType === "text") totalWithBack = tier.backText;

  const backExtra = totalWithBack - basePrice;
  const aiSurcharge = isStudio ? AI_SURCHARGE : 0;

  return {
    basePrice,
    backExtra,
    aiSurcharge,
    total: totalWithBack + aiSurcharge,
    backType,
    isStudio,
  };
}
