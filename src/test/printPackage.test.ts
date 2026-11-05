import { describe, expect, it } from "vitest";
import { physicalSizeFromZoneFraction, physicalSizeForItem, hasPhysicalSizeRule, MAX_WIDTH_CM, MAX_HEIGHT_CM } from "@/lib/printPackage/printSize";
import { setPngDpi, readPngDpi, crc32 } from "@/lib/printPackage/pngDpi";
import { removeSolidBackground } from "@/lib/printPackage/solidBackground";
import { buildJpegPdf } from "@/lib/printPackage/simplePdf";
import { backgroundMatchesGarment, sheetContact, packageBaseName, type PackageOrderRow } from "@/lib/printPackage/buildPrintPackage";

describe("print size rule (David 2026-11-04)", () => {
  it("full zone → 28 cm wide, height proportional", () => {
    const s = physicalSizeFromZoneFraction(1, 1)!;
    expect(s.widthCm).toBe(28);
    expect(s.heightCm).toBe(28);
    expect(s.widthPx).toBe(Math.round((28 / 2.54) * 300));
  });
  it("A4-looking (~0.7 of zone) → 25 cm", () => {
    expect(physicalSizeFromZoneFraction(0.7, 0.5)!.widthCm).toBe(25);
  });
  it("chest logo (~0.3 of zone) → 8–9 cm", () => {
    const w = physicalSizeFromZoneFraction(0.3, 0.3)!.widthCm;
    expect(w).toBeGreaterThanOrEqual(8);
    expect(w).toBeLessThanOrEqual(9);
  });
  it("design dragged past the zone is capped at 28 × 40", () => {
    const wide = physicalSizeFromZoneFraction(1.4, 0.6)!;
    expect(wide.widthCm).toBe(MAX_WIDTH_CM);
    const tall = physicalSizeFromZoneFraction(0.6, 1.6)!;
    expect(tall.heightCm).toBeLessThanOrEqual(MAX_HEIGHT_CM);
  });
  it("a portrait design filling the zone uses the A3 height (40 cm), width ≤ 28", () => {
    const s = physicalSizeFromZoneFraction(0.73, 1.07)!;
    expect(s.heightCm).toBe(MAX_HEIGHT_CM);
    expect(s.widthCm).toBeLessThanOrEqual(MAX_WIDTH_CM);
    expect(s.widthCm).toBeGreaterThan(26);
  });
  it("aspect ratio is preserved", () => {
    const s = physicalSizeFromZoneFraction(0.9, 0.45)!;
    expect(s.widthPx / s.heightPx).toBeCloseTo(2, 1);
  });
  it("rejects empty input", () => {
    expect(physicalSizeFromZoneFraction(0, 1)).toBeNull();
    expect(physicalSizeFromZoneFraction(NaN, 1)).toBeNull();
  });
  it("applies to garments only", () => {
    expect(hasPhysicalSizeRule("T-Shirt")).toBe(true);
    expect(hasPhysicalSizeRule("Hoodie")).toBe(true);
    expect(hasPhysicalSizeRule("Mug")).toBe(false);
    expect(hasPhysicalSizeRule("Cap")).toBe(true);
    expect(hasPhysicalSizeRule("Phone Case")).toBe(false);
  });
});

// Smallest valid PNG: signature + IHDR + IEND (no IDAT needed for chunk tests).
function chunk(type: string, data: number[]): number[] {
  const t = [...type].map((c) => c.charCodeAt(0));
  const len = data.length;
  const body = new Uint8Array([...t, ...data]);
  const crc = crc32(body);
  return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...t, ...data,
    crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255];
}
const tinyPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  ...chunk("IEND", []),
]);

describe("PNG DPI", () => {
  it("crc32 matches the known value for IEND", () => {
    expect(crc32(new Uint8Array([73, 69, 78, 68]))).toBe(0xae426082);
  });
  it("writes 300 DPI and replaces an old pHYs", () => {
    const once = setPngDpi(tinyPng, 300);
    expect(readPngDpi(once)).toBe(300);
    const twice = setPngDpi(once, 150);
    expect(readPngDpi(twice)).toBe(150);
    expect(twice.length).toBe(once.length);
  });
  it("leaves non-PNG bytes alone", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(setPngDpi(jpg, 300)).toBe(jpg);
  });
});

function img(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(fill(x, y), (y * w + x) * 4);
  return px;
}
const alphaAt = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3];

describe("solid background removal", () => {
  it("removes a white box around a logo but keeps white INSIDE the logo", () => {
    const w = 60, h = 60;
    // white bg, black ring 20..40, white hole in the ring's centre
    const px = img(w, h, (x, y) => {
      const inRing = x >= 20 && x < 40 && y >= 20 && y < 40;
      const inHole = x >= 27 && x < 33 && y >= 27 && y < 33;
      return inRing && !inHole ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const r = removeSolidBackground(px, w, h);
    expect(r.removed).toBe(true);
    expect(r.color).toBe("#ffffff");
    expect(alphaAt(px, w, 2, 2)).toBe(0); // background gone
    expect(alphaAt(px, w, 25, 25)).toBe(255); // logo kept
    expect(alphaAt(px, w, 30, 30)).toBe(255); // enclosed white kept
  });
  it("removes a solid coloured frame (JPEG-ish noise tolerated)", () => {
    const w = 50, h = 50;
    const px = img(w, h, (x, y) =>
      x > 10 && x < 40 && y > 10 && y < 40 ? [200, 30, 30, 255] : [20 + ((x + y) % 5), 90, 200, 255],
    );
    const r = removeSolidBackground(px, w, h);
    expect(r.removed).toBe(true);
    expect(alphaAt(px, w, 1, 1)).toBe(0);
    expect(alphaAt(px, w, 25, 25)).toBe(255);
  });
  it("does NOT touch a photo-like border (no dominant colour)", () => {
    const w = 40, h = 40;
    const px = img(w, h, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256, 255]);
    const before = px.slice();
    const r = removeSolidBackground(px, w, h);
    expect(r.removed).toBe(false);
    expect(px).toEqual(before);
  });
  it("skips an already transparent cut-out", () => {
    const w = 30, h = 30;
    const px = img(w, h, (x, y) => (x > 5 && x < 25 && y > 5 && y < 25 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(removeSolidBackground(px, w, h).removed).toBe(false);
  });
});

describe("JPEG PDF", () => {
  it("is a well-formed PDF with one page per image and a valid xref", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildJpegPdf([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }]);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    // every xref offset points at "<n> 0 obj"
    const offs = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

describe("auto background default is garment-aware", () => {
  it("white box on a white shirt → safe to remove by default", () => {
    expect(backgroundMatchesGarment("#fefefe", ["White"])).toBe(true);
  });
  it("white field on a black shirt (QR code) → admin decides", () => {
    expect(backgroundMatchesGarment("#ffffff", ["Black"])).toBe(false);
  });
  it("must match every garment the photo is on; unknown colour → false", () => {
    expect(backgroundMatchesGarment("#ffffff", ["White", "Black"])).toBe(false);
    expect(backgroundMatchesGarment("#ffffff", ["Mystery"])).toBe(false);
    expect(backgroundMatchesGarment(null, ["White"])).toBe(false);
  });
});

describe("kids and cap sizes (David 2026-11-04)", () => {
  it("kids garment prints slightly smaller than adult", () => {
    const adult = physicalSizeForItem("T-Shirt", "GILDAN", 1, 1)!;
    const kids = physicalSizeForItem("T-Shirt", "GILDAN KIDS", 1, 1)!;
    expect(adult.widthCm).toBe(28);
    expect(kids.widthCm).toBe(24);
    expect(kids.widthPx).toBeLessThan(adult.widthPx);
  });
  it("cap is ~7.5 cm on the longer side regardless of placement", () => {
    expect(physicalSizeForItem("Cap", null, 1, 0.5)!.widthCm).toBe(7.5);
    expect(physicalSizeForItem("Cap", null, 0.3, 0.15)!.widthCm).toBe(7.5);
    expect(physicalSizeForItem("Cap", null, 0.4, 0.8)!.heightCm).toBe(7.5);
  });
  it("mug and phone case have no rule", () => {
    expect(physicalSizeForItem("Mug", null, 1, 1)).toBeNull();
    expect(physicalSizeForItem("Phone Case", null, 1, 1)).toBeNull();
  });
});

describe("job sheet contact", () => {
  const row = (o: Partial<PackageOrderRow>) => o as PackageOrderRow;
  it("takes phone and courier address from whichever row of the cart has them", () => {
    const c = sheetContact([row({ phone: "", delivery_address: null }), row({ phone: " 599 00 00 00 ", delivery_address: "ვაჟა-ფშაველას 12" })]);
    expect(c).toEqual({ phone: "599 00 00 00", address: "ვაჟა-ფშაველას 12" });
  });
  it("returns nulls when nothing is set", () => {
    expect(sheetContact([row({})])).toEqual({ phone: null, address: null });
  });
});

describe("download file name", () => {
  it("is the customer's first and last name", () => {
    expect(packageBaseName({ first_name: "ლაშა", last_name: "ოსეფაიშვილი" }, "8C65DCB5")).toBe("ლაშა ოსეფაიშვილი");
  });
  it("drops characters illegal in file names and extra spaces", () => {
    expect(packageBaseName({ first_name: ' Ana/  "K" ', last_name: "Beridze:" }, "X")).toBe("Ana K Beridze");
  });
  it("falls back to the order number when the name is empty", () => {
    expect(packageBaseName({ first_name: " ", last_name: "" }, "AB12CD34")).toBe("maika-AB12CD34");
  });
});
