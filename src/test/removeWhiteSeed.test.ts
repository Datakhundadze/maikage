import { describe, it, expect } from "vitest";
import { parseMockupSuggestion } from "@/lib/mockupSuggestion";
import { parseChatSuggestion } from "@/lib/generateSuggestion";
import { normalizeConstructorSeed } from "@/lib/constructorSeed";
import { isAutoSketchEligible } from "@/lib/autoSketch";

const block = (json: string) => "პასუხი\n```maika-mockup\n" + json + "\n```";

describe("removeWhite — site assistant → constructor seed (add-only field)", () => {
  it("parses true and the quoted \"true\"", () => {
    expect(parseMockupSuggestion(block('{"removeWhite":true}'))?.removeWhite).toBe(true);
    expect(parseMockupSuggestion(block('{"removeWhite":"true"}'))?.removeWhite).toBe(true);
    expect(parseMockupSuggestion(block('{"removeWhite":false}'))?.removeWhite).toBeUndefined();
  });

  it("a removeWhite-only block is actionable with no attachment and no text", () => {
    const r = parseChatSuggestion(block('{"removeWhite":true}'), false);
    expect(r.suggestion?.kind).toBe("mockup");
    expect(r.text).toBe("პასუხი");
  });

  it("an empty block without removeWhite is still dropped (unchanged rule)", () => {
    expect(parseChatSuggestion(block('{"side":"front"}'), false).suggestion).toBeNull();
  });

  it("the seed survives normalization without an image", () => {
    const seed = normalizeConstructorSeed({ removeWhite: true, ts: Date.now() });
    expect(seed).not.toBeNull();
    expect(seed?.removeWhite).toBe(true);
  });

  it("an ordinary seed gets no removeWhite key", () => {
    const seed = normalizeConstructorSeed({ text: "საქართველო", ts: Date.now() });
    expect(seed).not.toBeNull();
    expect("removeWhite" in (seed as object)).toBe(false);
  });

  it("spends an allowance → never auto-applied without a click", () => {
    const s = parseChatSuggestion(block('{"text":"გიორგი","removeWhite":true}'), false).suggestion;
    expect(isAutoSketchEligible(s)).toBe(false);
    const plain = parseChatSuggestion(block('{"text":"გიორგი"}'), false).suggestion;
    expect(isAutoSketchEligible(plain)).toBe(true);
  });
});
