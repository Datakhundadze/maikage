import { describe, it, expect, beforeEach } from "vitest";
import {
  formatStockBlock, wantsStock, getStockBlock, _resetStockCacheForTests, STOCK_LIVE, type StockRow,
} from "../../supabase/functions/gemini-proxy/stockSnapshot";

const at = new Date("2026-10-24T10:30:00Z");
const rows: StockRow[] = [
  { product_id: "14", color: "შავი", size: "M", stock_qty: 63 },
  { product_id: "14", color: "შავი", size: "4XL", stock_qty: 2 },
  { product_id: "14", color: "შავი", size: "ბავშვის L", stock_qty: 4 },
  { product_id: "14", color: "თეთრი", size: "S", stock_qty: 0 },
  { product_id: "14", color: "წითელი", size: "XS", stock_qty: -2 },
  { product_id: "5", color: "", size: "M", stock_qty: 98 },
  { product_id: "8", color: "თეთრი", size: "", stock_qty: 9 },
  { product_id: "999", color: "შავი", size: "M", stock_qty: 5 },
];

describe("formatStockBlock", () => {
  const b = formatStockBlock(rows, at);
  it("is on for customers", () => expect(STOCK_LIVE).toBe(true));
  it("lists in-stock sizes, marks 1–2 pieces with *, never prints quantities", () => {
    expect(b).toContain("- GILDAN მაისური (სტანდარტული) — შავი: M, 4XL*");
    expect(b).not.toMatch(/\b63\b|\b98\b/);
  });
  it("splits kids sizes into the kids model as ages", () => {
    expect(b).toContain("- საბავშვო GILDAN მაისური — შავი: 9/11 წ.");
  });
  it("drops zero / negative stock, unknown colours and unmapped products", () => {
    expect(b).not.toContain("თეთრი: S");
    expect(b).not.toContain("წითელი: XS");
    expect(b).not.toContain("TH მაისური");
  });
  it("one-size models", () => expect(b).toContain("- Oversize მაისური (ერთი ზომა) — თეთრი: ერთი ზომა"));
  it("states the time in Tbilisi", () => expect(b).toContain("14:30 Tbilisi"));
  it("empty input → empty string", () => expect(formatStockBlock([], at)).toBe(""));
});

describe("wantsStock", () => {
  it("detects stock / size / colour questions", () => {
    expect(wantsStock([{ role: "user", content: "შავი XL გაქვთ?" }])).toBe(true);
    expect(wantsStock([{ role: "user", content: "Do you have it in red?" }])).toBe(true);
  });
  it("ignores unrelated questions", () => {
    expect(wantsStock([{ role: "user", content: "სად მდებარეობთ?" }])).toBe(false);
  });
});

describe("getStockBlock", () => {
  beforeEach(() => _resetStockCacheForTests());
  it("returns '' on network failure", async () => {
    const f = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    expect(await getStockBlock(f)).toBe("");
  });
  it("returns '' on a non-OK response", async () => {
    const f = (() => Promise.resolve(new Response("no", { status: 500 }))) as unknown as typeof fetch;
    expect(await getStockBlock(f)).toBe("");
  });
  it("formats and caches a good response", async () => {
    let calls = 0;
    const f = (() => { calls++; return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 })); }) as unknown as typeof fetch;
    const a = await getStockBlock(f, () => at.getTime());
    const b = await getStockBlock(f, () => at.getTime() + 60_000);
    expect(a).toContain("STOCK NOW");
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });
});

describe("one-size products", () => {
  it("caps / mugs ignore the warehouse size code", () => {
    const b = formatStockBlock([
      { product_id: "10", color: "შავი", size: "XS", stock_qty: 42 },
      { product_id: "10", color: "შავი", size: "UNI", stock_qty: 65 },
      { product_id: "13", color: "თეთრი", size: "", stock_qty: 25 },
    ], at);
    expect(b).toContain("- კეპი — შავი: ერთი ზომა\n");
    expect(b).toContain("- ჭიქა — თეთრი: ერთი ზომა");
  });
});
