import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { customerText, flagDesignParams, isFlagCharacter, keyOutRgba, GUARD_FLAG_ON_KEY } from "@/lib/flagKey";

const GUARDED = "საქართველოს დროშა Output ONLY the standalone design artwork itself on a plain solid white background.";

describe("site flags: magenta key instead of GPT transparency", () => {
  it("detects flags in the customer's words only, not in the guards", () => {
    expect(customerText(GUARDED)).toBe("საქართველოს დროშა");
    expect(isFlagCharacter(GUARDED)).toBe(true);
    expect(isFlagCharacter("ლომი Output ONLY the standalone design artwork … flag")).toBe(false);
    expect(isFlagCharacter("coat of arms of Tbilisi")).toBe(true);
  });

  it("flag params: opaque, magenta guard, white-background guards dropped", () => {
    const p = flagDesignParams({ character: GUARDED, style: "Illustration", product: "Hoodie", color: "Black", isRealistic: true });
    expect(p.transparent).toBe(false);
    expect(p.isRealistic).toBe(false);
    expect(p.character).toBe(`საქართველოს დროშა. ${GUARD_FLAG_ON_KEY}`);
    expect(p.product).toBe("Hoodie");
  });

  it("keyOutRgba clears magenta, keeps white and red", () => {
    const d = new Uint8ClampedArray([255, 0, 255, 255, 255, 255, 255, 255, 220, 10, 20, 255]);
    keyOutRgba(d);
    expect([d[3], d[7], d[11]]).toEqual([0, 255, 255]);
  });

  it("generation.ts: only tryGptGenerateDesign changed — flag branch before the alpha check", () => {
    const src = readFileSync(path.resolve(__dirname, "../lib/generation.ts"), "utf8");
    const fn = src.slice(src.indexOf("async function tryGptGenerateDesign"), src.indexOf("export async function runGenerationPipeline"));
    expect(fn).toContain("flag ? flagDesignParams(designParams) : designParams");
    expect(fn.indexOf("keyOutMagenta")).toBeLessThan(fn.indexOf("transparentShare("));
    const pipeline = src.slice(src.indexOf("export async function runGenerationPipeline"));
    expect(pipeline).not.toContain("flagKey");
    expect(pipeline).not.toContain("keyOutMagenta");
  });
});
