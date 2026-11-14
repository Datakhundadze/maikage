// Showroom design → constructor layer coords (2026-11-14).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { photoLayerCoords, textLayerCoords, toLayerCoords, RASTER_PAD } from "@/lib/tour/designHandoff";
import { textSize, type GarmentDesign } from "@/lib/tour/garmentPhoto";
import { normalizeConstructorSeed } from "@/lib/constructorSeed";

const PAGE = readFileSync(path.resolve(__dirname, "../pages/SimplePage.tsx"), "utf8");

// the product photo drawn at (100, 200), 800×800; its zone: centre (0.5, 0.4), 0.4 wide, 0.5 tall
const box = { x: 100, y: 200, w: 800, h: 800 };
const zone = { x: 0.5, y: 0.4, scale: 0.4, scaleY: 0.5 };
// zone in pixels: x 340..660, y 320..720
const design = (o: Partial<GarmentDesign>): GarmentDesign => ({ img: null, text: "", font: "f", textColor: null, x: 0.5, y: 0.5, scale: 1, ...o });

describe("toLayerCoords", () => {
  it("a rectangle that IS the zone → centre 0.5/0.5, scale 1/1", () => {
    expect(toLayerCoords(500, 520, 320, 400, box, zone)).toEqual({ x: 0.5, y: 0.5, scale: 1, scaleY: 1 });
  });
  it("the zone's top-left corner → 0/0; half its width → 0.5; outside the zone goes past 0..1", () => {
    expect(toLayerCoords(340, 320, 160, 100, box, zone)).toEqual({ x: 0, y: 0, scale: 0.5, scaleY: 0.25 });
    expect(toLayerCoords(260, 320, 160, 100, box, zone).x).toBe(-0.25);
  });
  it("a zone without scaleY is square", () => {
    expect(toLayerCoords(500, 520, 320, 320, box, { x: 0.5, y: 0.4, scale: 0.4 })).toEqual({ x: 0.5, y: 0.5, scale: 1, scaleY: 1 });
  });
});

describe("photoLayerCoords", () => {
  // a print area wider than the zone, as the showroom's is
  const A = { x: 300, y: 300, w: 400, h: 440 };
  it("is where drawGarment draws the photo: centre A + d·A, width A.w·scale, height by aspect", () => {
    const c = photoLayerCoords(design({ x: 0.25, y: 0.5, scale: 0.4 }), 2, A, box, zone);
    // centre (400, 520), 160 × 80
    expect(c).toEqual(toLayerCoords(400, 520, 160, 80, box, zone));
    expect(c).toEqual({ x: 0.1875, y: 0.5, scale: 0.5, scaleY: 0.2 });
  });
});

describe("textLayerCoords", () => {
  const A = { x: 300, y: 300, w: 400, h: 440 };
  it("its own object: centre at tx/ty; the box is the word plus the constructor's raster pad", () => {
    const d = design({ text: "abc", tx: 0.5, ty: 0.25, ts: 0.5 });
    const size = textSize(d, A); // 400 · 0.5 · 0.16 = 32
    expect(size).toBe(32);
    const c = textLayerCoords(d, null, 160, A, box, zone);
    const w = 160 * (1 + (2 * RASTER_PAD * 32) / 160);
    expect(c.x).toBe(0.5);
    expect(c.y).toBeCloseTo((410 - 320) / 400, 4);
    expect(c.scale).toBeCloseTo(w / 320, 4);
  });
  it("without its own place it sits under the photo, as drawGarment puts it", () => {
    const d = design({ text: "abc", x: 0.5, y: 0.5, scale: 0.5 });
    const size = textSize(d, A);
    const c = textLayerCoords(d, 2, 100, A, box, zone);
    const ih = (400 * 0.5) / 2;
    expect(c.y).toBeCloseTo((520 + ih / 2 + size * 0.9 - 320) / 400, 4);
  });
  it("a word wider than drawGarment's limit is squeezed to it here too", () => {
    const d = design({ text: "abc", tx: 0.5, ty: 0.5, ts: 0.5 });
    const c = textLayerCoords(d, null, 5000, A, box, zone);
    expect(c.scale).toBeCloseTo((400 * 1.4 * (1 + (2 * RASTER_PAD * 32) / 5000)) / 320, 3);
  });
});

describe("seed: exact coords", () => {
  const ts = Date.now();
  const img = "data:image/png;base64,AA";
  it("carried whole or not at all; photoCoords need a photo, textCoords and font need text", () => {
    const pc = { x: 0.2, y: 0.3, scale: 0.5, scaleY: 0.4 };
    expect(normalizeConstructorSeed({ ts, image: img, photoCoords: pc })?.photoCoords).toEqual(pc);
    expect(normalizeConstructorSeed({ ts, text: "x", photoCoords: pc })).not.toHaveProperty("photoCoords");
    expect(normalizeConstructorSeed({ ts, image: img, photoCoords: { ...pc, scale: "0.5" } })).not.toHaveProperty("photoCoords");
    expect(normalizeConstructorSeed({ ts, image: img, photoCoords: { ...pc, x: NaN } })).not.toHaveProperty("photoCoords");
    expect(normalizeConstructorSeed({ ts, image: img, photoCoords: { ...pc, scale: 50 } })).not.toHaveProperty("photoCoords");
    expect(normalizeConstructorSeed({ ts, text: "x", textCoords: { x: 0.5, y: 0.5, scale: 0.4 }, font: "'Anton', Impact, sans-serif" }))
      .toMatchObject({ textCoords: { x: 0.5, y: 0.5, scale: 0.4 }, font: "'Anton', Impact, sans-serif" });
    expect(normalizeConstructorSeed({ ts, image: img, textCoords: { x: 0.5, y: 0.5, scale: 0.4 }, font: "x" })).not.toHaveProperty("textCoords");
    expect(normalizeConstructorSeed({ ts, text: "x", font: "url(javascript:1)" })).not.toHaveProperty("font");
  });
});

describe("constructor (source)", () => {
  it("exact coords switch the chest and paired layouts off; a seed without them takes the old path", () => {
    expect(PAGE).toContain("const exactPhoto = seed.image && seed.photoCoords ? seed.photoCoords : null;");
    expect(PAGE).toContain('const chest = !exact && (seed.placement === "left-chest" || seed.placement === "right-chest")');
    expect(PAGE).toContain("      !chest &&\n      !exact &&\n      seed.placement !== \"jersey-back\";");
    expect(PAGE).toContain("font: (seed.font && FONTS.find((f) => f.family === seed.font)) || FONTS[0],");
  });
});
