import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  PORTFOLIO_CATEGORY_ORDER,
  normalizePortfolioCategory,
  orderPortfolioCategories,
  portfolioCountLabel,
} from "@/lib/portfolioCategories";
import { LANDING_PHOTO_CATEGORY } from "@/hooks/useLandingPhotos";

const rows = (...cats: (string | null | undefined)[]) => cats.map((category) => ({ category }));

describe("orderPortfolioCategories", () => {
  it("returns nothing when no row has a category", () => {
    expect(orderPortfolioCategories([])).toEqual([]);
    expect(orderPortfolioCategories(rows(null, undefined, "", "   "))).toEqual([]);
  });

  it("follows the fixed order regardless of row order, with counts", () => {
    expect(orderPortfolioCategories(rows("ჩანთა", "მაისური", "ჰუდი", "მაისური", "სხვა", "მაისური", "ჩანთა"))).toEqual([
      { label: "მაისური", count: 3 },
      { label: "ჰუდი", count: 1 },
      { label: "ჩანთა", count: 2 },
      { label: "სხვა", count: 1 },
    ]);
  });

  it("hides fixed labels that have no items", () => {
    const labels = orderPortfolioCategories(rows("კეპი", "პოლო")).map((c) => c.label);
    expect(labels).toEqual(["პოლო", "კეპი"]);
  });

  it("puts unknown labels after the fixed ones, in first-seen order", () => {
    expect(orderPortfolioCategories(rows("ქურთუკი", "მაისური", "მაღაზია", "ქურთუკი", "წინსაფარი"))).toEqual([
      { label: "მაისური", count: 1 },
      { label: "წინსაფარი", count: 1 },
      { label: "ქურთუკი", count: 2 },
      { label: "მაღაზია", count: 1 },
    ]);
  });

  it("trims labels and skips uncategorised rows", () => {
    expect(orderPortfolioCategories(rows(" მაისური ", "მაისური", null, ""))).toEqual([{ label: "მაისური", count: 2 }]);
    expect(normalizePortfolioCategory("  ჰუდი ")).toBe("ჰუდი");
    expect(normalizePortfolioCategory(null)).toBe("");
  });

  it("the fixed order is the agreed list", () => {
    expect(PORTFOLIO_CATEGORY_ORDER).toEqual(["მაისური", "ჰუდი", "პოლო", "სპორტული ფორმა", "ჩანთა", "კეპი", "წინსაფარი", "სხვა"]);
  });

  it("every landing-photo label is a fixed chip label", () => {
    for (const label of Object.values(LANDING_PHOTO_CATEGORY)) {
      expect(PORTFOLIO_CATEGORY_ORDER).toContain(label);
    }
  });
});

describe("portfolioCountLabel", () => {
  it("is exact below 20 and rounded down to a ten with + from 20", () => {
    expect(portfolioCountLabel(0)).toBe("0 ნამუშევარი");
    expect(portfolioCountLabel(7)).toBe("7 ნამუშევარი");
    expect(portfolioCountLabel(19)).toBe("19 ნამუშევარი");
    expect(portfolioCountLabel(20)).toBe("20+ ნამუშევარი");
    expect(portfolioCountLabel(283)).toBe("280+ ნამუშევარი");
    expect(portfolioCountLabel(290)).toBe("290+ ნამუშევარი");
  });
});
