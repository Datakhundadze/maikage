// Deterministic guard on the faq-chat SKETCH BLOCKS (2026-10-30, add-only).
//
// Eval of KB v2.6 on 33 real cases: with a photo attached or a long context the
// model still (a) copies the garment colour it SEES into "color" although the
// customer named none, and (b) emits a bare maika-mockup with no text and no
// photo, which the client silently drops — the customer sees nothing. Prompt
// rules alone did not stop either, so both are enforced here, from facts the
// server has: the customer's own turns in THIS request and whether THIS
// request carried an image.
//
// Edits ONLY the JSON inside ```maika-mockup / ```maika-generate fences (and
// removes a mockup fence that can show nothing). Prose is touched only when a
// fence is removed. No fence, or nothing to change → the same string.

import {
  stripBlockAnnouncements,
  SKETCH_FALLBACK_KA,
  SKETCH_FALLBACK_EN,
  GENERATE_FALLBACK_KA,
  GENERATE_FALLBACK_EN,
} from "./replySanitize.ts";

export interface BlockGuardContext {
  /** The customer's (role "user") turns of this request, oldest first. */
  userTurns: string[];
  /** params.image was present and acceptable on this request. */
  hasImage: boolean;
}

export const DEFAULT_GARMENT_COLOUR = "White";
export const ASK_FOR_DESIGN_KA = "რა წარწერა გნებავთ, ან მიამაგრეთ დიზაინის ფოტო?";
export const ASK_FOR_DESIGN_EN = "What should we print — or attach a photo of the design?";

// ── Colour mentions ─────────────────────────────────────────────────────────
// Georgian stems, matched at a word start (any suffix: თეთრ-ი/-ზე/-ად…).
const KA_COLOUR_STEMS = [
  "თეთრ", "შავ", "წითელ", "წითლ", "ლურჯ", "ცისფერ", "ყვითელ", "ყვითლ", "მწვან", "ნაცრისფერ",
  "რუხ", "ვარდისფერ", "იასამნ", "იისფერ", "ნარინჯისფერ", "ყავისფერ", "ბეჟ", "მუქ", "ღია",
  "ბორდო", "კრემისფერ", "ხაკ", "სალათისფერ", "ფირუზისფერ", "ოქროსფერ", "ვერცხლისფერ",
];
// English colour words + every word that is a colour in the catalog palette.
const EN_COLOUR_WORDS = [
  "white", "black", "red", "blue", "green", "yellow", "gray", "grey", "pink", "purple",
  "orange", "brown", "beige", "navy", "cream", "khaki", "burgundy", "lime", "turquoise",
  "violet", "maroon", "gold", "silver", "teal", "emerald", "ultramarine", "melange",
];
// The catalog's own colour names (src/lib/catalog.ts COLORS), as phrases. A
// test keeps this list in step with the catalog.
export const CATALOG_COLOUR_NAMES = [
  "White", "Black", "Beige", "Light Gray", "Light Gray Melange", "Gray", "Cream", "Light Cream",
  "Red", "Burgundy", "Pink", "Orange", "Yellow", "Lime", "Green", "Turquoise", "Light Blue",
  "Blue", "Standard Blue", "Electric Blue", "Dark Navy", "Purple", "Khaki", "Brown",
  "Sol's Khaki", "Sol's Pink", "Sol's Emerald", "Sol's Electric", "Sol's Navy", "Sol's Ultramarine",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KA_COLOUR_RE = new RegExp(`(?:^|[^\\u10D0-\\u10FF])(?:${KA_COLOUR_STEMS.join("|")})`);
const EN_COLOUR_RE = new RegExp(
  `\\b(?:${[...EN_COLOUR_WORDS, ...CATALOG_COLOUR_NAMES.map(escapeRe)].join("|")})\\b`,
  "i",
);

/** Does any of the customer's turns name a colour? */
export function mentionsColour(userTurns: string[]): boolean {
  return userTurns.some((t) => KA_COLOUR_RE.test(t) || EN_COLOUR_RE.test(t));
}

/** The customer's turns from the raw request messages, as the model saw them. */
export function userTurnsFromMessages(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .filter((m) => m.role === "user")
    .map((m) => String(m.content).slice(0, 1000));
}

// ── Placeholder text (same rule as src/lib/mockupSuggestion.ts) ─────────────
export const SERVER_PLACEHOLDER_TEXTS = new Set([
  "თქვენი ტექსტი", "თქვენი ტექსტი აქ", "your text", "your text here", "text", "ტექსტი",
  "...", "…", "გვარი", "სახელი", "სახელი გვარი",
]);
const norm = (s: string) => s.trim().toLowerCase();
function isRealText(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  if (SERVER_PLACEHOLDER_TEXTS.has(norm(v))) return false;
  const tokens = v.split(/\s+/).filter(Boolean);
  const words = tokens.filter((w) => !/^\d+$/.test(w));
  return !(words.length > 0 && words.length < tokens.length && SERVER_PLACEHOLDER_TEXTS.has(norm(words.join(" "))));
}
const isTrue = (v: unknown) => v === true || (typeof v === "string" && norm(v) === "true");

const MAIKA_FENCE_RE = /```maika-(mockup|generate)\s*([\s\S]*?)```/g;
const ANY_FENCE_RE = /```[\s\S]*?(?:```|$)/g;
const GEORGIAN_RE = /[Ⴀ-ჿ]/;
const FALLBACKS = new Set([SKETCH_FALLBACK_KA, SKETCH_FALLBACK_EN, GENERATE_FALLBACK_KA, GENERATE_FALLBACK_EN]);

/**
 * Apply the two block rules:
 *  1. "color" is set to "White" in either block unless a customer turn names a
 *     colour ("textColor" is never touched);
 *  2. without an image on this request, "removeBackground" / "editPrompt" are
 *     removed from a mockup block, and a mockup block left with no real "text"
 *     and no "removeWhite" is removed entirely.
 * Unparsable fences are left as they are (the client already ignores them).
 */
export function guardSketchBlocks(text: string, ctx: BlockGuardContext): string {
  if (!text || !text.includes("```maika-")) return text;
  const colourNamed = mentionsColour(ctx.userTurns);
  const dropped: string[] = [];
  let changed = false;

  const rewritten = text.replace(MAIKA_FENCE_RE, (whole, kind: string, body: string) => {
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return whole;
      obj = parsed as Record<string, unknown>;
    } catch {
      return whole;
    }
    let edited = false;
    // No colour named by the customer → White (David, 2026-10-30: prints best,
    // the house default). A colour the model saw or invented never survives.
    // The client maps "White" to the nearest stocked white, or keeps the
    // current selection when the brand stocks no white at all.
    if (!colourNamed && obj.color !== DEFAULT_GARMENT_COLOUR) { obj.color = DEFAULT_GARMENT_COLOUR; edited = true; }
    if (kind === "mockup" && !ctx.hasImage) {
      if ("removeBackground" in obj) { delete obj.removeBackground; edited = true; }
      if ("editPrompt" in obj) { delete obj.editPrompt; edited = true; }
      if (!isRealText(obj.text) && !isTrue(obj.removeWhite)) {
        changed = true;
        dropped.push(whole);
        return whole; // removed below, after the prose is cleaned
      }
    }
    if (!edited) return whole;
    changed = true;
    return "```maika-" + kind + "\n" + JSON.stringify(obj) + "\n```";
  });
  if (!changed) return text;
  if (!dropped.length) return rewritten;

  // A removed block must not leave prose announcing it: clean the prose while
  // the fence is still there, then cut the fence.
  let out = stripBlockAnnouncements(rewritten);
  for (const f of dropped) out = out.replace(f, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  // Nothing left to say (or only the sanitizer's "sketch is on the product"
  // line, which is false once the block is gone) → ask for the design.
  const prose = out.replace(ANY_FENCE_RE, "").trim();
  if (!prose || FALLBACKS.has(prose)) {
    if (prose) out = out.replace(prose, "").trim();
    const lastTurn = ctx.userTurns[ctx.userTurns.length - 1];
    const ka = GEORGIAN_RE.test(lastTurn ?? text);
    const ask = ka ? ASK_FOR_DESIGN_KA : ASK_FOR_DESIGN_EN;
    out = out ? ask + "\n\n" + out : ask;
  }
  return out;
}
