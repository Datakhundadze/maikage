import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EN_PAGE_LIST, EN_PATH_FOR_KA, enAlternates, enSchemas } from "@/lib/enPages";
import { EN_ROUTE_PATHS, EN_SERVICE_MENU } from "@/lib/enRoutePaths";
import { enServiceLinksFor } from "@/lib/enPages";
import { SERVICE_PAGE_LIST } from "@/lib/serviceCopy";
import { LEAD_TIME_EN, LEAD_TIME_KA } from "@/lib/leadTime";

describe("English pages", () => {
  it("routes match the copy", () => {
    expect([...EN_ROUTE_PATHS]).toEqual(EN_PAGE_LIST.map((p) => p.path));
  });

  it("header menu (English mode) = the hub's services list", () => {
    expect([...EN_SERVICE_MENU]).toEqual(enServiceLinksFor(""));
  });

  it("every page has a real Georgian twin", () => {
    const kaPaths = new Set(["/", ...SERVICE_PAGE_LIST.map((p) => p.path)]);
    for (const p of EN_PAGE_LIST) expect(kaPaths.has(p.kaPath), p.path).toBe(true);
    expect(Object.keys(EN_PATH_FOR_KA)).toHaveLength(EN_PAGE_LIST.length);
  });

  it("no price typed in the source — amounts come from pricing / FAQ_DELIVERY_PRICES", () => {
    const src = readFileSync(resolve(__dirname, "../lib/enPages.ts"), "utf8");
    expect(src).not.toMatch(/\d\s*(GEL|₾|lari)/i);
  });

  it("lead time matches the Georgian range", () => {
    expect(LEAD_TIME_KA.startsWith("1–3")).toBe(true);
    expect(LEAD_TIME_EN.startsWith("1–3")).toBe(true);
    const all = JSON.stringify(EN_PAGE_LIST);
    expect(all).not.toMatch(/1\s*[–-]\s*2\s*(business|working)?\s*day|next[- ]day|same day/i);
  });

  it("each page: title, description, H1, FAQ, hreflang, JSON-LD", () => {
    for (const p of EN_PAGE_LIST) {
      expect(p.seo.title.length, p.path).toBeLessThanOrEqual(70);
      expect(p.seo.description.length, p.path).toBeLessThanOrEqual(200);
      expect(p.faq.length, p.path).toBeGreaterThanOrEqual(3);
      expect(enAlternates(p).map((a) => a.hreflang)).toEqual(["en", "ka", "x-default"]);
      expect(enSchemas(p)).toHaveLength(3);
    }
  });

  it("no Georgian script in the English copy except the language switch", () => {
    for (const p of EN_PAGE_LIST) {
      const { kaPath: _k, ...rest } = p;
      expect(JSON.stringify(rest), p.path).not.toMatch(/[ა-ჿ]/);
    }
  });
});
