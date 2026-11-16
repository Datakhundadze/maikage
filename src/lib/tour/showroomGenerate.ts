// A design the bot draws, made inside the showroom (2026-11-16).
//
// On the site a "maika-generate" block opens the constructor, whose
// handleAiGenerate (SimplePage) runs the generation. From the showroom that
// would take the visitor out of it — David: "do everything in the showroom".
// This is the same recipe, called from the showroom designer:
//   - without background (the default): runGenerationPipeline — CALLED, never
//     changed — with the customer's words plus the same three guards, the same
//     model speed rule (a quoted slogan → "pro"), and its transparent result;
//   - with background: the bare "generate-design" call, as SimplePage makes it.
// The guard texts are copied from SimplePage (they are not exported there and
// importing the constructor's module would drag the whole page into the
// showroom); src/test/showroomGenerate.test.ts fails if the two ever differ.
//
// Not copied on purpose: the constructor's result panel, watermark and the
// analytics `generations` row (a storage upload) — the showroom puts the
// picture straight on the garment. The guest allowance is the caller's job.
import { callGemini, runGenerationPipeline } from "@/lib/generation";

export const GUARD_NO_GARMENT =
  "Output ONLY the standalone design artwork itself on a plain solid " +
  "white background. Do NOT draw or include any t-shirt, hoodie, garment, " +
  "apparel, clothing, fabric, mockup, folded shirt, hanger, or product of " +
  "any kind. No clothing item, no product photo, no shirt — just the " +
  "isolated graphic artwork, centered, ready to be printed.";

export const GUARD_ISOLATE_BG =
  "CRITICAL: render the subject as a SINGLE ISOLATED design element on a PLAIN " +
  "SOLID WHITE (#FFFFFF) background. Do NOT draw any scenery, environment, " +
  "landscape, room, sky, ground, floor, wall, building, rooftop, city, street " +
  "or any background setting — even if the description mentions a place or " +
  "location, treat it ONLY as theme/style inspiration, NEVER as a literal " +
  "background. No full-frame scene, no rectangular photo, no border. The " +
  "background must be empty pure white so the artwork can be cleanly cut out.";

export const GUARD_SLOGAN_NO_CARD =
  "Render any text as bold STANDALONE typography/lettering floating directly " +
  "on the plain background — NOT placed on a paper, card, poster, sign, banner, " +
  "sticker, label, note, frame, or any rectangular backdrop surface. No sheet " +
  "of paper, no card, no poster behind the text — just the letters as isolated " +
  "graphic artwork.";

/** A quoted phrase in the prompt is the slogan to render as typography (SimplePage's rule). */
export function sloganOf(prompt: string): string {
  return prompt.match(/[«"„“”'`]([^«»"„“”'`]{2,120})[»"“”'`]/)?.[1]?.trim() ?? "";
}

export interface ShowroomGenerate {
  prompt: string;
  /** Canonical English style label, or "" for Auto. */
  style: string;
  withBackground: boolean;
}

/** One generation (one unit of the allowance). Returns the picture to put on the garment. */
export async function generateForShowroom(g: ShowroomGenerate, product: string, color: string): Promise<string> {
  const text = g.prompt.trim();
  const slogan = sloganOf(text);
  const character = `${text} ${GUARD_NO_GARMENT}${slogan ? ` ${GUARD_SLOGAN_NO_CARD}` : ""}`;
  const isRealistic = /realistic|photo|რეალ/i.test(g.style || "");
  if (!g.withBackground) {
    const gen = await runGenerationPipeline(
      {
        designParams: { character: `${character} ${GUARD_ISOLATE_BG}`, scene: "", style: g.style, text: slogan, characterImages: [], sceneImage: null, styleImage: null, textImage: null },
        product,
        color,
        speed: slogan ? "pro" : "fast",
      },
      // the pipeline's own product mockup is not used here: no product photo, default placement
      { x: 0.5, y: 0.5, scale: 1 },
      null,
      () => {},
    );
    return gen.transparentImage;
  }
  const { image } = await callGemini("generate-design", {
    character, scene: "", style: g.style, text: slogan,
    characterImages: [], sceneImage: null, styleImage: null, textImage: null,
    product, color,
    speed: slogan || isRealistic ? "pro" : "fast", isRealistic,
  });
  return image;
}
