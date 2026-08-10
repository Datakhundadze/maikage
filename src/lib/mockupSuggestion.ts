// Shared maika-mockup suggestion pipeline: fence stripping, JSON parsing,
// catalog validation and the seed-write handoff. Used by BOTH the standalone
// /chat page and the floating ChatWidget, so the two can never drift apart.
//
// Moved here verbatim from ChatPage — the parsing and validation below are
// byte-for-byte what ChatPage ran before the extraction.
import { catalog, PRODUCTS, COLORS, type ProductType, type ProductColor } from "@/lib/catalog";
import { TEXT_COLORS } from "@/lib/textColors";
import { writeConstructorSeed, type ConstructorSeed, MAX_SEED_TEXT_LENGTH, MAX_SEED_PROMPT_LENGTH } from "@/lib/constructorSeed";
import { getStyleOptions } from "@/lib/designStyles";

/**
 * In-place handoff channel. When the customer is ALREADY in the constructor —
 * the floating widget is on every page, including "/" in simple mode — opening
 * a new tab is absurd. SimplePage listens for this event and applies the
 * payload exactly like a mount seed.
 *
 * DETECTION is self-synchronizing rather than a flag: the event is dispatched
 * CANCELABLE, SimplePage's listener calls preventDefault(), and
 * window.dispatchEvent() returns false when something prevented it. So a false
 * return means "a live SimplePage handled it" and a true return means "nobody
 * listened" — no mount/unmount bookkeeping to go stale.
 */
export const CONSTRUCTOR_APPLY_EVENT = "maika:constructor-apply";

/** @returns true when a live constructor consumed it; false → use the tab. */
function applyConstructorSeedInPlace(seed: ConstructorSeed): boolean {
  try {
    const ev = new CustomEvent<ConstructorSeed>(CONSTRUCTOR_APPLY_EVENT, {
      detail: seed,
      cancelable: true,
    });
    // dispatchEvent → false means preventDefault() was called → handled.
    return window.dispatchEvent(ev) === false;
  } catch {
    return false;
  }
}

/** The constructor entry point — mode is signalled by the query param. */
export const CONSTRUCTOR_URL = "/?constructor=1";

// ── Mockup suggestion ────────────────────────────────────────────────────
// The model may append a fenced ```maika-mockup block after its prose. It is
// UNTRUSTED: the fence is stripped from the text on ANY match (so raw JSON can
// never reach the customer, even when parsing fails), parsed separately, and
// every field validated against the real catalog. Any failure — no fence,
// truncated fence, invalid JSON, unknown product/colour, empty payload —
// yields prose alone and NO button. Never a broken button, never an error.
const MOCKUP_FENCE_RE = /```maika-mockup\b[\s\S]*?(?:```|$)/g;

// useProductConfig's sessionStorage key. Read-only here, purely to know which
// product THIS tab is currently on so an unresolvable field can fall back
// sensibly during validation. The handoff itself does NOT go through this key —
// it is sessionStorage, which the new tab would not inherit; the product
// selection travels inside the localStorage seed instead.
const PRODUCT_CONFIG_KEY = "maika-product-config";

export interface MockupSuggestion {
  text?: string;
  product?: ProductType;
  subProduct?: string;
  color?: ProductColor;
  side?: "front" | "back";
  placement?: "center" | "left-chest" | "right-chest";
  /** A NAME from the constructor's text-colour palette, never a raw hex. */
  textColor?: string;
}

/** Remove every maika-mockup fence (closed OR truncated) from displayed text. */
export function stripMockupFence(raw: string): string {
  return raw.replace(MOCKUP_FENCE_RE, "").trim();
}

/** Case- and whitespace-insensitive comparison key. */
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Placeholder text the model sometimes emits instead of the customer's own
 * words. Accepting these would print "your text" on a shirt, so they are
 * dropped (the block survives if a photo is attached).
 */
const PLACEHOLDER_TEXTS = new Set([
  "თქვენი ტექსტი",
  "თქვენი ტექსტი აქ",
  "your text",
  "your text here",
  "text",
  "ტექსტი",
  "...",
  "…",
]);

/** Resolve a product TYPE, case-insensitively, against the real catalog. */
function resolveProductType(raw: string): ProductType | null {
  return PRODUCTS.find((p) => norm(p.type) === norm(raw))?.type ?? null;
}

/**
 * Resolve a BRAND to its owning product type by scanning the catalog's own
 * sub-product lists. This is what rescues the most common model error —
 * a brand ("GILDAN") placed in the `product` slot.
 */
function resolveBrand(raw: string): { product: ProductType; subProduct: string } | null {
  for (const p of PRODUCTS) {
    const hit = catalog.getSubProducts(p.type).find((s) => norm(s) === norm(raw));
    if (hit) return { product: p.type, subProduct: hit };
  }
  return null;
}

/** Read the product/brand currently stored for the constructor, for fallbacks. */
function storedProductContext(): { product: ProductType; subProduct: string } {
  const fallback: ProductType = "T-Shirt";
  try {
    const raw = sessionStorage.getItem(PRODUCT_CONFIG_KEY);
    const cfg = raw ? (JSON.parse(raw) as { product?: string; subProduct?: string }) : {};
    const product = (cfg.product && resolveProductType(cfg.product)) || fallback;
    const subs = catalog.getSubProducts(product);
    const subProduct =
      (cfg.subProduct && subs.find((s) => norm(s) === norm(cfg.subProduct!))) ||
      catalog.getDefaultSubProduct(product);
    return { product, subProduct };
  } catch {
    return { product: fallback, subProduct: catalog.getDefaultSubProduct(fallback) };
  }
}


/**
 * Validate the product fields shared by BOTH fenced blocks, so mockup and
 * generate can never disagree about what a valid product/brand/colour is.
 * Every surviving value is a real catalog entry; unresolvable fields are
 * dropped (the constructor keeps whatever it already has).
 */
function parseSharedProductFields(parsed: Record<string, unknown>): {
  product?: ProductType; subProduct?: string; color?: ProductColor; side?: "front" | "back";
} {
  const out: { product?: ProductType; subProduct?: string; color?: ProductColor; side?: "front" | "back" } = {};

  if (typeof parsed.product === "string") {
    const asType = resolveProductType(parsed.product);
    if (asType) {
      out.product = asType;
    } else {
      const asBrand = resolveBrand(parsed.product);
      if (asBrand) { out.product = asBrand.product; out.subProduct = asBrand.subProduct; }
    }
  }

  if (typeof parsed.subProduct === "string") {
    const base = out.product ?? storedProductContext().product;
    const hit = catalog.getSubProducts(base).find((sp) => norm(sp) === norm(parsed.subProduct as string));
    if (hit) {
      out.subProduct = hit;
      if (!out.product) out.product = base;
    } else {
      const asBrand = resolveBrand(parsed.subProduct);
      if (asBrand && !out.product) { out.product = asBrand.product; out.subProduct = asBrand.subProduct; }
    }
  }

  if (typeof parsed.color === "string") {
    const canonical = COLORS.find((c) => norm(c.name) === norm(parsed.color as string))?.name;
    if (canonical) {
      const ctx = storedProductContext();
      const base = out.product ?? ctx.product;
      const sub = out.subProduct ?? (out.product ? catalog.getDefaultSubProduct(base) : ctx.subProduct);
      if (catalog.getAvailableColors(base, sub).includes(canonical)) out.color = canonical;
    }
  }

  if (typeof parsed.side === "string") {
    const sd = norm(parsed.side);
    if (sd === "front" || sd === "back") out.side = sd;
  }

  return out;
}

/**
 * Open the constructor in a new tab.
 * @returns true when the tab opened; false when the popup was blocked and the
 *   caller should fall back to navigating its own tab.
 */
function openConstructorTab(): boolean {
  try {
    // NOTE: do NOT pass "noopener"/"noreferrer" in the features string — per the
    // HTML spec window.open() then returns null even on success, so the blocked
    // test would always fire. Sever the opener manually instead.
    const opened = window.open(CONSTRUCTOR_URL, "_blank");
    if (opened) { opened.opener = null; return true; }
  } catch { /* fall through */ }
  return false;
}

/**
 * Parse + validate the fenced block.
 *
 * TOLERANT BUT NEVER INVENTIVE: matching is case- and whitespace-insensitive,
 * and a brand in the `product` slot is re-homed to `subProduct` with its type
 * inferred — but every value that survives is a REAL catalog entry, taken from
 * PRODUCTS / catalog.getSubProducts() / catalog.getAvailableColors(). A field
 * that cannot be resolved is DROPPED (the constructor then keeps whatever is
 * already in maika-product-config) rather than rejecting the whole block.
 *
 * The block is rejected outright only when nothing usable is left — no valid
 * text and (per the caller) no attached photo.
 */
export function parseMockupSuggestion(raw: string): MockupSuggestion | null {
  try {
    const match = raw.match(/```maika-mockup\s*([\s\S]*?)```/); // closed fence only
    if (!match) return null;
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const out: MockupSuggestion = {};

    // text — the customer's ACTUAL words. Placeholders are dropped, not printed.
    if (typeof parsed.text === "string") {
      const t = parsed.text.trim();
      if (t && t.length <= MAX_SEED_TEXT_LENGTH && !PLACEHOLDER_TEXTS.has(norm(t))) {
        out.text = t;
      }
    }

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
        // Unresolvable → dropped; the stored config's product stands.
      }
    }

    // subProduct — resolved within the product's own brand list. An explicit
    // value wins over one inferred from the `product` slot above.
    if (typeof parsed.subProduct === "string") {
      const base = out.product ?? storedProductContext().product;
      const hit = catalog.getSubProducts(base).find((s) => norm(s) === norm(parsed.subProduct as string));
      if (hit) {
        out.subProduct = hit;
        if (!out.product) out.product = base;
      } else {
        // Maybe it names a brand of a DIFFERENT product than the one given.
        const asBrand = resolveBrand(parsed.subProduct);
        if (asBrand && !out.product) {
          out.product = asBrand.product;
          out.subProduct = asBrand.subProduct;
        }
        // Otherwise dropped, keeping any brand inferred from `product`.
      }
    }

    // colour — canonical name, then confirmed available for the resolved
    // product + brand (falling back to whatever the constructor already holds).
    if (typeof parsed.color === "string") {
      const canonical = COLORS.find((c) => norm(c.name) === norm(parsed.color as string))?.name;
      if (canonical) {
        const ctx = storedProductContext();
        const base = out.product ?? ctx.product;
        const sub = out.subProduct ?? (out.product ? catalog.getDefaultSubProduct(base) : ctx.subProduct);
        if (catalog.getAvailableColors(base, sub).includes(canonical)) out.color = canonical;
        // Not offered for this product → colour dropped, rest kept.
      }
    }

    // side — front|back, case-insensitive; anything else is dropped.
    if (typeof parsed.side === "string") {
      const s = norm(parsed.side);
      if (s === "front" || s === "back") out.side = s;
    }

    // placement — center|left-chest|right-chest, case-insensitive. Unrecognised
    // values are dropped, which leaves the constructor's default centring.
    if (typeof parsed.placement === "string") {
      const pl = norm(parsed.placement);
      if (pl === "center" || pl === "left-chest" || pl === "right-chest") out.placement = pl;
    }

    // textColor — must NAME a colour in the constructor's own palette. Anything
    // else (including a raw hex) is dropped, leaving the default black.
    if (typeof parsed.textColor === "string") {
      const hit = TEXT_COLORS.find((c) => norm(c.name) === norm(parsed.textColor as string));
      if (hit) out.textColor = hit.name;
    }

    return out;
  } catch {
    return null;
  }
}

/**
 * Hand the design to the constructor in a NEW TAB, keeping the caller's
 * conversation intact (no state here is mutated).
 *
 * Everything the constructor needs rides in ONE localStorage seed: layers AND
 * the product selection. sessionStorage would be wrong twice over — both
 * `maika-mode` and `maika-product-config` live there and a new tab inherits
 * neither. Constructor mode is signalled by "?constructor=1", which useAppState
 * honours when initialising `mode`.
 *
 * @returns true when the new tab opened; false when the popup was blocked and
 *   the caller should fall back to navigating its own tab.
 */
export function openMockupInConstructor(m: MockupSuggestion, attachment?: string | null): boolean {
  // A product change without an explicit brand would carry a stale brand from
  // another product; fall back to that product's catalog default.
  const subProduct = m.subProduct ?? (m.product ? catalog.getDefaultSubProduct(m.product) : undefined);
  const seed: ConstructorSeed = {
    text: m.text,
    textColor: m.textColor,
    image: attachment ?? undefined,
    side: m.side,
    placement: m.placement,
    product: m.product,
    subProduct,
    color: m.color,
  };
  // Already in the constructor → apply live, and do NOT persist a seed that
  // would otherwise linger and re-apply on a later visit inside the TTL.
  if (applyConstructorSeedInPlace(seed)) return true;
  writeConstructorSeed(seed);
  return openConstructorTab();
}


// ── Generation suggestion (maika-generate) ───────────────────────────────
// Stage 1: the chat never generates and never shows an image. It emits this
// block, the customer clicks, and generation runs INSIDE the constructor via
// handleAiGenerate — which owns the no-garment / isolate-bg guards, the slogan
// quote-extraction and the forced-Pro routing for Georgian slogans.
const GENERATE_FENCE_RE = /```maika-generate\b[\s\S]*?(?:```|$)/g;

export interface GenerateSuggestion {
  prompt: string;
  /** A real chip value, or "" for Auto. Never free text. */
  style: string;
  withBackground: boolean;
  product?: ProductType;
  subProduct?: string;
  color?: ProductColor;
  side?: "front" | "back";
}

/**
 * Every style chip the constructor offers, both languages, as the canonical
 * strings. Validation matches against this union case-insensitively and returns
 * the CANONICAL value, so `isRealistic` (/realistic|photo|რეალ/i) keeps working
 * for either language. Anything unrecognised falls back to "" (Auto) rather
 * than injecting the raw string into the prompt.
 */
function allStyleOptions(): string[] {
  return [...getStyleOptions("en"), ...getStyleOptions("ge")];
}

/** Resolve a style to a real chip value, or "" (Auto) when unrecognised. */
export function resolveStyle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const key = norm(raw);
  if (!key || key === "auto" || key === "ავტომატური") return "";
  return allStyleOptions().find((o) => norm(o) === key) ?? "";
}

/** Remove every maika-generate fence (closed OR truncated) from displayed text. */
export function stripGenerateFence(raw: string): string {
  return raw.replace(GENERATE_FENCE_RE, "").trim();
}

/**
 * Parse + validate the generation block. Same discipline as the mockup block:
 * a closed fence only, try/catch, every field validated, and null on any
 * failure so the prose stands alone with no button. `prompt` is required.
 */
export function parseGenerateSuggestion(raw: string): GenerateSuggestion | null {
  try {
    const match = raw.match(/```maika-generate\s*([\s\S]*?)```/);
    if (!match) return null;
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (!prompt || prompt.length > MAX_SEED_PROMPT_LENGTH) return null;

    // Reuse the mockup validator for the shared product fields, so the two
    // blocks can never disagree about what a valid product/colour is.
    const shared = parseSharedProductFields(parsed);

    return {
      prompt,
      style: resolveStyle(parsed.style),
      // Absent → today's default (without background).
      withBackground: parsed.withBackground === true,
      ...shared,
    };
  } catch {
    return null;
  }
}

/**
 * Hand a generation to the constructor. Same seed + new-tab mechanics as the
 * mockup handoff; the constructor runs handleAiGenerate on arrival.
 */
export function openGenerateInConstructor(g: GenerateSuggestion): boolean {
  const subProduct = g.subProduct ?? (g.product ? catalog.getDefaultSubProduct(g.product) : undefined);
  const seed: ConstructorSeed = {
    product: g.product,
    subProduct,
    color: g.color,
    side: g.side,
    generate: { prompt: g.prompt, style: g.style, withBackground: g.withBackground },
  };
  if (applyConstructorSeedInPlace(seed)) return true;
  writeConstructorSeed(seed);
  return openConstructorTab();
}
