// One-shot handoff into the Simple-mode constructor.
//
// STORAGE: localStorage, NOT sessionStorage. The handoff opens the constructor
// in a NEW TAB, and sessionStorage is per-tab — a sessionStorage seed would
// silently vanish and the constructor would open blank. localStorage is shared
// across tabs of the same origin, so the new tab can read it.
//
// SINGLE KEY: the product selection travels INSIDE this same object rather than
// through `maika-product-config` (also sessionStorage, also lost across tabs),
// so layers and product selection can never arrive out of sync.
//
// SINGLE USE: the reader consumes it — reads and deletes in one step, before
// applying anything — so a seed can never replay on a later visit.
//
// STALENESS: every seed is timestamped and anything older than SEED_TTL_MS is
// discarded, so an abandoned seed can never attach itself to an unrelated visit
// days later.
//
// Quota-safe throughout: every storage call is wrapped, so a QuotaExceededError
// or a locked-down in-app browser degrades to "no seed" instead of throwing.

const SEED_KEY = "maika-constructor-seed";

/** A seed older than this is ignored. Long enough for a slow tab to open. */
const SEED_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Cap on seeded text. The constructor itself imposes no limit (its text input
 * has no maxLength), so this is the seed contract's own bound — long enough for
 * any realistic print, short enough that untrusted model output can't stuff the
 * canvas. Enforced on read, and re-used by senders to validate before writing.
 */
export const MAX_SEED_TEXT_LENGTH = 60;

/**
 * Cap on a seeded GENERATION prompt. Deliberately separate from — and much
 * larger than — MAX_SEED_TEXT_LENGTH: that one bounds words PRINTED on a
 * garment, this one bounds a description of a picture, which is a different
 * kind of string. Still bounded, because the payload is untrusted model output.
 */
export const MAX_SEED_PROMPT_LENGTH = 400;

/**
 * A generation request riding along in the seed.
 *
 * The constructor does not generate from this directly — it hands it to
 * SimplePage's own handleAiGenerate, which owns the no-garment guard, the
 * isolate-background guard, slogan quote-extraction and the pro-model routing
 * that Georgian slogans depend on. This is a REQUEST, not a pipeline call.
 */
export interface SeedGenerate {
  /** What to draw. The customer's intent, in their own words. */
  prompt: string;
  /**
   * A canonical ENGLISH style label from getStyleOptions("en"), or "" for Auto.
   * English is the wire form because it is stable across the page language;
   * the reader maps it back to its own locale's label. Validated on both sides.
   */
  style: string;
  /** true → keep the generated background; false → the site default (cut out). */
  withBackground: boolean;
}

export interface ConstructorSeed {
  /** Text to place as a text layer. */
  text?: string;
  /** Text colour — a name from the constructor's own palette (see textColors.ts). */
  textColor?: string;
  /** Design photo as a base64 data URL — passed in memory, never uploaded. */
  image?: string;
  /** Which side the layers land on. */
  side?: "front" | "back";
  /**
   * Where on the garment the design sits. "left-chest"/"right-chest" are the
   * WEARER's sides. "small" is a centred print at the pre-2026-08 default size.
   * Absent or unrecognised → the standard centred print.
   */
  placement?: "center" | "small" | "left-chest" | "right-chest";
  /** Product selection, carried here so it survives the new tab. */
  product?: string;
  subProduct?: string;
  color?: string;
  /**
   * Ask the constructor to run an AI generation once it has settled on the
   * product selection above. Absent → today's behaviour exactly.
   */
  generate?: SeedGenerate;
  /** Epoch ms, stamped on write; used to discard stale seeds. */
  ts?: number;
}

/**
 * Stash a seed for the constructor.
 * @returns true when it was stored; false if storage refused it (the caller
 *   should still open the constructor — it simply opens empty).
 */
export function writeConstructorSeed(seed: ConstructorSeed): boolean {
  if (!seed.text && !seed.image && !seed.product && !seed.color && !seed.generate) return false;
  try {
    localStorage.setItem(SEED_KEY, JSON.stringify({ ...seed, ts: Date.now() }));
    return true;
  } catch (e) {
    console.warn("[constructorSeed] could not stash seed:", e);
    try { localStorage.removeItem(SEED_KEY); } catch { /* ignore */ }
    return false;
  }
}

/** Drop the pending seed. Safe to call when there is none. */
export function clearConstructorSeed(): void {
  try { localStorage.removeItem(SEED_KEY); } catch { /* ignore */ }
}

/**
 * Validate an arbitrary object into a seed, or null.
 *
 * Extracted from consumeConstructorSeed so the SAME rules apply to a seed
 * handed over IN-PROCESS (the live-constructor handoff) as to one read back out
 * of localStorage. A second copy of this would be a second place for the two
 * paths to disagree about what a seed is.
 */
export function normalizeConstructorSeed(input: unknown): ConstructorSeed | null {
  try {
    const parsed = input as ConstructorSeed;
    if (!parsed || typeof parsed !== "object") return null;

    // Staleness. A seed with no timestamp is treated as stale.
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > SEED_TTL_MS) return null;

    const rawText = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const text = rawText ? rawText.slice(0, MAX_SEED_TEXT_LENGTH) : undefined;
    const textColor = typeof parsed.textColor === "string" ? parsed.textColor : undefined;
    const image = typeof parsed.image === "string" ? parsed.image : undefined;
    const side = parsed.side === "front" || parsed.side === "back" ? parsed.side : undefined;
    const placement =
      parsed.placement === "center" || parsed.placement === "small" ||
      parsed.placement === "left-chest" || parsed.placement === "right-chest"
        ? parsed.placement
        : undefined;
    const product = typeof parsed.product === "string" ? parsed.product : undefined;
    const subProduct = typeof parsed.subProduct === "string" ? parsed.subProduct : undefined;
    const color = typeof parsed.color === "string" ? parsed.color : undefined;

    // Generation request. Re-validated HERE as well as at write time, because
    // localStorage is writable by anything on the origin — the reader must not
    // trust the shape it finds. A prompt that does not survive drops the whole
    // `generate` field; the rest of the seed still applies.
    let generate: SeedGenerate | undefined;
    const g = (parsed as { generate?: unknown }).generate;
    if (g && typeof g === "object") {
      const raw = (g as { prompt?: unknown }).prompt;
      const prompt = typeof raw === "string" ? raw.trim().slice(0, MAX_SEED_PROMPT_LENGTH) : "";
      if (prompt) {
        const style = typeof (g as { style?: unknown }).style === "string"
          ? ((g as { style: string }).style)
          : "";
        generate = {
          prompt,
          style,
          withBackground: (g as { withBackground?: unknown }).withBackground === true,
        };
      }
    }

    if (!text && !image && !product && !color && !generate) return null;
    return { text, textColor, image, side, placement, product, subProduct, color, generate };
  } catch {
    return null;
  }
}

/**
 * Read the pending seed AND delete it in the same step, so it is applied at
 * most once. Returns null when absent, unreadable, stale, or empty.
 */
export function consumeConstructorSeed(): ConstructorSeed | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SEED_KEY);
  } catch {
    return null;
  }
  // Delete FIRST: even a malformed or stale seed must not linger.
  clearConstructorSeed();
  if (!raw) return null;

  try {
    return normalizeConstructorSeed(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** True when a fresh seed is pending — used to force constructor mode on load. */
export function hasPendingConstructorSeed(): boolean {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as ConstructorSeed;
    return typeof parsed?.ts === "number" && Date.now() - parsed.ts <= SEED_TTL_MS;
  } catch {
    return false;
  }
}
