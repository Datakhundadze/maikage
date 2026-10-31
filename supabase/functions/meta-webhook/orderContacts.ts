// DM orders — the customer's phone / email, captured from the RAW inbound text.
//
// social_messages.text is masked at rest (redactPii.ts: „[phone:***56]"), so
// by the time the bot reads the thread the number is gone. handler.ts calls
// extractContacts on the raw text of each inbound message, BEFORE masking,
// and the result travels only in memory to runAutoReply, which writes it into
// social_order_drafts.customer (admin-only RLS) — and only for a conversation
// the bot actually serves. It is never logged and never sent to the model.
//
// The patterns and the "our own numbers" allow-list are the ones redactPii
// uses, so exactly what gets masked is what gets captured (a test checks the
// two agree). redactPii.ts itself is an identity-tested copy and stays as is.

const OWN_PHONE_DIGITS = new Set([
  "995322050620",
  "322050620",
  "2050620",
  "995599050807",
  "599050807",
]);
const OWN_EMAILS = new Set(["maika@maika.ge", "info@maika.ge"]);

const PHONE_RE = /[+(]?\d[\d\s()./\\_-]{6,}\d/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MIN_PHONE_DIGITS = 9;

export interface CapturedContacts {
  /** Digits only, a leading "+" kept when the customer typed one. */
  phones: string[];
  /** Lower-cased. */
  emails: string[];
}

export const NO_CONTACTS: CapturedContacts = { phones: [], emails: [] };

/** Phones and emails in one raw message, in the order typed. Pure, never throws. */
export function extractContacts(raw: string | null | undefined): CapturedContacts {
  if (typeof raw !== "string" || !raw) return { phones: [], emails: [] };
  const emails: string[] = [];
  // Emails first (as redactPii): an address can hold a long digit run.
  const rest = raw.replace(EMAIL_RE, (m) => {
    if (!OWN_EMAILS.has(m.toLowerCase())) emails.push(m.toLowerCase());
    return " ";
  });
  const phones: string[] = [];
  for (const m of rest.match(PHONE_RE) ?? []) {
    const digits = m.replace(/\D/g, "");
    if (digits.length < MIN_PHONE_DIGITS || OWN_PHONE_DIGITS.has(digits)) continue;
    phones.push(m.trim().startsWith("+") ? `+${digits}` : digits);
  }
  return { phones, emails };
}

export function hasContacts(c: CapturedContacts | null | undefined): c is CapturedContacts {
  return !!c && (c.phones.length > 0 || c.emails.length > 0);
}

/** Customer jsonb after a new message: the LAST phone / email typed wins. */
export function mergeContacts<T extends object>(customer: T, c: CapturedContacts): T & { phone?: string; email?: string } {
  const out: T & { phone?: string; email?: string } = { ...customer };
  if (c.phones.length > 0) out.phone = c.phones[c.phones.length - 1];
  if (c.emails.length > 0) out.email = c.emails[c.emails.length - 1];
  return out;
}
