// Reply sanitizer for faq-chat (2026-10-24).
// Two defects survived several KB rounds in the Messenger replay eval:
//   1. internal section references leaking to the customer ("(§10)", "§9b-ში");
//   2. invented WhatsApp links (wa.me / api.whatsapp.com).
// Both are fixed here deterministically. Text without "§" or a WhatsApp link
// is returned unchanged (same string).

export const MAIKA_WHATSAPP_DISPLAY = "+995 599 05 08 07";

const WA_URL = String.raw`https?:\/\/(?:www\.)?(?:wa\.me|api\.whatsapp\.com)\/[^\s)\]]*`;
const WA_MD_LINK_RE = new RegExp(String.raw`\[[^\]]*\]\(\s*` + WA_URL + String.raw`\s*\)`, "gi");
const WA_BARE_RE = new RegExp(WA_URL, "gi");
// "(§10)", "( §9b )", "(იხ. §2a)", "(see §13)"
const SECTION_PAREN_RE = /\s*\((?:[^()§\n]{0,12})§\s*[0-9]+[a-z]?(?:[-–.,]\s*[0-9a-z]+)*\s*\)/gi;
// "§10-ში", "§ 9b", "§12a"
const SECTION_REF_RE = /§\s*[0-9]+[a-z]?(?:[-–][0-9a-z]+)?(?:-ში|-ის|-ზე|-დან)?/gi;

export function sanitizeReply(text: string): string {
  if (!text) return text;
  let out = text;
  if (/wa\.me|api\.whatsapp\.com/i.test(out)) {
    out = out.replace(WA_MD_LINK_RE, MAIKA_WHATSAPP_DISPLAY).replace(WA_BARE_RE, MAIKA_WHATSAPP_DISPLAY);
  }
  if (out.includes("§")) {
    out = out
      .replace(SECTION_PAREN_RE, "")
      .replace(SECTION_REF_RE, "")
      .replace(/§/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +([.,!?:;])/g, "$1");
  }
  return out;
}
