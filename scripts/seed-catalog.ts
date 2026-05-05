// Re-seed the public.products table from src/lib/catalog.ts.
//
// The catalog migration (20260505000000_catalog_schema.sql) ships an inline
// snapshot of the catalog at the time it was authored. If catalog.ts grows
// new brands or sizes later, run this script to upsert the latest data.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/seed-catalog.ts
//
// Phone Case is intentionally skipped — Phase 1 spec.

import { createClient } from "@supabase/supabase-js";
import { SUB_PRODUCTS, BRAND_COLORS, BRAND_SIZES, COLORS, type ProductType } from "../src/lib/catalog";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const HEX_BY_COLOR = new Map(COLORS.map((c) => [c.name, c.hex] as const));
const SKIP_TYPES: ProductType[] = ["Phone Case"];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const displayNameKa = (type: ProductType, sub: string | null): string => {
  const typeKa: Record<ProductType, string> = {
    "T-Shirt": "მაისური",
    "Hoodie": "ჰუდი",
    "Tote Bag": "ჩანთა",
    "Cap": "ქეპი",
    "Apron": "წინსაფარი",
    "Phone Case": "ქეისი",
    "Mug": "ჭიქა",
    "Sport": "სპორტული კომპლექტი",
  };
  return sub ? `${sub} ${typeKa[type]}` : typeKa[type];
};

type Row = {
  slug: string;
  type: ProductType;
  sub_product: string | null;
  display_name_ka: string;
  display_name_en: string;
  sizes: string[];
  colors: { name: string; hex: string }[];
};

const rows: Row[] = [];
for (const [type, subs] of Object.entries(SUB_PRODUCTS) as [ProductType, string[]][]) {
  if (SKIP_TYPES.includes(type)) continue;

  const slugBase = slugify(type === "Sport" ? "" : type);

  if (subs.length === 0) {
    // Standalone products (Tote Bag, Cap, Apron, Mug)
    const colorNames = BRAND_COLORS[type] || [];
    rows.push({
      slug: slugBase,
      type,
      sub_product: null,
      display_name_ka: displayNameKa(type, null),
      display_name_en: type,
      sizes: BRAND_SIZES[type] || [],
      colors: colorNames.map((n) => ({ name: n, hex: HEX_BY_COLOR.get(n) || "#000000" })),
    });
  } else {
    for (const sub of subs) {
      const colorNames = BRAND_COLORS[sub] || [];
      const slug = type === "Sport" ? slugify(sub) : `${slugBase}-${slugify(sub)}`;
      rows.push({
        slug,
        type,
        sub_product: sub,
        display_name_ka: displayNameKa(type, sub),
        display_name_en: `${sub} ${type}`,
        sizes: BRAND_SIZES[sub] || [],
        colors: colorNames.map((n) => ({ name: n, hex: HEX_BY_COLOR.get(n) || "#000000" })),
      });
    }
  }
}

console.log(`[seed-catalog] Upserting ${rows.length} product rows…`);

const { error } = await supabase
  .from("products")
  .upsert(rows, { onConflict: "slug" });

if (error) {
  console.error("[seed-catalog] FAILED:", error);
  process.exit(1);
}

console.log(`[seed-catalog] Done. ${rows.length} rows upserted.`);
console.log("Phone Case skipped — Phase 1 (see catalog spec).");
