// Shared maika-mockup suggestion pipeline: fence stripping, JSON parsing,
// catalog validation and the seed-write handoff. Used by BOTH the standalone
// /chat page and the floating ChatWidget, so the two can never drift apart.
//
// Moved here verbatim from ChatPage — the parsing and validation below are
// byte-for-byte what ChatPage ran before the extraction.
import { catalog, PRODUCTS, COLORS, type ProductType, type ProductColor } from "@/lib/catalog";
import { TEXT_COLORS } from "@/lib/textColors";
import { resolveNearestColor } from "@/lib/nearestColor";
import {
  writeConstructorSeed,
  withCurrentProductConfig,
  MAX_SEED_TEXT_LENGTH,
  MAX_SEED_PROMPT_LENGTH,
  type ConstructorSeed,
} from "@/lib/constructorSeed";
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
  placement?: "center" | "small" | "left-chest" | "right-chest" | "jersey-back";
  /** Squad number, digits only. Meaningful only with placement "jersey-back". */
  number?: string;
  /** A NAME from the constructor's text-colour palette, never a raw hex. */
  textColor?: string;
  /** Remove the background from the attached photo once it is placed. */
  removeBackground?: boolean;
  /**
   * A free-text edit to apply to the ATTACHED photo — "add black round glasses
   * to the dog". Meaningful only with a photo, which the caller checks.
   *
   * The chat previously had no way to say this. A customer who uploaded a photo
   * and asked for a change got the photo placed unedited plus prose telling
   * them which button to press, because the block vocabulary had no field for
   * the request and prose was the only thing left to offer.
   */
  editPrompt?: string;
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

/**
 * The catalog question withCurrentProductConfig needs but must not import:
 * does this product + brand actually offer this colour?
 *
 * Injected into the seed module so it stays free of catalog knowledge, and it
 * lives HERE rather than in generateSuggestion because that module already
 * imports this one — the other direction would close an import cycle.
 */
export function colorIsAvailable(product: string, subProduct: string, color: string): boolean {
  try {
    return catalog.getAvailableColors(product as ProductType, subProduct).includes(color as ProductColor);
  } catch {
    return false;
  }
}

/**
 * A garment colour the customer asked for, resolved to something the product +
 * brand ACTUALLY stocks — or null when nothing in the same family is offered.
 *
 * Replaces a straight availability test that discarded anything not stocked and
 * let the garment fall to the default. See lib/nearestColor for the rule and
 * for why „ლურჯი" used to produce a WHITE shirt.
 *
 * A name outside the palette entirely is still tried against the available list
 * (families are matched on words, not on palette membership), so "Navy Blue" —
 * which is not a palette entry — can still land on Dark Navy instead of being
 * thrown away.
 *
 * null means "we could not honour this" and is NEVER the same as "use the
 * default": every caller leaves the field unset so the customer's current
 * selection stands.
 */
export function resolveGarmentColor(
  requested: string,
  product: ProductType,
  subProduct: string,
): ProductColor | null {
  try {
    const available = catalog.getAvailableColors(product, subProduct);
    const canonical = COLORS.find((c) => norm(c.name) === norm(requested))?.name;
    const hit = resolveNearestColor(canonical ?? requested, available, COLORS);
    return (hit as ProductColor) ?? null;
  } catch {
    return null;
  }
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

    // colour — resolved to something this product + brand actually stocks. A
    // name that is not offered is no longer discarded: resolveGarmentColor maps
    // it to the nearest stocked shade of the SAME family, so „ლურჯი" reaches a
    // blue instead of leaving the customer on a white shirt. Only when the
    // family is not stocked at all does the field stay unset — and unset means
    // "keep what they already chose", never "use the default".
    if (typeof parsed.color === "string") {
      const ctx = storedProductContext();
      const base = out.product ?? ctx.product;
      const sub = out.subProduct ?? (out.product ? catalog.getDefaultSubProduct(base) : ctx.subProduct);
      const resolved = resolveGarmentColor(parsed.color, base, sub);
      if (resolved) out.color = resolved;
    }

    // removeBackground — tolerant of a quoted boolean, as models emit "true" as
    // often as true. Anything else is simply absent; it is only meaningful when
    // a photo is attached, which the caller checks.
    if (parsed.removeBackground === true ||
        (typeof parsed.removeBackground === "string" && norm(parsed.removeBackground) === "true")) {
      out.removeBackground = true;
    }

    // editPrompt — the customer's own words for a change to the attached photo.
    // Bounded by the PROMPT cap: this describes a change to a picture, it is not
    // words printed on a garment. Kept verbatim otherwise — narrowing it would
    // mean guessing at intent the customer already stated.
    if (typeof parsed.editPrompt === "string") {
      const e = parsed.editPrompt.trim();
      if (e) out.editPrompt = e.slice(0, MAX_SEED_PROMPT_LENGTH);
    }

    // number — a squad number for the jersey-back arrangement. Digits only, so
    // the second text layer can never become a smuggled extra caption.
    if (typeof parsed.number === "string" || typeof parsed.number === "number") {
      const n = String(parsed.number).trim();
      if (/^\d{1,3}$/.test(n)) out.number = n;
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
      if (pl === "center" || pl === "small" || pl === "left-chest" || pl === "right-chest" || pl === "jersey-back") out.placement = pl;
    }

    // textColor — a NAME from the constructor's own text palette, never a raw
    // hex. Same family rule as the garment colour: "Light Blue" or "Navy Blue"
    // used to miss the exact match and silently become BLACK, which looks like
    // the bot ignoring the request. Now they land on Blue and Navy. A name with
    // no family here is still left unset, and SimplePage says so out loud
    // rather than blackening in silence.
    if (typeof parsed.textColor === "string") {
      const hit = resolveNearestColor(
        parsed.textColor,
        TEXT_COLORS.map((c) => c.name),
        TEXT_COLORS,
      );
      if (hit) out.textColor = hit;
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
  // Gaps the model left in product/brand/colour are filled from what the
  // customer is actually looking at, BEFORE the catalog default below — the
  // new tab cannot see their sessionStorage, so this is the only chance.
  const merged = withCurrentProductConfig({
    text: m.text,
    textColor: m.textColor,
    image: attachment ?? undefined,
    // Only with a photo to act on.
    removeBackground: attachment && m.removeBackground ? true : undefined,
    // Same rule: an edit with no photo to act on is noise.
    editPrompt: attachment && m.editPrompt ? m.editPrompt : undefined,
    // jersey-back is by definition the BACK of the shirt; fill it in when the
    // model named the placement but forgot the side, without overriding an
    // explicit one.
    side: m.side ?? (m.placement === "jersey-back" ? "back" : undefined),
    placement: m.placement,
    number: m.number,
    product: m.product,
    subProduct: m.subProduct,
    color: m.color,
  }, colorIsAvailable);
  const seed: ConstructorSeed = {
    ...merged,
    // A product change without an explicit brand would carry a stale brand from
    // another product; fall back to that product's catalog default.
    subProduct: merged.subProduct ?? (merged.product ? catalog.getDefaultSubProduct(merged.product) : undefined),
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
