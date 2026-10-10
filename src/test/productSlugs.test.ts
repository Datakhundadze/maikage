import { describe, expect, it } from "vitest";
import { PRODUCTS, SUB_PRODUCTS, HIDDEN_PRODUCTS } from "@/lib/catalog";
import {
  BRAND_SLUGS,
  LANDING_PRODUCT_SLUGS,
  PRODUCT_SLUGS,
  SLUG_PATTERN,
  defaultBrandFor,
  resolveBrandSlug,
  resolveProductSlug,
} from "@/lib/productSlugs";

describe("productSlugs ↔ catalog.ts", () => {
  it("every product slug points at an existing, visible catalog product", () => {
    for (const [slug, product] of Object.entries(PRODUCT_SLUGS)) {
      expect(SLUG_PATTERN.test(slug), `slug "${slug}"`).toBe(true);
      expect(PRODUCTS.some((p) => p.type === product), `${slug} → ${product} not in PRODUCTS`).toBe(true);
      expect(HIDDEN_PRODUCTS.has(product), `${slug} → ${product} is hidden`).toBe(false);
      expect(resolveProductSlug(slug)).toBe(product);
    }
  });

  it("every visible product has exactly one slug", () => {
    const visible = PRODUCTS.map((p) => p.type).filter((t) => !HIDDEN_PRODUCTS.has(t));
    for (const type of visible) {
      const slugs = Object.entries(PRODUCT_SLUGS).filter(([, p]) => p === type).map(([s]) => s);
      expect(slugs, `slugs for ${type}`).toHaveLength(1);
    }
    expect([...LANDING_PRODUCT_SLUGS].sort()).toEqual(Object.keys(PRODUCT_SLUGS).sort());
  });

  it("hidden products never resolve", () => {
    for (const hidden of HIDDEN_PRODUCTS) {
      expect(Object.values(PRODUCT_SLUGS)).not.toContain(hidden);
    }
    expect(resolveProductSlug("sport")).toBeNull();
    expect(resolveProductSlug("constructor")).toBeNull();
    expect(resolveProductSlug("__proto__")).toBeNull();
  });

  it("every brand slug points at an existing SUB_PRODUCTS string of its product", () => {
    for (const [product, map] of Object.entries(BRAND_SLUGS)) {
      for (const [slug, brand] of Object.entries(map ?? {})) {
        expect(SLUG_PATTERN.test(slug), `brand slug "${slug}"`).toBe(true);
        expect(SUB_PRODUCTS[product as keyof typeof SUB_PRODUCTS], `${product}/${slug}`).toContain(brand);
        expect(resolveBrandSlug(product as keyof typeof SUB_PRODUCTS, slug)).toBe(brand);
      }
    }
  });

  it("every brand of a routed product has exactly one slug", () => {
    for (const slug of LANDING_PRODUCT_SLUGS) {
      const product = PRODUCT_SLUGS[slug];
      const brands = SUB_PRODUCTS[product] ?? [];
      const mapped = Object.values(BRAND_SLUGS[product] ?? {});
      expect([...mapped].sort(), `brands of ${product}`).toEqual([...brands].sort());
    }
  });

  it("unknown or mismatched brand slugs resolve to null (caller falls back to the default)", () => {
    expect(resolveBrandSlug("Hoodie", "not-a-brand")).toBeNull();
    expect(resolveBrandSlug("Hoodie", "oversize")).toBeNull(); // a T-Shirt brand
    expect(resolveBrandSlug("Mug", "gildan")).toBeNull(); // product without brands
    expect(resolveBrandSlug("Hoodie", "__proto__")).toBeNull();
  });

  it("default brand is the first SUB_PRODUCTS entry, or the type for brandless products", () => {
    expect(defaultBrandFor("Hoodie")).toBe(SUB_PRODUCTS.Hoodie[0]);
    expect(defaultBrandFor("T-Shirt")).toBe(SUB_PRODUCTS["T-Shirt"][0]);
    expect(defaultBrandFor("Mug")).toBe("Mug");
  });
});
