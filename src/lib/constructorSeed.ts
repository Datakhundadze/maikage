// One-shot handoff into the Simple-mode constructor.
//
// The constructor is a URL-less mode view at "/", so a design can't be passed
// as a query param (and a base64 photo could never fit in one anyway). This
// mirrors the try-on sessionStorage bridge: the sender writes a seed, navigates
// with setMode("simple"), and SimplePage reads it ONCE on mount and clears it.
//
// Product / brand / colour / side are NOT carried here — those are seeded by
// writing `maika-product-config`, which useProductConfig already restores on
// mount. This seed carries only what the constructor cannot otherwise restore:
// the design layers themselves.
//
// Quota-safe and fully best-effort, exactly like the try-on bridge: every
// sessionStorage call is wrapped, so a QuotaExceededError (a photo can blow the
// ~5MB budget) or a locked-down in-app browser degrades to "no seed" instead of
// throwing. Callers navigate regardless — an empty constructor beats a dead
// button.

const SEED_KEY = "maika-constructor-seed";

/**
 * Cap on seeded text. The constructor itself imposes no limit (its text input
 * has no maxLength), so this is the seed contract's own bound — long enough for
 * any realistic print, short enough that untrusted model output can't stuff the
 * canvas. Enforced on read, and re-used by senders to validate before writing.
 */
export const MAX_SEED_TEXT_LENGTH = 60;

export interface ConstructorSeed {
  /** Text to place as a text layer. */
  text?: string;
  /** Design photo as a base64 data URL — passed in memory, never uploaded. */
  image?: string;
  /** Which side the layers land on. */
  side?: "front" | "back";
}

/**
 * Stash a seed for the constructor.
 * @returns true when it was stored; false if storage refused it (the caller
 *   should still navigate — the constructor simply opens empty).
 */
export function writeConstructorSeed(seed: ConstructorSeed): boolean {
  if (!seed.text && !seed.image) return false;
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
    return true;
  } catch (e) {
    console.warn("[constructorSeed] could not stash seed:", e);
    try { sessionStorage.removeItem(SEED_KEY); } catch { /* ignore */ }
    return false;
  }
}

/** Read the pending seed without consuming it. Returns null when absent/unreadable. */
export function readConstructorSeed(): ConstructorSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConstructorSeed;
    if (!parsed || typeof parsed !== "object") return null;
    const rawText = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const text = rawText ? rawText.slice(0, MAX_SEED_TEXT_LENGTH) : undefined;
    const image = typeof parsed.image === "string" ? parsed.image : undefined;
    const side = parsed.side === "front" || parsed.side === "back" ? parsed.side : undefined;
    if (!text && !image) return null;
    return { text, image, side };
  } catch {
    return null;
  }
}

/** Drop the pending seed. Safe to call when there is none. */
export function clearConstructorSeed(): void {
  try { sessionStorage.removeItem(SEED_KEY); } catch { /* ignore */ }
}
