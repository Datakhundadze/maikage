// Website chat: a photo of a READY garment → its print alone (2026-11-13).
// Block field "extract" → seed.extractPrint → SimplePage.handleExtractPrint →
// gemini-proxy "extract-print-web" → keyPrintRgba.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ExtractPrintError, keyPrintRgba } from "@/lib/extractPrint";
import { parseMockupSuggestion } from "@/lib/mockupSuggestion";
import { normalizeConstructorSeed } from "@/lib/constructorSeed";
import { isAutoSketchEligible } from "@/lib/autoSketch";
import { guardSketchBlocks } from "../../supabase/functions/gemini-proxy/blockGuard";

const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
const PROXY = read("../../supabase/functions/gemini-proxy/index.ts");
const PAGE = read("../pages/SimplePage.tsx");
const mock = (o: Record<string, unknown>) => "```maika-mockup\n" + JSON.stringify(o) + "\n```";

/** w×h RGBA, all magenta, with one opaque rectangle of `rgb`. */
function frame(w: number, h: number, rect?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([255, 0, 255, 255], i * 4);
  if (rect)
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) d.set([...rect.rgb, 255], (y * w + x) * 4);
  return d;
}

describe("keyPrintRgba", () => {
  it("magenta goes, white lettering stays opaque, the box is the print", () => {
    const d = frame(40, 30, { x: 10, y: 8, w: 12, h: 6, rgb: [255, 255, 255] });
    const k = keyPrintRgba(d, 40, 30);
    expect(k).toMatchObject({ x: 10, y: 8, w: 12, h: 6 });
    expect(d[3]).toBe(0); // a corner: keyed out
    const mid = (10 * 40 + 14) * 4;
    expect([d[mid], d[mid + 1], d[mid + 2], d[mid + 3]]).toEqual([255, 255, 255, 255]);
    expect(k.keyedShare).toBeGreaterThan(0.9);
  });
  it("nothing but the key colour → empty", () => {
    expect(() => keyPrintRgba(frame(20, 20), 20, 20)).toThrow(ExtractPrintError);
    try { keyPrintRgba(frame(20, 20), 20, 20); } catch (e) { expect((e as ExtractPrintError).code).toBe("empty"); }
  });
  it("no key colour at all (the model returned the photo) → no_key, never a 'done'", () => {
    const d = new Uint8ClampedArray(20 * 20 * 4).fill(200);
    try { keyPrintRgba(d, 20, 20); throw new Error("should throw"); } catch (e) { expect((e as ExtractPrintError).code).toBe("no_key"); }
  });
});

describe("block → seed", () => {
  it("the parser reads extract (true or \"true\"), nothing else counts", () => {
    expect(parseMockupSuggestion(mock({ product: "Hoodie", subProduct: "GILDAN Hoodie", extract: true }))?.extract).toBe(true);
    expect(parseMockupSuggestion(mock({ product: "Hoodie", subProduct: "GILDAN Hoodie", extract: "true" }))?.extract).toBe(true);
    expect(parseMockupSuggestion(mock({ product: "Hoodie", subProduct: "GILDAN Hoodie", extract: "yes" }))).not.toHaveProperty("extract");
  });
  it("the seed carries extractPrint only with a photo", () => {
    const ts = Date.now();
    expect(normalizeConstructorSeed({ ts, image: "data:image/png;base64,AA", extractPrint: true })?.extractPrint).toBe(true);
    expect(normalizeConstructorSeed({ ts, text: "x", extractPrint: true })).not.toHaveProperty("extractPrint");
    expect(normalizeConstructorSeed({ ts, image: "data:image/png;base64,AA", extractPrint: "true" })).not.toHaveProperty("extractPrint");
  });
  it("extract drops removeBackground from the seed (source: buildMockupSeed)", () => {
    const src = read("../lib/mockupSuggestion.ts");
    expect(src).toContain("removeBackground: attachment && m.removeBackground && !m.extract ? true : undefined,");
    expect(src).toContain("extractPrint: attachment && m.extract ? true : undefined,");
  });
  it("an extract block is applied without a button; an edit / removal block still is not", () => {
    expect(isAutoSketchEligible({ kind: "mockup", mockup: { extract: true } } as never)).toBe(true);
    expect(isAutoSketchEligible({ kind: "mockup", mockup: { extract: true, editPrompt: "x" } } as never)).toBe(false);
    expect(isAutoSketchEligible({ kind: "mockup", mockup: { removeBackground: true } } as never)).toBe(false);
  });
});

describe("server guard", () => {
  it("without a photo on the request, extract is removed and the empty block goes", () => {
    const out = guardSketchBlocks("აი\n" + mock({ product: "Hoodie", extract: true }), { userTurns: ["ეს წარწერა"], hasImage: false });
    expect(out).not.toContain("extract");
    expect(out).not.toContain("maika-mockup");
  });
  it("with a photo it stays", () => {
    const out = guardSketchBlocks(mock({ product: "Hoodie", color: "White", extract: true }), { userTurns: ["ეს წარწერა"], hasImage: true });
    expect(out).toContain('"extract":true');
  });
});

describe("gemini-proxy extract-print-web", () => {
  const start = PROXY.indexOf('if (action === "extract-print-web") {');
  const body = PROXY.slice(start, PROXY.indexOf("// ── ADD-ONLY (2026-10-30): generate-design-gpt", start));
  it("one branch, after the social one, with no trusted-channel gate and no recolour / edit from the client", () => {
    expect(start).toBeGreaterThan(PROXY.indexOf('if (action === "extract-print-gpt") {'));
    expect(PROXY.indexOf('if (action === "extract-print-web") {', start + 1)).toBe(-1);
    expect(body).not.toContain("resolveTrustedSocialExtract");
    expect(body).toContain("extractPrintPrompt(undefined, undefined)");
    expect(body).not.toContain("params?.printColor");
    expect(body).toContain('form.append("background", "auto")');
  });
  it("the social branch still has its gate", () => {
    const s = PROXY.indexOf('if (action === "extract-print-gpt") {');
    expect(PROXY.slice(s, start)).toContain("resolveTrustedSocialExtract(");
    expect(PROXY.slice(s, start)).toContain('if (!xChannel) return xJson(403');
  });
  it("the KB sends a garment photo to extract, not to removeBackground", () => {
    expect(PROXY).toContain('"side":"front","extract":true}');
    expect(PROXY).toContain('extract: true | omit');
    expect(PROXY).not.toContain('emit the block with "removeBackground":true.');
  });
});

describe("SimplePage wiring (source)", () => {
  it("extract is its own handler and queue; handleRemoveBgPhoto is not edited to do it", () => {
    expect(PAGE).toContain("const handleExtractPrint = useCallback(async (photo: PhotoLayer) => {");
    expect(PAGE).toContain("void handleExtractPrint(layer).finally(() => setSeededRemoveBgActive(false));");
    expect(PAGE).toContain("if (seed.extractPrint) {");
    const rb = PAGE.slice(PAGE.indexOf("const handleRemoveBgPhoto = useCallback"), PAGE.indexOf("// ── The print alone, off a photo of a READY garment"));
    expect(rb).not.toContain("extract");
  });
});
