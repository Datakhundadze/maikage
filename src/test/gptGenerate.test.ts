import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildGptGeneratePrompt,
  GPT_FLAT_FLAG_LINE,
  joinPromptText,
  ILLUSTRATION_NO_TEXT_CLAUSE,
  REALISTIC_NO_TEXT_CLAUSE,
  GPT_TEXT_ONLY_IF_ASKED,
  GPT_SAFETY_LINE,
  GPT_TRANSPARENT_LINE,
} from "../../supabase/functions/gemini-proxy/gptGeneratePrompt";

// gemini-proxy is a Deno module (https imports), so it cannot be imported
// here. These assertions read its SOURCE, which is what gets deployed.
const SRC = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/index.ts"), "utf8");
const GEN = readFileSync(path.resolve(__dirname, "../lib/generation.ts"), "utf8");
const SWITCH = readFileSync(path.resolve(__dirname, "../lib/aiModelSwitch.ts"), "utf8");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function setMembers(name: string): string[] {
  const m = SRC.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  expect(m).not.toBeNull();
  return [...(m as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect(a).toBeGreaterThan(-1);
  const b = src.indexOf(to, a + from.length);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

const buildFn = () => slice(SRC, "function buildGenerateDesignMessages(", "\nasync function callGateway(");
const gptBranch = () => slice(SRC, 'if (action === "generate-design-gpt") {', "\n    let model: string;");
const pipeline = () => slice(GEN, "export async function runGenerationPipeline(", "\nexport async function upscaleImage(");

describe("gemini-proxy generate-design-gpt (edge function source)", () => {
  it("is billable, and NOT pro tier for guests (1 unit, like generate-design)", () => {
    expect(setMembers("BILLABLE_ACTIONS")).toContain("generate-design-gpt");
    expect(setMembers("BILLABLE_ACTIONS")).toContain("generate-design");
    expect(setMembers("PRO_TIER_GUEST_ACTIONS")).not.toContain("generate-design-gpt");
    expect(setMembers("PRO_TIER_GUEST_ACTIONS")).not.toContain("generate-design");
  });

  it("asks check_generation_block as generate-design, so the lifetime cap applies equally", () => {
    expect(SRC).toContain('const GENERATION_BLOCK_ACTION: Record<string, string> = { "generate-design-gpt": "generate-design" };');
    expect(SRC).toContain("p_action: GENERATION_BLOCK_ACTION[action] ?? action");
  });

  it("returns before the generic Gemini gateway path, after both gates", () => {
    const at = SRC.indexOf('if (action === "generate-design-gpt") {');
    expect(at).toBeGreaterThan(SRC.indexOf("if (BILLABLE_ACTIONS.has(action)) {"));
    expect(at).toBeGreaterThan(SRC.indexOf('if (action === "isolate-subject-gpt" || action === "restyle-gpt") {'));
    expect(at).toBeLessThan(SRC.indexOf('    if (action === "generate-design") {'));
  });

  it("uses the probe's working request: images/generations, sunburst, medium, transparent PNG", () => {
    const b = gptBranch();
    expect(b).toContain('const dgModel = "openai/gpt-image-2.5-sunburst";');
    expect(b).toContain('GATEWAY_URL.replace("/chat/completions", "/images/generations")');
    expect(b).toContain('quality: "medium"');
    expect(b).toContain('output_format: "png"');
    expect(b).toContain('size: "1024x1024"');
    expect(b).toContain('background: dgTransparent ? "transparent" : "auto"');
    expect(b).toContain("return dgJson(200, { image: img, text: \"\", model: dgModel });");
  });

  it("builds the prompt from the unchanged production builder + the GPT substitutions", () => {
    const b = gptBranch();
    expect(b).toContain("joinPromptText(buildGenerateDesignMessages(params))");
    expect(b).toContain("buildGptGeneratePrompt(dgJoined.text, { hasText: dgHasText, transparent: dgTransparent })");
    expect(SRC).toContain('import { buildGptGeneratePrompt, joinPromptText } from "./gptGeneratePrompt.ts";');
  });

  it("logs every attempt to ai_calls with the GPT model and the caller", () => {
    const b = gptBranch();
    expect(b).toContain("logAiCall({");
    expect(b).toContain("action, model: dgModel,");
    expect(b).toContain("sessionId: callerSessionId,");
    expect(b).toContain("isGuest: callerIsGuest,");
  });

  it("buildGenerateDesignMessages and the Gemini generate-design branch are byte-identical to main", () => {
    expect(sha256(buildFn())).toBe("52d4f80fa5eaafa46ced304265fb7b4559be0e93082d2dc43a18e786c5eae637");
    expect(sha256(slice(SRC, '    if (action === "generate-design") {', '    } else if (action === "convert-bg-black") {')))
      .toBe("16c5a0799fc0e445092a1b44ed3fcb1b5253777069bce5bf2b01d0b76437f03a");
  });

  it("the clauses the helper replaces are verbatim in the production builder", () => {
    const fn = buildFn();
    expect(fn).toContain(ILLUSTRATION_NO_TEXT_CLAUSE);
    expect(fn).toContain(REALISTIC_NO_TEXT_CLAUSE);
  });
});

describe("gptGeneratePrompt (pure)", () => {
  const illustration = `Intro.\n${ILLUSTRATION_NO_TEXT_CLAUSE}\n\nOUTPUT: on white.`;
  const realistic = `Intro.\n${REALISTIC_NO_TEXT_CLAUSE}\n\nOUTPUT: on white.`;

  it("no slogan: replaces the illustration no-text clause", () => {
    const out = buildGptGeneratePrompt(illustration, { hasText: false, transparent: true });
    expect(out).not.toContain(ILLUSTRATION_NO_TEXT_CLAUSE);
    expect(out).toContain(`Intro.\n${GPT_TEXT_ONLY_IF_ASKED}\n\nOUTPUT: on white.`);
  });

  it("no slogan: replaces the realistic no-text bullet, keeping the bullet", () => {
    const out = buildGptGeneratePrompt(realistic, { hasText: false, transparent: true });
    expect(out).not.toContain(REALISTIC_NO_TEXT_CLAUSE);
    expect(out).toContain(`• ${GPT_TEXT_ONLY_IF_ASKED}`);
  });

  it("the replacement names Mkhedruli and letter-for-letter rendering", () => {
    expect(GPT_TEXT_ONLY_IF_ASKED).toContain("letter for letter");
    expect(GPT_TEXT_ONLY_IF_ASKED).toContain("Georgian in Mkhedruli");
    expect(GPT_TEXT_ONLY_IF_ASKED).toContain("Otherwise no text at all.");
  });

  it("with a slogan the text is left alone", () => {
    const out = buildGptGeneratePrompt(illustration, { hasText: true, transparent: false });
    expect(out).toContain(ILLUSTRATION_NO_TEXT_CLAUSE);
    expect(out).toBe(`${illustration}\n\n${GPT_SAFETY_LINE}`);
  });

  it("always appends the safety line; the transparent line only for transparent output", () => {
    expect(GPT_SAFETY_LINE).toBe("No blood, gore, wounds or graphic violence. Keep it tasteful and print-friendly for apparel.");
    expect(GPT_TRANSPARENT_LINE).toMatch(/^Background: fully transparent \(no white backdrop\)\. /);
    expect(GPT_TRANSPARENT_LINE).toContain("stay OPAQUE white");
    const t = buildGptGeneratePrompt("P", { hasText: true, transparent: true });
    expect(t).toBe(`P\n\n${GPT_SAFETY_LINE}\n${GPT_TRANSPARENT_LINE}`);
    const o = buildGptGeneratePrompt("P", { hasText: true, transparent: false });
    expect(o).not.toContain(GPT_TRANSPARENT_LINE);
    expect(o.endsWith(GPT_SAFETY_LINE)).toBe(true);
  });

  it("keeps the white-background wording in place", () => {
    const out = buildGptGeneratePrompt(illustration, { hasText: false, transparent: true });
    expect(out).toContain("OUTPUT: on white.");
  });

  it("joinPromptText joins text parts and drops reference images with their labels", () => {
    const { text, droppedImages } = joinPromptText([{
      role: "user",
      content: [
        { type: "text", text: "MAIN" },
        { type: "text", text: "Character reference images:" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,BB" } },
        { type: "text", text: "TAIL" },
      ],
    } as never]);
    expect(text).toBe("MAIN\n\nTAIL");
    expect(droppedImages).toBe(2);
  });

  it("joinPromptText on a single text part returns it unchanged", () => {
    expect(joinPromptText([{ content: [{ type: "text", text: "only" }] }])).toEqual({ text: "only", droppedImages: 0 });
    expect(joinPromptText([{ content: "plain" }])).toEqual({ text: "plain", droppedImages: 0 });
  });
});

describe("client: USE_GPT_GENERATE + runGenerationPipeline", () => {
  it("the switch exists and is on", () => {
    expect(SWITCH).toContain("export const USE_GPT_GENERATE = true;");
  });

  it("tries GPT only behind the flag, with the generate-design params", () => {
    const p = pipeline();
    expect(p).toContain("const gpt = USE_GPT_GENERATE");
    expect(p).toContain("await tryGptGenerateDesign({");
    expect(p).toContain("...adjustedDesignParams,");
    expect(GEN).toContain('callGemini("generate-design-gpt", designParams, 0)');
  });

  it("keeps the Gemini fallback: generate-design → runTransparencyPipeline", () => {
    const p = pipeline();
    const elseAt = p.indexOf("} else {");
    expect(elseAt).toBeGreaterThan(p.indexOf("if (gpt) {"));
    const fallback = p.slice(elseAt);
    expect(fallback).toContain('await callGemini("generate-design", {');
    expect(fallback).toContain('speed: isRealistic ? "pro" : params.speed, // Force pro model for realistic');
    expect(fallback).toContain('onStatusChange("PROCESSING_TRANSPARENCY");');
    expect(fallback).toContain("await runTransparencyPipeline(designImage, { isRealistic })");
  });

  it("uses the GPT image only with real alpha, and rethrows limit errors instead of falling back", () => {
    expect(GEN).toContain("export const GPT_MIN_TRANSPARENT_SHARE = 0.03;");
    expect(GEN).toContain("if (share <= GPT_MIN_TRANSPARENT_SHARE) {");
    expect(GEN).toContain("if (err instanceof RateLimitError || err instanceof GenerationBlockedError) throw err;");
    expect(GEN).toContain("designImage: await flattenOnWhite(result.image), transparentImage: result.image");
  });

  it("Stage 3 mockup compositing still reads transparentImage", () => {
    const p = pipeline();
    expect(p).toContain("const transparentImg = await loadImage(transparentImage);");
    expect(p).toContain("mockupImage = compositeMockup(productImg, transparentImg, placementCoords, placementZone);");
    expect(p).toContain("prompt: designText,");
  });
});

describe("flags print flat (owner 2026-10-31)", () => {
  it("a flag / coat of arms / emblem prompt gets the flat line; others do not", () => {
    for (const p of ["საქართველოს დროშა", "Georgian flag", "ქალაქის გერბი", "coat of arms of Tbilisi"]) {
      expect(buildGptGeneratePrompt(p, { hasText: false, transparent: true })).toContain(GPT_FLAT_FLAG_LINE);
    }
    expect(buildGptGeneratePrompt("მგელი მთვარეზე", { hasText: false, transparent: true })).not.toContain(GPT_FLAT_FLAG_LINE);
  });
});
