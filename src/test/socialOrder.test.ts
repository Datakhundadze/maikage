import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { calculatePrice as siteCalc, PRICES } from "@/lib/pricing";
import { BAG_FEE as SITE_BAG_FEE } from "@/lib/fees";
import { calculatePrice as copyCalc } from "../../supabase/functions/meta-webhook/pricingCopy";
import { BAG_FEE, DELIVERY_PRICES, orderTotals } from "../../supabase/functions/meta-webhook/orderMath";

const root = path.resolve(__dirname, "../..");
const IMP = 'import type { ProductType } from "@/lib/catalog";';

describe("pricingCopy stays identical to src/lib/pricing.ts", () => {
  it("byte-identical below the header, except the one import line", () => {
    const original = readFileSync(path.join(root, "src/lib/pricing.ts"), "utf8");
    const copy = readFileSync(path.join(root, "supabase/functions/meta-webhook/pricingCopy.ts"), "utf8");
    const body = copy.slice(copy.indexOf("// ── end of header ──\n") + "// ── end of header ──\n".length);
    expect(body).toBe(original.replace(IMP, `type ProductType = string; // was: ${IMP}`));
  });

  it("same totals for every tier, side combination, size and studio flag", () => {
    for (const key of Object.keys(PRICES)) {
      for (const [f, b] of [[true, false], [false, true], [true, true]] as const) {
        for (const s of [false, true]) {
          for (const size of ["small", "big"] as const) {
            expect(copyCalc(key, key, f, b, s, size)).toEqual(siteCalc(key as never, key, f, b, s, size));
          }
        }
      }
    }
  });
});

describe("order math matches the site checkout", () => {
  it("delivery prices and bag fee equal the site's", () => {
    const dialog = readFileSync(path.join(root, "src/components/OrderDialog.tsx"), "utf8");
    for (const [k, v] of Object.entries(DELIVERY_PRICES)) expect(dialog).toMatch(new RegExp(`${k}:\\s*${v},`));
    expect(BAG_FEE).toBe(SITE_BAG_FEE);
  });

  it("two items + courier: per-item prices, delivery and bag once", () => {
    const t = orderTotals([
      { product: "T-Shirt", subProduct: "GILDAN", hasFront: true, hasBack: true, isStudio: false, backSize: "big", quantity: 2 },
      { product: "Hoodie", subProduct: "GILDAN Hoodie", hasFront: false, hasBack: true, isStudio: false, quantity: 1 },
    ], "courier_tbilisi");
    const p1 = siteCalc("T-Shirt", "GILDAN", true, true, false, "big").total;
    const p2 = siteCalc("Hoodie", "GILDAN Hoodie", false, true, false).total;
    expect(t.unitPrices).toEqual([p1, p2]);
    expect(t.total).toBe(p1 * 2 + p2 + DELIVERY_PRICES.courier_tbilisi + SITE_BAG_FEE);
  });
});
