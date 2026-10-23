import { describe, it, expect } from "vitest";
import {
  fixBankAccounts,
  MAIKA_TBC_IBAN,
  MAIKA_BOG_IBAN,
} from "../../supabase/functions/gemini-proxy/bankAccounts";

describe("fixBankAccounts", () => {
  it("leaves text without an IBAN untouched", () => {
    const t = "სტანდარტული ვადა 1–2 სამუშაო დღეა.";
    expect(fixBankAccounts(t)).toBe(t);
  });

  it("keeps our own accounts", () => {
    const t = `TBC: ${MAIKA_TBC_IBAN}\nBOG: ${MAIKA_BOG_IBAN}`;
    expect(fixBankAccounts(t)).toBe(t);
  });

  it("replaces an invented TBC IBAN with the real TBC account (seen in the 2026-10-23 replay)", () => {
    expect(fixBankAccounts("IBAN: GE78TB7734836080100006")).toBe(`IBAN: ${MAIKA_TBC_IBAN}`);
  });

  it("replaces an invented BOG IBAN with a GEL suffix by the real BOG account", () => {
    expect(fixBankAccounts("**GE19BG0000000845344400GEL**")).toBe(`**${MAIKA_BOG_IBAN}**`);
  });

  it("handles spaced IBANs", () => {
    expect(fixBankAccounts("GE78 TB77 3483 6080 1000 06")).toBe(MAIKA_TBC_IBAN);
  });

  it("normalises our own account written with spaces and a currency suffix", () => {
    expect(fixBankAccounts("GE89 BG00 0000 0536 1483 75 GEL")).toBe(MAIKA_BOG_IBAN);
  });

  it("maps an IBAN of another bank to the TBC account", () => {
    expect(fixBankAccounts("GE29NB0000000101904917")).toBe(MAIKA_TBC_IBAN);
  });

  it("does not touch phone numbers", () => {
    const t = "დაგვირეკეთ: +995 32 2 05 06 20 · 599 05 08 07";
    expect(fixBankAccounts(t)).toBe(t);
  });
});
