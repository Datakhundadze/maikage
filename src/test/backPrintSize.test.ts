// Back-print size pricing: small back → tier.backText, big back → tier.backPhoto,
// charged only when BOTH sides have content. All numbers come from PRICES.
import { describe, expect, it } from "vitest";
import { calculatePrice, getBackPrintExtras, PRICES } from "@/lib/pricing";
import type { ProductType } from "@/lib/catalog";

const CASES: { product: ProductType; sub: string }[] = [
  { product: "T-Shirt", sub: "GILDAN" },
  { product: "Hoodie", sub: "GILDAN Hoodie" },
];

describe("calculatePrice — back print size", () => {
  for (const { product, sub } of CASES) {
    const tier = PRICES[sub];

    describe(sub, () => {
      it("front-only = frontOnly, no backSize key", () => {
        const b = calculatePrice(product, sub, true, false, false);
        expect(b.total).toBe(tier.frontOnly);
        expect(b.backExtra).toBe(0);
        expect("backSize" in b).toBe(false);
        // backSize param is irrelevant without both sides
        expect(calculatePrice(product, sub, true, false, false, "small")).toEqual(b);
      });

      it("both + small = frontOnly + (backText − frontOnly)", () => {
        const b = calculatePrice(product, sub, true, true, false, "small");
        expect(b.backExtra).toBe(tier.backText - tier.frontOnly);
        expect(b.total).toBe(tier.backText);
        expect(b.backSize).toBe("small");
      });

      it("both + big = backPhoto", () => {
        const b = calculatePrice(product, sub, true, true, false, "big");
        expect(b.backExtra).toBe(tier.backPhoto - tier.frontOnly);
        expect(b.total).toBe(tier.backPhoto);
        expect(b.backSize).toBe("big");
      });

      it("back-only stays single-sided at frontOnly regardless of size", () => {
        for (const size of ["small", "big"] as const) {
          const b = calculatePrice(product, sub, false, true, false, size);
          expect(b.total).toBe(tier.frontOnly);
          expect(b.backExtra).toBe(0);
          expect("backSize" in b).toBe(false);
        }
      });

      it("default param = big (back-compat with 5-arg callers)", () => {
        const legacy = calculatePrice(product, sub, true, true, false);
        expect(legacy).toEqual(calculatePrice(product, sub, true, true, false, "big"));
        expect(legacy.total).toBe(tier.backPhoto);
      });

      it("AI surcharge still stacks on top", () => {
        const plain = calculatePrice(product, sub, true, true, false, "small");
        const studio = calculatePrice(product, sub, true, true, true, "small");
        expect(studio.total - plain.total).toBe(studio.aiSurcharge);
      });

      it("getBackPrintExtras matches the tier", () => {
        expect(getBackPrintExtras(product, sub)).toEqual({
          small: tier.backText - tier.frontOnly,
          big: tier.backPhoto - tier.frontOnly,
        });
      });
    });
  }

  it("getBackPrintExtras is null where sizes cost the same (picker hidden)", () => {
    for (const product of ["Mug", "Cap", "Apron", "Phone Case"] as ProductType[]) {
      const tier = PRICES[product];
      expect(tier.backText).toBe(tier.backPhoto);
      expect(getBackPrintExtras(product, product)).toBeNull();
    }
    expect(getBackPrintExtras("T-Shirt", "__unknown__")).toBeNull();
  });
});
