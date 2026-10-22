import { describe, it, expect } from "vitest";
import {
  pickDefaultCatalogProductId,
  DEFAULT_CATALOG_PRODUCT_SLUG,
  DEFAULT_CATALOG_COLOR,
} from "@/components/admin/catalog/defaultCatalogProduct";
import { BRAND_COLORS } from "@/lib/catalog";

// Same order the admin dialogs fetch in: type ASC, display_order ASC —
// Hoodie sorts before T-Shirt, which is how designs ended up on hoodie-gildan.
const PRODUCTS = [
  { id: "apron", type: "Apron", slug: "apron" },
  { id: "hoodie", type: "Hoodie", slug: "hoodie-gildan" },
  { id: "sols", type: "T-Shirt", slug: "tshirt-sols" },
  { id: "gildan", type: "T-Shirt", slug: "tshirt-gildan" },
];

describe("pickDefaultCatalogProductId", () => {
  it("picks Sol's by slug", () => {
    expect(DEFAULT_CATALOG_PRODUCT_SLUG).toBe("tshirt-sols");
    expect(pickDefaultCatalogProductId(PRODUCTS)).toBe("sols");
  });

  it("picks Sol's even when it is not the first T-Shirt in the list", () => {
    const reordered = [PRODUCTS[3], PRODUCTS[1], PRODUCTS[2]];
    expect(pickDefaultCatalogProductId(reordered)).toBe("sols");
  });

  it("falls back to the first T-Shirt when Sol's is missing", () => {
    expect(pickDefaultCatalogProductId(PRODUCTS.filter((p) => p.id !== "sols"))).toBe("gildan");
  });

  it("falls back to the first product, then empty", () => {
    expect(pickDefaultCatalogProductId([PRODUCTS[0], PRODUCTS[1]])).toBe("apron");
    expect(pickDefaultCatalogProductId([])).toBe("");
  });

  it("default colour is a valid Sol's colour", () => {
    expect(BRAND_COLORS["Sol's"]).toContain(DEFAULT_CATALOG_COLOR);
  });
});
