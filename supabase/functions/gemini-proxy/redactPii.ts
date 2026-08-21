// Mask phone numbers and email addresses before a chat turn is written to
// public.chat_logs.
//
// WHY. chat_logs keeps every turn forever — there is no purge job — and
// customers routinely paste a phone number or an email into the chat ("my
// number is 599 05 08 07, when will my order arrive?"). Those landed in the
// table in plaintext, readable by every admin, and surfaced directly in the
// admin session list, whose `last_user_snippet` is the first 120 characters of
// the last user turn: a phone number fits comfortably inside 120 characters.
//
// ⚠️ WHAT THIS DOES NOT COVER. The model call happens BEFORE this runs, and it
// is sent the raw turn. Redaction here shrinks what we keep AT REST in our own
// database; it does nothing about the copy that reached the AI gateway. Fixing
// that would mean redacting before the model call, which would also stop the
// model from reading back a number the customer wants it to use. Out of scope
// here, and stated plainly rather than implied.
//
// WHAT IS KEPT. The last two digits of a phone and the first character plus
// full domain of an email, so staff can still tie a conversation to an order
// without the log holding the identifier itself.
//
// OUR OWN PUBLISHED CONTACT DETAILS ARE NOT REDACTED. The FAQ_KB instructs the
// bot to hand out the showroom landline, the WhatsApp number and the support
// address; masking those would corrupt the record of what we told the customer
// and make it impossible to audit whether the bot answered correctly. They are
// company facts printed on the website, not personal data.

/** Digits of maika.ge's own published numbers — compared digits-only. */
const OWN_PHONE_DIGITS = new Set([
  "995322050620", // +995 32 2 05 06 20 — showroom landline
  "322050620",
  "2050620",
  "995599050807", // +995 599 05 08 07 — WhatsApp / orders
  "599050807",
]);

/** Our own addresses, lowercased. */
const OWN_EMAILS = new Set(["maika@maika.ge", "info@maika.ge"]);

/**
 * A candidate phone run: an optional leading + or opening bracket, then digits
 * mixed with the separators people actually type. Anchored on a digit at the
 * end so trailing spaces and punctuation are not swallowed into the match. The
 * leading bracket is part of the match so "(995) 577 123 456" does not leave a
 * dangling "(" behind the redaction marker.
 */
const PHONE_RE = /[+(]?\d[\d\s()./\\_-]{6,}\d/g;

/** Conservative address shape — deliberately not RFC 5322. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Minimum digits before a run counts as a phone number.
 *
 * Georgian mobiles are 9 digits (5XX XXX XXX) and the landline with its country
 * code is 12. Nine is therefore the floor. It also keeps ordinary chat intact:
 * an ISO date (2026-08-21) is 8 digits, a price is 2-4, a quantity 1-3 — none
 * reach the threshold, so none are touched.
 */
const MIN_PHONE_DIGITS = 9;

/** Redact one phone match, or return it unchanged when it is not a phone. */
function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS) return match;
  if (OWN_PHONE_DIGITS.has(digits)) return match;
  return `[phone:***${digits.slice(-2)}]`;
}

/** Redact one email match, keeping the first character and the domain. */
function maskEmail(match: string): string {
  if (OWN_EMAILS.has(match.toLowerCase())) return match;
  const at = match.lastIndexOf("@");
  const local = match.slice(0, at);
  const domain = match.slice(at + 1);
  return `[email:${local.slice(0, 1)}***@${domain}]`;
}

/**
 * Mask personal phone numbers and email addresses in a chat turn.
 *
 * Emails are handled FIRST: an address can contain a long digit run
 * (user1234567890@example.com) that the phone pass would otherwise chew into,
 * leaving a mangled half-redaction. Running emails first replaces the whole
 * address with a marker that contains no digit run long enough to re-match.
 *
 * Pure and total — any input returns a string, never throws.
 */
export function redactPii(text: string): string {
  if (!text) return text;
  return text.replace(EMAIL_RE, maskEmail).replace(PHONE_RE, maskPhone);
}
