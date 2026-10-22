import { describe, expect, it } from "vitest";
import { calculatePrice, PRICES } from "@/lib/pricing";
import {
  CATALOG_PROMO,
  applyCatalogPromo,
  catalogPromoRegularPrice,
  isCatalogPromoActive,
  type CatalogPromoConfig,
} from "@/lib/catalogPromo";
import { FAQ_CATALOG_PROMO_SENTENCE, FAQ_GROUPS } from "@/lib/faqContent";

const NOW = new Date("2026-10-22T12:00:00Z");
const sols = () => calculatePrice("T-Shirt", "Sol's", true, false, false);

describe("CATALOG_PROMO config", () => {
  it("is Sol's at 45, no end date, labelled SALE", () => {
    expect(CATALOG_PROMO).toEqual({ subProduct: "Sol's", price: 45, endsAt: null, label: "SALE" });
  });

  it("is below the regular Sol's price read from PRICES", () => {
    expect(catalogPromoRegularPrice()).toBe(PRICES["Sol's"].frontOnly);
    expect(CATALOG_PROMO.price).toBeLessThan(PRICES["Sol's"].frontOnly);
  });
});

describe("isCatalogPromoActive", () => {
  const withEnd = (endsAt: string | null): CatalogPromoConfig => ({ ...CATALOG_PROMO, endsAt });

  it("no end date → active", () => {
    expect(isCatalogPromoActive(NOW)).toBe(true);
  });

  it("before / at / after the end date", () => {
    expect(isCatalogPromoActive(NOW, withEnd("2026-10-23T00:00:00Z"))).toBe(true);
    expect(isCatalogPromoActive(new Date("2026-10-23T00:00:00Z"), withEnd("2026-10-23T00:00:00Z"))).toBe(false);
    expect(isCatalogPromoActive(NOW, withEnd("2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("unparseable end date → inactive (never an accidental open-ended sale)", () => {
    expect(isCatalogPromoActive(NOW, withEnd("not a date"))).toBe(false);
  });
});

describe("applyCatalogPromo", () => {
  it("Sol's front-only → 45, line items still add up", () => {
    const b = applyCatalogPromo(sols(), "Sol's", NOW);
    expect(b.total).toBe(45);
    expect(b.basePrice).toBe(45);
    expect(b.basePrice + b.backExtra + b.aiSurcharge).toBe(b.total);
    expect(b).toMatchObject({ hasFront: true, hasBack: false, isStudio: false, backExtra: 0, aiSurcharge: 0 });
  });

  it("does not mutate the input breakdown", () => {
    const input = sols();
    const before = { ...input };
    applyCatalogPromo(input, "Sol's", NOW);
    expect(input).toEqual(before);
  });

  it.each([
    ["GILDAN", calculatePrice("T-Shirt", "GILDAN", true, false, false)],
    ["GILDAN Hoodie", calculatePrice("Hoodie", "GILDAN Hoodie", true, false, false)],
    ["Premium Washed Hoodie", calculatePrice("Hoodie", "Premium Washed Hoodie", true, false, false)],
  ])("other brand %s → unchanged", (sub, b) => {
    expect(applyCatalogPromo(b, sub, NOW)).toBe(b);
  });

  it("Sol's with back print → unchanged", () => {
    const b = calculatePrice("T-Shirt", "Sol's", true, true, false);
    expect(applyCatalogPromo(b, "Sol's", NOW)).toBe(b);
  });

  it("Sol's AI studio → unchanged", () => {
    const b = calculatePrice("T-Shirt", "Sol's", true, false, true);
    expect(applyCatalogPromo(b, "Sol's", NOW)).toBe(b);
  });

  it("Sol's back-only → unchanged", () => {
    const b = calculatePrice("T-Shirt", "Sol's", false, true, false);
    expect(applyCatalogPromo(b, "Sol's", NOW)).toBe(b);
  });

  it("expired promo → unchanged", () => {
    const b = sols();
    expect(applyCatalogPromo(b, "Sol's", NOW, { ...CATALOG_PROMO, endsAt: "2026-01-01T00:00:00Z" })).toBe(b);
  });

  it("never raises a price", () => {
    const b = sols();
    expect(applyCatalogPromo(b, "Sol's", NOW, { ...CATALOG_PROMO, price: 99 })).toBe(b);
  });
});

describe("FAQ sentence", () => {
  it("is David's exact text, appended to the T-shirt answer", () => {
    expect(FAQ_CATALOG_PROMO_SENTENCE).toBe(" კატალოგიდან შეკვეთისას Sol's მაისური ფასდაკლებით 45₾ ღირს.");
    const a = FAQ_GROUPS[0].items.find((i) => i.q === "რა ღირს მაისურზე ბეჭდვა?")!.a;
    expect(a.endsWith(FAQ_CATALOG_PROMO_SENTENCE)).toBe(true);
    expect(a).toContain(`Sol's ${PRICES["Sol's"].frontOnly}₾`);
  });
});
