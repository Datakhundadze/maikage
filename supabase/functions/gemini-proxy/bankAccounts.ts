// The ONLY bank accounts maika.ge accepts transfers on (2026-10-23, from the
// owner's own invoice). The FAQ KB (§9) lists them for the model to copy, and
// fixBankAccounts() is the deterministic safety net behind that: the bot
// replay of 2026-10-23 showed the model INVENTING account numbers when the KB
// had none, and a customer who pays an invented IBAN loses the money.
//
// Plain TypeScript, no Deno APIs — unit-tested from vitest
// (src/test/bankAccounts.test.ts).

export const MAIKA_TBC_IBAN = "GE13TB7099236020100012";
export const MAIKA_BOG_IBAN = "GE89BG0000000536148375";
export const MAIKA_TAX_ID = "404430175";

const ALLOWED = new Set([MAIKA_TBC_IBAN, MAIKA_BOG_IBAN]);

// A Georgian IBAN: GE + 2 check digits + 2-letter bank code + 16 digits,
// optionally written with spaces, optionally followed by a currency suffix.
const IBAN_RE = /GE\s?\d{2}\s?[A-Z]{2}(?:\s?\d){16}(?:\s?(?:GEL|USD|EUR))?/g;

/**
 * Replace every Georgian IBAN in `text` that is not one of ours with the real
 * account of the same bank (TB → TBC, BG → Bank of Georgia). An IBAN of any
 * other bank is replaced with the TBC account. Our own accounts pass through
 * unchanged (spacing normalised). Text without an IBAN is returned as is.
 */
export function fixBankAccounts(text: string): string {
  if (!text || !/GE\s?\d{2}/.test(text)) return text;
  return text.replace(IBAN_RE, (match) => {
    const compact = match.replace(/\s+/g, "").replace(/(GEL|USD|EUR)$/, "");
    if (ALLOWED.has(compact)) return compact;
    const bank = compact.slice(4, 6);
    return bank === "BG" ? MAIKA_BOG_IBAN : MAIKA_TBC_IBAN;
  });
}
