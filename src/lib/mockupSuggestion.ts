// Shared maika-mockup suggestion pipeline: fence stripping, JSON parsing,
// catalog validation and the seed-write handoff. Used by BOTH the standalone
// /chat page and the floating ChatWidget, so the two can never drift apart.
//
// Moved here verbatim from ChatPage — the parsing and validation below are
// byte-for-byte what ChatPage ran before the extraction.
import { catalog, PRODUCTS, COLORS, type ProductType, type ProductColor } from "@/lib/catalog";
import { TEXT_COLORS } from "@/lib/textColors";
import { writeConstructorSeed, MAX_SEED_TEXT_LENGTH, type ConstructorSeed } from "@/lib/constructorSeed";
import { offerToLiveConstructor } from "@/lib/constructorBridge";

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

  // Already standing in the constructor? Apply it there and open nothing. Only
  // a live SimplePage can answer yes, and it answers by taking the payload —
  // see constructorBridge. Nothing below changes when it declines.
  if (offerToLiveConstructor(seed)) return true;

  writeConstructorSeed(seed);

  try {
    // NOTE: do NOT pass "noopener"/"noreferrer" in the features string. Per the
    // HTML spec window.open() returns null whenever those are set — even on
    // success — so the popup-blocked test would ALWAYS fire and the caller's tab
    // would navigate away too. Sever the opener manually instead: same
    // protection, and a truthy handle we can actually test.
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
