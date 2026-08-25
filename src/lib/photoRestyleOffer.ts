// The one-per-session nudge that tells a customer the chat can restyle the
// photo they just uploaded.
//
// TWO COMPONENTS, ONE FACT. The upload happens in SimplePage; the badge and the
// message live in the floating ChatWidget, which is mounted separately by App.
// They talk the way this codebase already makes components talk across that
// gap — a CustomEvent on `window`, the same shape constructorBridge uses — and
// not through a store, a context or a prop drilled through the route tree.
//
// ⚠️ EVERYTHING HERE IS LOCAL. The message below is pushed straight into the
// transcript as a `local` bubble. It costs nothing, makes no request, and is
// never parsed for fenced blocks — a local bubble skips that path by
// construction. The customer's REPLY is an ordinary message and goes through
// the ordinary pipeline; nothing about it is special-cased.
import type { Lang } from "@/lib/i18n";

/** Dispatched by the constructor when a photo layer is added. No payload. */
export const PHOTO_UPLOADED_EVENT = "maika:photo-uploaded";

/**
 * ONCE PER SESSION, and the flag is what enforces it.
 *
 * sessionStorage, matching chatPersistence — a returning visitor gets the nudge
 * again on a genuinely new session, and a customer who uploads eleven photos in
 * one sitting is nudged once. Set the instant the offer is made, whether it was
 * made as a badge or straight into an open panel, so neither route can fire
 * twice and the badge cannot come back after being cleared.
 */
export const RESTYLE_OFFER_KEY = "maika-restyle-offer-shown";

/** True once the offer has been made in this tab's session. */
export function restyleOfferAlreadyShown(): boolean {
  try {
    return sessionStorage.getItem(RESTYLE_OFFER_KEY) === "1";
  } catch {
    // Storage blocked (private mode, embedded webview). Report "already shown"
    // so a browser that cannot remember the flag nudges NOBODY rather than
    // nudging on every single upload — the failure that would make this noise.
    return true;
  }
}

/** Mark the offer made. Safe to call twice. */
export function markRestyleOfferShown(): void {
  try {
    sessionStorage.setItem(RESTYLE_OFFER_KEY, "1");
  } catch {
    /* nothing to do — restyleOfferAlreadyShown() already fails closed */
  }
}

/**
 * Tell whoever is listening that a photo just landed on the garment.
 *
 * Deliberately dumb: it announces the fact and nothing more. Whether that
 * becomes a badge, an immediate message or nothing at all is the widget's
 * decision, because only the widget knows whether its panel is open.
 */
export function announcePhotoUploaded(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(PHOTO_UPLOADED_EVENT));
  } catch {
    /* a nudge is not worth an exception */
  }
}

/**
 * The styles offered, in the order they are read out.
 *
 * EDIT THE WORDING HERE. These are the words the customer sees; they are not
 * an enum and nothing parses them. A reply naming one is just a message, and
 * the model resolves it against §12a's own style list — which is why these
 * read as prose rather than as the English values that list accepts.
 */
export const RESTYLE_OFFER_STYLES = [
  "ანიმე",
  "Pixar 3D",
  "ილუსტრაცია",
  "ოილ არტი",
  "კომიქსი",
  "გრაფიკა",
  "აკვარელი",
] as const;

/** The seeded bubble's text. Bilingual, matching every other local bubble. */
export function restyleOfferText(lang: Lang): string {
  const styles = RESTYLE_OFFER_STYLES.join(", ");
  return lang === "en"
    ? `Nice photo! I can redraw it in a different style — ${styles}. Just tell me which one.`
    : `მაგარი ფოტოა! შემიძლია სხვა სტილში გადავხატო — ${styles}. უბრალოდ დამიწერე რომელი გინდა.`;
}
