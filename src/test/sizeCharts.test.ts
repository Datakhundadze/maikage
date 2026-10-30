import { describe, it, expect } from "vitest";
import { SIZE_CHARTS, getSizeChart } from "@/lib/sizeCharts";
import { SUB_PRODUCTS, BRAND_SIZES } from "@/lib/catalog";

describe("size charts", () => {
  const brands = new Set(Object.values(SUB_PRODUCTS).flat());
  it("every chart key is a real brand with a size selector", () => {
    for (const k of Object.keys(SIZE_CHARTS)) {
      expect(brands.has(k), k).toBe(true);
      expect((BRAND_SIZES[k] ?? []).length, k).toBeGreaterThan(0);
    }
  });
  it("rows are plausible cm and grow with size", () => {
    for (const [k, rows] of Object.entries(SIZE_CHARTS)) {
      for (const r of rows) {
        expect(r.length, k).toBeGreaterThan(30);
        expect(r.width, k).toBeGreaterThan(30);
      }
      for (let i = 1; i < rows.length; i++) expect(rows[i].length, k).toBeGreaterThanOrEqual(rows[i - 1].length);
    }
  });
  it("owner corrections are in", () => {
    expect(SIZE_CHARTS["GIORDANO"][0]).toMatchObject({ size: "S", width: 52 });
    expect(SIZE_CHARTS["JEL Standard Hoodie"][1]).toMatchObject({ size: "M", length: 70 });
  });
  it("no chart → null", () => {
    expect(getSizeChart("Oversize")).toBeNull();
    expect(getSizeChart(undefined)).toBeNull();
    expect(getSizeChart("GILDAN")?.length).toBe(5);
  });
});
