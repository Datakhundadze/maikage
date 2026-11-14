// Showroom "შეკვეთა" → the constructor's own order form (2026-11-14).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeConstructorSeed } from "@/lib/constructorSeed";

const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
const PAGE = read("../pages/SimplePage.tsx");
const DESIGNER = read("../components/tour/RackPhotoDesigner.tsx");

describe("seed: order + size", () => {
  const ts = Date.now();
  it("order is carried only as true; size only with order and only a short plain label", () => {
    expect(normalizeConstructorSeed({ ts, text: "x", order: true, size: "XL" })).toMatchObject({ order: true, size: "XL" });
    expect(normalizeConstructorSeed({ ts, text: "x", order: true, size: "9/11 წელი" })).toMatchObject({ size: "9/11 წელი" });
    expect(normalizeConstructorSeed({ ts, text: "x", order: "true", size: "XL" })).not.toHaveProperty("order");
    expect(normalizeConstructorSeed({ ts, text: "x", size: "XL" })).not.toHaveProperty("size");
    expect(normalizeConstructorSeed({ ts, text: "x", order: true, size: "<script>alert(1)</script>" })).not.toHaveProperty("size");
  });
  it("a chat seed (no order) is unchanged", () => {
    expect(normalizeConstructorSeed({ ts, text: "x" })).not.toHaveProperty("order");
  });
});

describe("seed: then (the second side)", () => {
  const ts = Date.now();
  const img = "data:image/png;base64,AA";
  it("one nested seed, validated by the same rules; order survives only on the last", () => {
    const s = normalizeConstructorSeed({ ts, side: "back", image: img, order: true, then: { side: "front", text: "x", order: true, size: "L" } });
    expect(s).not.toHaveProperty("order");
    expect(s?.then).toMatchObject({ side: "front", text: "x", order: true, size: "L" });
  });
  it("no chain inside a chain; a junk `then` is dropped", () => {
    const s = normalizeConstructorSeed({ ts, text: "a", then: { text: "b", then: { text: "c" } } });
    expect(s?.then?.text).toBe("b");
    expect(s?.then).not.toHaveProperty("then");
    expect(normalizeConstructorSeed({ ts, text: "a", then: "x" })).not.toHaveProperty("then");
    expect(normalizeConstructorSeed({ ts, text: "a", order: true })).toMatchObject({ order: true });
  });
});

describe("constructor: chained seed (source)", () => {
  it("goes back through the one drain, by the in-place handoff's three lines", () => {
    const start = PAGE.indexOf("// ── Chained seed: the showroom's second side");
    const body = PAGE.slice(start, PAGE.indexOf("const [pendingOrder, setPendingOrder]", start));
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("seedRef.current = next;\n    seedAppliedRef.current = false;\n    setSeedNonce((n) => n + 1);");
    expect(body).not.toContain("addPhotoLayer");
    expect(body).not.toContain("setSideData");
  });
});

describe("constructor (source)", () => {
  it("the seeded order only calls handleOrderClick; it opens no dialog itself", () => {
    const start = PAGE.indexOf("// ── Seeded order: press the order button for a showroom visitor");
    const body = PAGE.slice(start, PAGE.indexOf("// ── Swap: lettering above the photo", start));
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("void handleOrderClick();");
    expect(body).not.toContain("setOrderDialogOpen");
    expect(body).not.toContain("calculatePrice");
    expect(body).toContain("sizes.includes(pendingOrder.size)");
  });
  it("handleOrderClick is byte-for-byte what it was", () => {
    expect(PAGE).toContain(`  const handleOrderClick = useCallback(async () => {
    if (needsSize && !productConfig.config.size) {
      setSizeError(true);
      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSizeError(false);
    const { fm, bm, fdo, bdo } = await computeFresh();
    if (fm || bm) saveToGenerations(fm, bm, fdo || bdo);
    setOrderDialogOpen(true);
  }, [needsSize, productConfig.config.size, computeFresh, saveToGenerations]);`);
  });
});

describe("showroom designer (source)", () => {
  it("asks the size before ordering and sends order: true", () => {
    expect(DESIGNER).toContain("if (sizes.length && !size) {");
    expect(DESIGNER).toContain("order: true,");
    expect(DESIGNER).not.toContain("დააჭირე „ბეჭდვა“");
  });
});
