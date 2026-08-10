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
   * WEARER's sides. Absent or unrecognised → the constructor's default centre
   * placement, i.e. today's behaviour.
   */
  placement?: "center" | "left-chest" | "right-chest";
  /** Product selection, carried here so it survives the new tab. */
  product?: string;
  subProduct?: string;
  color?: string;
  /** Epoch ms, stamped on write; used to discard stale seeds. */
  ts?: number;
}

/**
 * Stash a seed for the constructor.
 * @returns true when it was stored; false if storage refused it (the caller
 *   should still open the constructor — it simply opens empty).
 */
export function writeConstructorSeed(seed: ConstructorSeed): boolean {
  if (!seed.text && !seed.image && !seed.product && !seed.color) return false;
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
    const parsed = JSON.parse(raw) as ConstructorSeed;
    if (!parsed || typeof parsed !== "object") return null;

    // Staleness. A seed with no timestamp is treated as stale.
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > SEED_TTL_MS) return null;

    const rawText = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const text = rawText ? rawText.slice(0, MAX_SEED_TEXT_LENGTH) : undefined;
    const textColor = typeof parsed.textColor === "string" ? parsed.textColor : undefined;
    const image = typeof parsed.image === "string" ? parsed.image : undefined;
    const side = parsed.side === "front" || parsed.side === "back" ? parsed.side : undefined;
    const placement =
      parsed.placement === "center" || parsed.placement === "left-chest" || parsed.placement === "right-chest"
        ? parsed.placement
        : undefined;
    const product = typeof parsed.product === "string" ? parsed.product : undefined;
    const subProduct = typeof parsed.subProduct === "string" ? parsed.subProduct : undefined;
    const color = typeof parsed.color === "string" ? parsed.color : undefined;

    if (!text && !image && !product && !color) return null;
    return { text, textColor, image, side, placement, product, subProduct, color };
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
