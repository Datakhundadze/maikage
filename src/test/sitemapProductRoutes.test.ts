import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_SLUGS, LANDING_PRODUCT_SLUGS, PRODUCT_SLUGS } from "@/lib/productSlugs";

// The sitemap edge function cannot import from src/, so it carries a copy of
// the product landing routes. This test reads that copy straight from the
// function's source and fails when it drifts from the slug maps the app's
// routes are built from.

const SITEMAP = path.resolve(__dirname, "../../supabase/functions/sitemap/index.ts");

function sitemapProductRoutes(): { loc: string; priority: string; changefreq: string }[] {
  const src = readFileSync(SITEMAP, "utf8");
  const block = src.match(/\/\/ BEGIN product-routes\n([\s\S]*?)\n\s*\/\/ END product-routes/);
  if (!block) throw new Error("product-routes block not found in sitemap/index.ts");
  return [...block[1].matchAll(/\{\s*loc:\s*"([^"]+)",\s*priority:\s*"([^"]+)",\s*changefreq:\s*"([^"]+)"\s*\}/g)].map(
    (m) => ({ loc: m[1], priority: m[2], changefreq: m[3] }),
  );
}

function expectedRoutes(): { products: string[]; brands: string[] } {
  const products = LANDING_PRODUCT_SLUGS.map((s) => `/${s}`);
  const brands = LANDING_PRODUCT_SLUGS.flatMap((s) =>
    Object.keys(BRAND_SLUGS[PRODUCT_SLUGS[s]] ?? {}).map((b) => `/${s}/${b}`),
  );
  return { products, brands };
}

describe("sitemap product landing routes ↔ productSlugs.ts", () => {
  const entries = sitemapProductRoutes();
  const locs = entries.map((e) => e.loc);
  const { products, brands } = expectedRoutes();

  it("lists exactly every product and brand route, once each", () => {
    expect([...locs].sort()).toEqual([...products, ...brands].sort());
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("product routes rank above brand routes; no trailing slashes", () => {
    const priority = (loc: string) => Number(entries.find((e) => e.loc === loc)!.priority);
    const lowestProduct = Math.min(...products.map(priority));
    const highestBrand = Math.max(...brands.map(priority));
    expect(lowestProduct).toBeGreaterThan(highestBrand);
    for (const loc of locs) expect(loc.endsWith("/")).toBe(false);
  });
});
