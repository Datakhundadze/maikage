// GPT Image prompt for "generate-design-gpt" (2026-10-30, add-only).
//
// The GPT design generator sends the SAME text production sends to Gemini:
// index.ts calls the unchanged buildGenerateDesignMessages(params), joins its
// text parts with joinPromptText, then applies buildGptGeneratePrompt — a few
// GPT-only substitutions on the joined STRING. buildGenerateDesignMessages
// itself is never modified, so the Gemini "generate-design" prompt stays
// byte-identical.
//
// Pure functions, no Deno APIs, so vitest imports this module directly (like
// blockGuard.ts).

/** Illustration mode's no-text clause, verbatim from buildGenerateDesignMessages. */
export const ILLUSTRATION_NO_TEXT_CLAUSE =
  "DO NOT include any text, words, letters, numbers, or typography of any kind in the design. The design must be purely visual/illustrative with absolutely no written elements.";

/** Realistic mode's no-text bullet, verbatim from buildGenerateDesignMessages. */
export const REALISTIC_NO_TEXT_CLAUSE =
  "• No text, letters, numbers, or written characters anywhere in the image";

/**
 * Replaces both no-text clauses when params.text is empty. GPT renders
 * lettering well (Georgian included, A/B of 2026-10-30), so a description that
 * itself asks for a name or slogan should get it instead of being forbidden.
 */
export const GPT_TEXT_ONLY_IF_ASKED =
  "Include text ONLY if the description explicitly asks for words, a name, a slogan or lettering — then render exactly those words, letter for letter, in the language and script given (Georgian in Mkhedruli). Otherwise no text at all.";

export const GPT_SAFETY_LINE =
  "No blood, gore, wounds or graphic violence. Keep it tasteful and print-friendly for apparel.";

export const GPT_TRANSPARENT_LINE = "Background: fully transparent (no white backdrop). White parts that belong to the design itself (a white flag field, white lettering, highlights) stay OPAQUE white — only the empty surroundings are transparent.";

/** Owner 2026-10-31: a flag / coat of arms prints as a clean flat graphic. */
export const GPT_FLAT_FLAG_LINE =
  "The flag / coat of arms / emblem must be a FLAT graphic seen straight on: a clean rectangle (or the emblem's exact shape), NO waving, NO folds, NO ripples, NO fabric texture, NO pole, NO shadow, NO perspective — crisp flat vector colours with exact proportions. Its WHITE field is part of the flag: paint it OPAQUE white (#FFFFFF, full alpha), never transparent.";
export const FLAG_RE = /დროშ|გერბ|ემბლემ|\bflags?\b|coat of arms|\bemblem/i;

type PromptPart = { type?: string; text?: unknown };
type PromptMessage = { content?: unknown };

/**
 * The text of a chat message list, joined with blank lines. A text part that
 * only labels the image part right after it ("Character reference images:")
 * is skipped: images/generations takes no images, so the label would point
 * at nothing. Returns the number of image parts that were dropped.
 */
export function joinPromptText(messages: PromptMessage[]): { text: string; droppedImages: number } {
  const texts: string[] = [];
  let droppedImages = 0;
  for (const m of messages) {
    if (typeof m?.content === "string") {
      texts.push(m.content);
      continue;
    }
    if (!Array.isArray(m?.content)) continue;
    const parts = m.content as PromptPart[];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p?.type === "image_url") {
        droppedImages++;
        continue;
      }
      if (p?.type !== "text" || typeof p.text !== "string") continue;
      if (parts[i + 1]?.type === "image_url") continue;
      texts.push(p.text);
    }
  }
  return { text: texts.join("\n\n"), droppedImages };
}

/**
 * The GPT-only edits to the production prompt:
 *  a) no slogan (params.text empty) → both no-text clauses become
 *     GPT_TEXT_ONLY_IF_ASKED (the realistic bullet keeps its "• ");
 *  b) the safety line is appended;
 *  c) transparent output → the transparent-background line is appended.
 * The white-background wording stays: the A/B run had it and GPT still
 * returned real transparent PNGs.
 */
export function buildGptGeneratePrompt(
  basePrompt: string,
  opts: { hasText: boolean; transparent: boolean },
): string {
  let out = basePrompt;
  if (!opts.hasText) {
    out = out
      .split(ILLUSTRATION_NO_TEXT_CLAUSE).join(GPT_TEXT_ONLY_IF_ASKED)
      .split(REALISTIC_NO_TEXT_CLAUSE).join(`• ${GPT_TEXT_ONLY_IF_ASKED}`);
  }
  out = `${out}\n\n${GPT_SAFETY_LINE}`;
  if (FLAG_RE.test(basePrompt)) out = `${out}\n${GPT_FLAT_FLAG_LINE}`;
  if (opts.transparent) out = `${out}\n${GPT_TRANSPARENT_LINE}`;
  return out;
}
