// A design the bot draws, made inside the showroom (2026-11-16).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GUARD_ISOLATE_BG, GUARD_NO_GARMENT, GUARD_SLOGAN_NO_CARD, sloganOf } from "@/lib/tour/showroomGenerate";

const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
const PAGE = read("../pages/SimplePage.tsx");
const LIB = read("../lib/tour/showroomGenerate.ts");

/** The value of `const NAME = "a" + "b" + …;` in the constructor's source. */
function pageConst(name: string): string {
  const at = PAGE.indexOf(`const ${name} =`);
  const src = PAGE.slice(at, PAGE.indexOf(";", at));
  return [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("");
}

describe("the guards are the constructor's own, word for word", () => {
  it.each([
    ["GUARD_NO_GARMENT", GUARD_NO_GARMENT],
    ["GUARD_ISOLATE_BG", GUARD_ISOLATE_BG],
    ["GUARD_SLOGAN_NO_CARD", GUARD_SLOGAN_NO_CARD],
  ])("%s", (name, value) => {
    expect(pageConst(name).length).toBeGreaterThan(100);
    expect(value).toBe(pageConst(name));
  });
  it("the slogan rule is the constructor's regex", () => {
    const re = "text.match(/[«\"„“”'`]([^«»\"„“”'`]{2,120})[»\"“”'`]/)?.[1]?.trim() ?? \"\"";
    expect(PAGE).toContain(re);
    expect(sloganOf("ლომი წარწერით „ძალა“")).toBe("ძალა");
    expect(sloganOf("ლომი")).toBe("");
  });
});

describe("recipe (source)", () => {
  it("calls the pipeline, does not copy it; a slogan forces the pro model; no product mockup is asked for", () => {
    expect(LIB).toContain("const gen = await runGenerationPipeline(");
    expect(LIB).toContain('speed: slogan ? "pro" : "fast",');
    expect(LIB).toContain("return gen.transparentImage;");
    expect(LIB).not.toContain("compositeMockup");
    expect(LIB).toContain('speed: slogan || isRealistic ? "pro" : "fast", isRealistic,');
  });
});

describe("wiring (source)", () => {
  const WIDGET = read("../components/ChatWidget.tsx");
  const DESIGNER = read("../components/tour/RackPhotoDesigner.tsx");
  const ACTIONS = read("../components/ChatSuggestionActions.tsx");
  it("a named style goes straight to the showroom; without one the chips stay and their pick goes there too", () => {
    expect(WIDGET).toContain('suggestion?.kind === "generate" && onShowroom && suggestion.generate.style');
    expect(WIDGET).toContain("onGenerate={(g) => openGenerate(g, i)}");
    expect(WIDGET.match(/preferOpen: true,/g)?.length).toBe(2);
  });
  it("the generation is paid from the allowance before it runs", () => {
    const at = DESIGNER.indexOf("if (d.generate && !d.image) {");
    const body = DESIGNER.slice(at, DESIGNER.indexOf("if (d.image) {", at));
    expect(body.indexOf("recordGeneration();")).toBeGreaterThan(body.indexOf("if (!lim.allowed) {"));
    expect(body.indexOf("generateForShowroom(")).toBeGreaterThan(body.indexOf("recordGeneration();"));
  });
  it("the generate button is gone once the showroom took the request", () => {
    const at = ACTIONS.indexOf('if (suggestion.kind === "generate") {');
    expect(ACTIONS.slice(at, at + 300)).toContain("if (autoApplied) return null;");
  });
});
