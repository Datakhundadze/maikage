import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOUR_EN, tx } from "@/lib/tour/tourText";
import { SHOWROOM_RACKS } from "@/lib/tour/showroomRacks";

const GEORGIAN = /[ა-ჰ]/;
const root = join(__dirname, "..");
const files = [
  ...readdirSync(join(root, "components/tour")).filter((f) => f.endsWith(".tsx")).map((f) => join(root, "components/tour", f)),
  join(root, "components/PrintAnimation.tsx"),
];

describe("tx — the showroom in English", () => {
  it("keeps Georgian as written and gives English from the list", () => {
    expect(tx("ge", "მობრძანდით")).toBe("მობრძანდით");
    expect(tx("en", "მობრძანდით")).toBe("Come in");
  });
  it("falls back to Georgian instead of an empty label", () => {
    expect(tx("en", "ჯერ არ თარგმნილა")).toBe("ჯერ არ თარგმნილა");
  });
  it("has English for every text the components wrap in tx()", () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/tx\(lang, "((?:[^"\\]|\\.)*)"\)/g)) {
        if (!(m[1] in TOUR_EN)) missing.push(m[1]);
      }
    }
    expect(missing).toEqual([]);
  });
  it("has English for every Georgian rack name and print caption", () => {
    const names = SHOWROOM_RACKS.map((r) => r.title).filter((t) => GEORGIAN.test(t));
    const captions = [...readFileSync(join(root, "components/PrintAnimation.tsx"), "utf8").matchAll(/^\s+\w+: "([^"]*[ა-ჰ][^"]*)",$/gm)].map((m) => m[1]);
    expect(captions.length).toBeGreaterThan(5);
    expect([...names, ...captions].filter((t) => !(t in TOUR_EN))).toEqual([]);
  });
  it("leaves no Georgian in an English value", () => {
    expect(Object.values(TOUR_EN).filter((v) => GEORGIAN.test(v))).toEqual([]);
  });
});
