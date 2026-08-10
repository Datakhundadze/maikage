// Shared maika-generate suggestion pipeline: fence stripping, JSON parsing,
// enum validation and the seed-write handoff. Used by BOTH the standalone
// /chat page and the floating ChatWidget, so the two can never drift apart.
//
// WHAT THIS IS NOT. It does not generate anything and it never touches the
// generation pipeline. It turns an untrusted fenced block into a validated
// REQUEST and hands that to the constructor, where SimplePage runs it through
// handleAiGenerate — the function that owns the no-garment guard, the
// isolate-background guard, slogan quote-extraction and the pro-model routing
// Georgian slogans depend on. Nothing here may grow a shortcut past it.
//
// Mirrors mockupSuggestion.ts deliberately: same fence discipline (strip on ANY
// match so raw JSON can never reach the customer, parse separately), same
// tolerant-but-never-inventive validation, same "a failure yields prose alone
// and NO button" contract.
import { getStyleOptions } from "@/lib/designStyles";
import type { Lang } from "@/lib/i18n";
import { catalog, PRODUCTS, COLORS, type ProductType, type ProductColor } from "@/lib/catalog";
import {
  writeConstructorSeed,
  MAX_SEED_PROMPT_LENGTH,
  type ConstructorSeed,
  type SeedGenerate,
} from "@/lib/constructorSeed";
import { offerToLiveConstructor } from "@/lib/constructorBridge";
import {
  CONSTRUCTOR_URL,
  parseMockupSuggestion,
  stripMockupFence,
  type MockupSuggestion,
} from "@/lib/mockupSuggestion";

const GENERATE_FENCE_RE = /```maika-generate\b[\s\S]*?(?:```|$)/g;

/** Case- and whitespace-insensitive comparison key. Same rule as the mockup module. */
const norm = (s: string) => s.trim().toLowerCase();

// ── The style enum ────────────────────────────────────────────────────────
//
// getStyleOptions returns the panel's own chips, and the label is passed
// VERBATIM to the proxy as the `style` param — that string is load-bearing
// (the proxy's isRealistic routing reads it), which is exactly why the model is
// never allowed to invent one.
//
// The two language lists are INDEX-PARALLEL — getStyleOptions("en")[i] and
// getStyleOptions("ge")[i] are the same style — so an index is a
// language-independent identity for a style, and every conversion below is an
// index lookup rather than a translation table.
const EN_STYLES = getStyleOptions("en");
const KA_STYLES = getStyleOptions("ge");

/** The wire vocabulary. English, because it does not move with the page language. */
export const STYLE_ENUM: readonly string[] = EN_STYLES;

/** Auto — the constructor's own default, and what any unrecognised value becomes. */
export const STYLE_AUTO = "";

/**
 * The index of a style named in EITHER language, or -1.
 *
 * MATCHING RULES, in full:
 *   1. Non-strings and blanks resolve to -1.
 *   2. Comparison is trim + lowercase on both sides. Nothing else — no
 *      substring matching, no prefix matching, no fuzzy distance. "anime-ish"
 *      is not Anime; it is unknown, and unknown means Auto.
 *   3. English is tried first (the KB instructs English), then Georgian, so a
 *      reply that used the localised chip label still resolves.
 *   4. That is the whole algorithm. A style is a member of a closed set or it
 *      is not a style.
 */
function styleIndex(raw: unknown): number {
  if (typeof raw !== "string") return -1;
  const n = norm(raw);
  if (!n) return -1;
  const en = EN_STYLES.findIndex((s) => norm(s) === n);
  if (en >= 0) return en;
  return KA_STYLES.findIndex((s) => norm(s) === n);
}

/**
 * Canonicalise a model-supplied style to its ENGLISH enum label for the wire.
 * Anything unrecognised becomes STYLE_AUTO ("") — never the raw string, because
 * the raw string would reach the generation params untouched.
 */
export function canonicalStyle(raw: unknown): string {
  const i = styleIndex(raw);
  return i >= 0 ? EN_STYLES[i] : STYLE_AUTO;
}

/**
 * The label to hand the constructor's own style state, in ITS page language —
 * the same string the customer would have got by tapping the chip. Re-validates
 * rather than trusting the seed, since localStorage is writable by anything on
 * the origin.
 */
export function styleForLang(canonical: unknown, lang: Lang): string {
  const i = styleIndex(canonical);
  return i >= 0 ? getStyleOptions(lang)[i] : STYLE_AUTO;
}

// ── The block ─────────────────────────────────────────────────────────────

export interface GenerateSuggestion {
  /** What to draw — the customer's own description. Always present. */
  prompt: string;
  /** Canonical English enum label, or "" for Auto. */
  style: string;
  /** Defaults to false — the site's own default — when absent or unparseable. */
  withBackground: boolean;
  /** Optional product context, validated exactly as the mockup block's is. */
  product?: ProductType;
  subProduct?: string;
  color?: ProductColor;
  side?: "front" | "back";
}

/** Remove every maika-generate fence (closed OR truncated) from displayed text. */
export function stripGenerateFence(raw: string): string {
  return raw.replace(GENERATE_FENCE_RE, "").trim();
}

/** Resolve a product TYPE, case-insensitively, against the real catalog. */
function resolveProductType(raw: string): ProductType | null {
  return PRODUCTS.find((p) => norm(p.type) === norm(raw))?.type ?? null;
}

/** Resolve a BRAND to its owning product type by scanning the catalog itself. */
function resolveBrand(raw: string): { product: ProductType; subProduct: string } | null {
  for (const p of PRODUCTS) {
    const hit = catalog.getSubProducts(p.type).find((s) => norm(s) === norm(raw));
    if (hit) return { product: p.type, subProduct: hit };
  }
  return null;
}

/**
 * Parse + validate the fenced generation block.
 *
 * The prompt is the only REQUIRED field: without something to draw there is
 * nothing to trigger, so a block without one is rejected outright and the prose
 * stands alone. Every other field is dropped individually when it does not
 * resolve, leaving the constructor on whatever it already holds.
 */
export function parseGenerateSuggestion(raw: string): GenerateSuggestion | null {
  try {
    const match = raw.match(/```maika-generate\s*([\s\S]*?)```/); // closed fence only
    if (!match) return null;
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const prompt = typeof parsed.prompt === "string"
      ? parsed.prompt.trim().slice(0, MAX_SEED_PROMPT_LENGTH)
      : "";
    if (!prompt) return null;

    const out: GenerateSuggestion = {
      prompt,
      style: canonicalStyle(parsed.style),
      // Tolerant of a quoted boolean — models emit "true" as often as true —
      // but of nothing else. Anything unrecognised is the default, false.
      withBackground:
        parsed.withBackground === true ||
        (typeof parsed.withBackground === "string" && norm(parsed.withBackground) === "true"),
    };

    // product — a real type, or a brand mistakenly put here (the common error).
    if (typeof parsed.product === "string") {
      const asType = resolveProductType(parsed.product);
      if (asType) {
        out.product = asType;
      } else {
        const asBrand = resolveBrand(parsed.product);
        if (asBrand) {
          out.product = asBrand.product;
          out.subProduct = asBrand.subProduct;
        }
      }
    }

    // subProduct — resolved within the product's own brand list; an explicit
    // value wins over one inferred from the `product` slot above.
    if (typeof parsed.subProduct === "string") {
      const base = out.product ?? "T-Shirt";
      const hit = catalog.getSubProducts(base).find((s) => norm(s) === norm(parsed.subProduct as string));
      if (hit) {
        out.subProduct = hit;
        if (!out.product) out.product = base;
      } else {
        const asBrand = resolveBrand(parsed.subProduct);
        if (asBrand && !out.product) {
          out.product = asBrand.product;
          out.subProduct = asBrand.subProduct;
        }
      }
    }

    // colour — canonical name, then confirmed available for the resolved
    // product + brand. Not offered → dropped, the rest kept.
    if (typeof parsed.color === "string") {
      const canonical = COLORS.find((c) => norm(c.name) === norm(parsed.color as string))?.name;
      if (canonical) {
        const base = out.product ?? "T-Shirt";
        const sub = out.subProduct ?? catalog.getDefaultSubProduct(base);
        if (catalog.getAvailableColors(base, sub).includes(canonical)) out.color = canonical;
      }
    }

    // side — front|back, case-insensitive; anything else is dropped.
    if (typeof parsed.side === "string") {
      const s = norm(parsed.side);
      if (s === "front" || s === "back") out.side = s;
    }

    return out;
  } catch {
    return null;
  }
}

/**
 * A turn's suggestion, at most one, plus the prose with EVERY fence removed.
 *
 * Both chats call this instead of running the strip/parse dance themselves, so
 * the precedence rule below cannot drift between them.
 *
 * PRECEDENCE: a generate block wins and the mockup block is discarded. This is
 * not a preference, it is forced by the storage contract — there is ONE seed
 * key, consumed once, so two pending handoffs cannot coexist; and the two
 * buttons would send the customer to two different outcomes from one bubble.
 * The cost is real but small: a reply carrying both loses its mockup, and the
 * customer reaches the same constructor either way, one step later.
 *
 * Both fences are stripped from the text unconditionally, whatever the parse
 * did, so raw JSON can never reach a bubble.
 */
export type ChatSuggestion =
  | { kind: "generate"; generate: GenerateSuggestion }
  | { kind: "mockup"; mockup: MockupSuggestion };

export function parseChatSuggestion(
  raw: string,
  hasAttachment: boolean,
): { text: string; suggestion: ChatSuggestion | null } {
  const generate = parseGenerateSuggestion(raw);
  // A mockup is only actionable with usable text, or a photo to pair with —
  // the rule the two chats already applied inline.
  const mockup = parseMockupSuggestion(raw);
  const text = stripMockupFence(stripGenerateFence(raw));

  if (generate) return { text, suggestion: { kind: "generate", generate } };
  if (mockup && (mockup.text || hasAttachment)) return { text, suggestion: { kind: "mockup", mockup } };
  return { text, suggestion: null };
}

/** The seed payload for a validated suggestion. Shared by the new-tab and the
 *  in-place handoffs so both carry byte-identical fields. */
export function toSeedGenerate(g: GenerateSuggestion): SeedGenerate {
  return { prompt: g.prompt, style: g.style, withBackground: g.withBackground };
}

/**
 * Hand the generation request to the constructor in a NEW TAB, keeping the
 * caller's conversation intact. Same storage contract as the mockup handoff —
 * one localStorage seed, single-use, TTL'd — because it IS the same seed.
 *
 * @returns true when the new tab opened; false when the popup was blocked and
 *   the caller should fall back to navigating its own tab.
 */
export function openGenerateInConstructor(g: GenerateSuggestion): boolean {
  // A product change without an explicit brand would carry a stale brand from
  // another product; fall back to that product's catalog default.
  const subProduct = g.subProduct ?? (g.product ? catalog.getDefaultSubProduct(g.product) : undefined);
  const seed: ConstructorSeed = {
    product: g.product,
    subProduct,
    color: g.color,
    side: g.side,
    generate: toSeedGenerate(g),
  };

  // Already in the constructor? Generate there rather than in a second copy of
  // the page the customer is looking at. A live SimplePage claims the payload;
  // one that is mid-generation deliberately does not, and we fall through.
  if (offerToLiveConstructor(seed)) return true;

  writeConstructorSeed(seed);

  try {
    // See mockupSuggestion.openMockupInConstructor for why "noopener" must not
    // be in the features string: window.open would then return null on SUCCESS
    // and the popup-blocked fallback would fire every time.
    const opened = window.open(CONSTRUCTOR_URL, "_blank");
    if (opened) {
      opened.opener = null;
      return true;
    }
  } catch {
    /* fall through to the caller's same-tab fallback */
  }
  return false;
}
