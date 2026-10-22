// Product switcher on /design/:slug: which chips exist, their order, and that
// every chip price is calculatePrice(front-only) + applyCatalogPromo — the
// same numbers the price box, cart and OrderDialog charge.

import { describe, it, expect } from "vitest";
import { PRICES, calculatePrice } from "@/lib/pricing";
import { CATALOG_PROMO, applyCatalogPromo } from "@/lib/catalogPromo";
import {
  SWITCHABLE_SUB_PRODUCTS,
  UNSUPPORTED_SWITCH_CANDIDATES,
  buildSwitchOptions,
  catalogDesignPrice,
  isSwitchableSubProduct,
  type SwitchRow,
} from "@/lib/catalogProductSwitch";

const NOW = new Date("2026-10-22T12:00:00Z");
const HOODIES = [
  "GILDAN Hoodie",
  "Premium Washed Hoodie",
  "JEL Standard Hoodie",
  "JEL Standard Zipper",
  "JEL Zipper",
  "GILDAN Bomber",
];

const row = (sub: string): SwitchRow => ({
  id: `id-${sub}`,
  type: sub === "Sol's" ? "T-Shirt" : "Hoodie",
  sub_product: sub,
});

describe("switchable products", () => {
  it("offers Sol's first, then every hoodie line, all with mockup support", () => {
    expect(SWITCHABLE_SUB_PRODUCTS).toEqual(["Sol's", ...HOODIES]);
    expect(UNSUPPORTED_SWITCH_CANDIDATES).toEqual([]);
  });

  it("does not offer other garments", () => {
    expect(isSwitchableSubProduct("GILDAN")).toBe(false);
    expect(isSwitchableSubProduct(null)).toBe(false);
  });
});

describe("catalogDesignPrice (chip / price box / cart / OrderDialog)", () => {
  it("Sol's → 45 on SALE, regular 50 from PRICES", () => {
    const p = catalogDesignPrice("T-Shirt", "Sol's", NOW);
    expect(p.regular.total).toBe(PRICES["Sol's"].frontOnly);
    expect(p.regular.total).toBe(50);
    expect(p.final.total).toBe(CATALOG_PROMO.price);
    expect(p.final.total).toBe(45);
    expect(p.onSale).toBe(true);
    expect(p.final.basePrice + p.final.backExtra + p.final.aiSurcharge).toBe(p.final.total);
  });

  it.each(HOODIES)("%s → PRICES front-only, no SALE", (sub) => {
    const p = catalogDesignPrice("Hoodie", sub, NOW);
    expect(p.final.total).toBe(PRICES[sub].frontOnly);
    expect(p.regular.total).toBe(PRICES[sub].frontOnly);
    expect(p.onSale).toBe(false);
    expect(p.final).toEqual(calculatePrice("Hoodie", sub, true, false, false));
  });

  it("is exactly the page's previous formula for the default product", () => {
    for (const sub of ["Sol's", ...HOODIES]) {
      const type = sub === "Sol's" ? "T-Shirt" : "Hoodie";
      const legacy = applyCatalogPromo(calculatePrice(type, sub, true, false, false), sub, NOW);
      expect(catalogDesignPrice(type, sub, NOW).final).toEqual(legacy);
    }
  });
});

describe("buildSwitchOptions", () => {
  it("lists only options that have a row, in chip order, with their prices", () => {
    const opts = buildSwitchOptions(row("Sol's"), [row("GILDAN Bomber"), row("GILDAN Hoodie")], NOW);
    expect(opts.map((o) => o.subProduct)).toEqual(["Sol's", "GILDAN Hoodie", "GILDAN Bomber"]);
    expect(opts.map((o) => o.price.final.total)).toEqual([45, PRICES["GILDAN Hoodie"].frontOnly, PRICES["GILDAN Bomber"].frontOnly]);
    expect(opts.map((o) => o.kindKa)).toEqual(["მაისური", "ჰუდი", "ბომბერი"]);
  });

  it("labels zip hoodies", () => {
    const opts = buildSwitchOptions(row("JEL Zipper"), [row("JEL Standard Zipper")], NOW);
    expect(opts.map((o) => `${o.kindKa} · ${o.brand}`)).toEqual(["ზიპ-ჰუდი · JEL Standard", "ზიპ-ჰუდი · JEL"]);
  });

  it("hoodie default: still offers Sol's and the other hoodies", () => {
    const all = ["Sol's", ...HOODIES].map(row);
    const opts = buildSwitchOptions(row("GILDAN Hoodie"), all, NOW);
    expect(opts.map((o) => o.subProduct)).toEqual(["Sol's", ...HOODIES]);
  });

  it("the default row is always present even if the variants query returned nothing", () => {
    expect(buildSwitchOptions(row("Sol's"), [], NOW).map((o) => o.subProduct)).toEqual(["Sol's"]);
  });

  it("no switcher for a non-switchable default (e.g. a GILDAN t-shirt design)", () => {
    expect(buildSwitchOptions({ id: "g", type: "T-Shirt", sub_product: "GILDAN" }, [row("Sol's")], NOW)).toEqual([]);
    expect(buildSwitchOptions(null, [row("Sol's")], NOW)).toEqual([]);
  });

  it("ignores a row whose type doesn't match the catalog type", () => {
    const bad: SwitchRow = { id: "x", type: "T-Shirt", sub_product: "GILDAN Hoodie" };
    expect(buildSwitchOptions(row("Sol's"), [bad], NOW).map((o) => o.subProduct)).toEqual(["Sol's"]);
  });
});
