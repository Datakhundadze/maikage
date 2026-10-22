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
  pickColourForProduct,
  relativeLuminance,
  type SwitchRow,
} from "@/lib/catalogProductSwitch";
import { BRAND_COLORS, COLORS } from "@/lib/catalog";

const NOW = new Date("2026-10-22T12:00:00Z");
const HOODIES = [
  "GILDAN Hoodie",
  "Premium Washed Hoodie",
  "JEL Standard Hoodie",
  "GILDAN Bomber",
];
const ZIP_HOODIES = ["JEL Standard Zipper", "JEL Zipper"];

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

  it("never offers zip hoodies (zipper on the front — no front print)", () => {
    for (const z of ZIP_HOODIES) {
      expect(isSwitchableSubProduct(z)).toBe(false);
      expect(SWITCHABLE_SUB_PRODUCTS).not.toContain(z);
    }
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

  it("drops zip-hoodie rows even if the query returns them", () => {
    const opts = buildSwitchOptions(row("Sol's"), ZIP_HOODIES.map(row), NOW);
    expect(opts.map((o) => o.subProduct)).toEqual(["Sol's"]);
  });

  it("no switcher on a zip-hoodie default", () => {
    for (const z of ZIP_HOODIES) {
      expect(buildSwitchOptions(row(z), [row("Sol's"), row("GILDAN Hoodie")], NOW)).toEqual([]);
    }
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

describe("pickColourForProduct (colour after a product switch)", () => {
  const palette = (sub: string) => BRAND_COLORS[sub];

  it("luminance sanity", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("default White (vepkhistqaosani): never Black where a lighter colour exists", () => {
    expect(pickColourForProduct("White", palette("Sol's"))).toBe("White");
    expect(pickColourForProduct("White", palette("GILDAN Hoodie"))).toBe("White");
    expect(pickColourForProduct("White", palette("JEL Standard Hoodie"))).toBe("White");
    expect(pickColourForProduct("White", palette("GILDAN Bomber"))).toBe("White");
    // Premium Washed has no White: Black, Gray, Khaki, Pink, Purple → the lightest.
    expect(pickColourForProduct("White", palette("Premium Washed Hoodie"))).toBe("Khaki");
  });

  it("default Black: Black wherever available", () => {
    for (const sub of ["Sol's", ...HOODIES]) {
      expect(pickColourForProduct("Black", palette(sub))).toBe("Black");
    }
  });

  it("is case-insensitive and returns the palette's spelling", () => {
    expect(pickColourForProduct("white", palette("GILDAN Bomber"))).toBe("White");
    expect(pickColourForProduct("WHITE", ["Black", "white"])).toBe("white");
  });

  it("does not drift: Sol's → Premium Washed → JEL Standard → Bomber stays light", () => {
    // The page derives every switch from the design default, not the current colour.
    const seq = ["Premium Washed Hoodie", "JEL Standard Hoodie", "GILDAN Bomber", "Sol's"].map((s) =>
      pickColourForProduct("White", palette(s), null),
    );
    expect(seq).toEqual(["Khaki", "White", "White", "White"]);
  });

  it("manual pick kept when the new product has it, else back to the default rule", () => {
    expect(pickColourForProduct("White", palette("JEL Standard Hoodie"), "Red")).toBe("Red");
    expect(pickColourForProduct("White", palette("JEL Standard Hoodie"), "Black")).toBe("Black");
    // Premium Washed has no Red → derived from default White, not from Red.
    expect(pickColourForProduct("White", palette("Premium Washed Hoodie"), "Red")).toBe("Khaki");
    // Manual Pink on Premium Washed → GILDAN Bomber has no Pink → White.
    expect(pickColourForProduct("White", palette("GILDAN Bomber"), "Pink")).toBe("White");
  });

  it("Sol's-specific defaults use their own hex", () => {
    // Sol's Navy #333949 is dark → closest on Bomber is a dark colour, not White.
    const navyPick = pickColourForProduct("Sol's Navy", palette("GILDAN Bomber"));
    expect(navyPick).not.toBe("White");
    const lum = (n: string) => relativeLuminance(COLORS.find((c) => c.name === n)!.hex);
    expect(lum(navyPick)).toBeLessThan(0.179);
    // Sol's Pink #EBC9D9 is light → White on hoodies that have it.
    expect(pickColourForProduct("Sol's Pink", palette("GILDAN Bomber"))).toBe("White");
  });

  it("tie-break prefers White for light and Black for dark defaults", () => {
    const pal = [{ name: "Off", hex: "#FFFFFF" }, "White", { name: "Ink", hex: "#000000" }, "Black"];
    expect(pickColourForProduct("Light Gray", pal)).toBe("White");
    expect(pickColourForProduct("Dark Navy", pal)).toBe("Black");
  });

  it("unknown / missing default counts as White; admin swatches use their hex", () => {
    expect(pickColourForProduct(null, ["Black", "Light Gray"])).toBe("Light Gray");
    expect(pickColourForProduct("Mystery", [{ name: "Ink", hex: "#111111" }, { name: "Chalk", hex: "#EEEEEE" }])).toBe("Chalk");
    expect(pickColourForProduct("White", [])).toBe("White");
  });
});
