// DM orders — the bits of the site catalog an order needs that the sketch
// snapshot (catalogSnapshot.ts) does not carry. Edge functions cannot import
// from src/, so these are copies; src/test/socialOrderFlow.test.ts compares
// each one with the site's own value (toEqual), so a catalog change without a
// copy here fails CI.
//
//   BRAND_SIZES   ← src/lib/catalog.ts BRAND_SIZES (the site's size selector)
//   COLOR_KA      ← src/lib/i18n.ts translations.ge.colors
//   PRODUCT_KA    ← src/lib/i18n.ts translations.ge.products
//   SIZE_REQUIRED_WITHOUT_LIST ← SimplePage needsSize: "Phone Case" needs a
//                   size (the phone model) although BRAND_SIZES has no list

export const BRAND_SIZES: Record<string, string[]> = {
  "GILDAN": ["S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"],
  "Sol's": ["S", "M", "L", "XL", "XXL"],
  "GILDAN HUMMER": ["S", "M", "L", "XL", "XXL"],
  "TH": ["S", "M", "L", "XL", "XXL"],
  "JEL T-Shirt": ["S", "M", "L", "XL", "XXL", "XXXL"],
  "GIORDANO": ["S", "M", "L", "XL", "XXL", "XXXL"],
  "Khundadze": ["S", "M", "L", "XL", "XXL"],
  "NIKE": ["S", "M", "L", "XL", "XXL"],
  "Polo": ["S", "M", "L", "XL", "XXL", "XXXL"],
  "GILDAN KIDS": ["3/4 წელი", "5/6 წელი", "7/8 წელი", "9/11 წელი", "12/14 წელი"],
  "Sport Set": ["S", "M", "L", "XL", "XXL"],
  "GILDAN Hoodie": ["S", "M", "L", "XL", "XXL"],
  "Premium Washed Hoodie": ["S", "M", "L", "XL", "XXL"],
  "JEL Standard Hoodie": ["S", "M", "L", "XL", "XXL"],
  "JEL Zipper": ["S", "M", "L", "XL", "XXL"],
  "JEL Standard Zipper": ["S", "M", "L", "XL", "XXL"],
  "GILDAN Bomber": ["S", "M", "L", "XL", "XXL"],
};

export const SIZE_REQUIRED_WITHOUT_LIST: string[] = ["Phone Case"];

export const COLOR_KA: Record<string, string> = {
  "White": "თეთრი",
  "Black": "შავი",
  "Beige": "ბეჟი",
  "Light Gray": "ღია რუხი",
  "Light Gray Melange": "ღია რუხი მელანჟი",
  "Gray": "რუხი",
  "Cream": "კრემი",
  "Light Cream": "ღია კრემი",
  "Red": "წითელი",
  "Burgundy": "ბორდო",
  "Pink": "ვარდისფერი",
  "Orange": "ნარინჯისფერი",
  "Yellow": "ყვითელი",
  "Lime": "ლაიმი",
  "Green": "მწვანე",
  "Turquoise": "ფირუზი",
  "Light Blue": "ღია ცისფერი",
  "Blue": "ლურჯი",
  "Standard Blue": "სტ. ლურჯი",
  "Electric Blue": "ელექტრო",
  "Dark Navy": "მუქი ნავი",
  "Purple": "იასამნი",
  "Khaki": "ხაკი",
  "Brown": "ყავისფერი",
  "Sol's Khaki": "ხაკისფერი",
  "Sol's Pink": "ვარდისფერი",
  "Sol's Emerald": "მწვანე ზურმუხტი",
  "Sol's Electric": "ელ ლურჯი",
  "Sol's Navy": "მუქი ლურჯი",
  "Sol's Ultramarine": "ულტრამარინი",
};

export const PRODUCT_KA: Record<string, string> = {
  "T-Shirt": "მაისური",
  "Hoodie": "ჰუდი",
  "Tote Bag": "ჩანთა",
  "Cap": "კეპი",
  "Apron": "წინსაფარი",
  "Phone Case": "ქეისი",
  "Mug": "ჭიქა",
  "Sport": "სპორტული ფორმა",
};

export const colorKa = (c: string): string => COLOR_KA[c] ?? c;
export const productKa = (p: string): string => PRODUCT_KA[p] ?? p;

/** The sizes the site offers for a brand ([] = one size / no selector). */
export function sizesFor(subProduct: string): string[] {
  return BRAND_SIZES[subProduct] ?? [];
}

/** Does an order line of this product need a size at all? */
export function needsSize(product: string, subProduct: string): boolean {
  return sizesFor(subProduct).length > 0 || SIZE_REQUIRED_WITHOUT_LIST.includes(product);
}

// „წელი" is cut BEFORE upper-casing: toUpperCase maps Georgian to Mtavruli.
const normSize = (s: string) => s.trim().replace(/\s+/g, "").replace(/წელი$/u, "").toUpperCase();

/**
 * The customer's size → the site's spelling, or null when the brand has no
 * such size. „xl" → "XL", „2XL" → "XXL", „5/6" → "5/6 წელი". A product that
 * needs a size without a list (Phone Case: the model) takes any short text.
 */
export function resolveSize(product: string, subProduct: string, raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!text) return null;
  const list = sizesFor(subProduct);
  if (list.length === 0) return SIZE_REQUIRED_WITHOUT_LIST.includes(product) ? text.slice(0, 60) : null;
  let want = normSize(text);
  const nx = /^([2-5])XL$/.exec(want);
  if (nx) want = "X".repeat(Number(nx[1])) + "L";
  return list.find((s) => normSize(s) === want) ?? null;
}
