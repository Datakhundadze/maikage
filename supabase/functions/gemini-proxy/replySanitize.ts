// Reply sanitizer for faq-chat (2026-10-24).
// Two defects survived several KB rounds in the Messenger replay eval:
//   1. internal section references leaking to the customer ("(§10)", "§9b-ში");
//   2. invented WhatsApp links (wa.me / api.whatsapp.com).
// Both are fixed here deterministically. Text without "§" or a WhatsApp link
// is returned unchanged (same string).
// 2026-10-30: a third, add-only step — stripBlockAnnouncements — removes prose
// that announces / points at a maika-mockup or maika-generate block.

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
  return stripBlockAnnouncements(out);
}

// ── BLOCK ANNOUNCEMENTS (2026-10-30, add-only) ─────────────────────────────
// A 30-day audit of sketch replies: 21 of 33 announced the block in prose
// („აი, როგორ გამოჩნდება:", „ესკიზის სანახავად დააჭირეთ ღილაკს") despite the
// KB forbidding it — and the sketch is usually applied automatically, so the
// sentence points at a button that is not there. Runs ONLY when the reply
// carries a maika-mockup / maika-generate fence; never touches text inside any
// fence; nothing matched → the same string is returned.

// The one line left when every sentence of the prose was a pointer.
export const SKETCH_FALLBACK_KA = "ესკიზი კონსტრუქტორში უკვე ჩანს.";
export const SKETCH_FALLBACK_EN = "The sketch is already on the product in the constructor.";
export const GENERATE_FALLBACK_KA = "კარგი.";
export const GENERATE_FALLBACK_EN = "Sure.";

const MAIKA_BLOCK_RE = /```maika-(?:mockup|generate)/;
const ANY_FENCE_RE = /```[\s\S]*?(?:```|$)/g;
// Phrases that only point at the block. Each is matched against ONE sentence.
const ANNOUNCE_RES: RegExp[] = [
  /(?:^|[\s„"(])აი[,!]?\s+(?:\S+\s+)?(?:როგორ\s+)?(?:გამოჩნდება|გამოიყურება|გამოვა|ესკიზი|ნიმუში)/,
  /ესკიზის\s+სანახავად/,
  /დააჭირ(?:ეთ|ე)\s+(?:\S+\s+){0,3}ღილაკ/,
  /ღილაკ\S*\s+(?:\S+\s+){0,2}დაჭერით/,
  /ქვემოთ\s+(?:მოცემულ|მოყვანილ|არსებულ)\S*\s+(?:\S+\s+)?(?:ღილაკ|ესკიზ)/,
  /ქვედა\s+ღილაკ/,
  /შეგიძლიათ\s+(?:\S+\s+)?ნახოთ,?\s+როგორ\s+(?:გამოჩნდება|გამოიყურება|გამოვა|იქნება)/,
  /გამოიყენეთ\s+ეს\s+ესკიზი/,
  /აირჩიეთ[\s\S]{0,80}რომ\s+ნახოთ/,
  /ნახეთ\s+ესკიზი/,
  /\bhere(?:'s| is| are)\s+(?:how\s+it\s+(?:will\s+)?looks?|the\s+(?:sketch|mockup|preview)|your\s+(?:sketch|mockup|preview))/i,
  /\b(?:click|tap|press|use)\s+the\s+button\s+below\b/i,
  /\bto\s+see\s+the\s+(?:sketch|mockup|preview)\b/i,
];
// „აი, …:" — a lead-in ending in a colon. Only on the line right before a
// maika fence: elsewhere („აი ფასები:") the colon introduces real content.
const AI_COLON_RE = /^\s*აი[,!]?\s[^\n]*:\s*$/;
// A sentence carrying any of these is real content and is never removed whole.
const PROTECTED_RE = /₾|ლარ|\bgel\b|\?/i;
// Clause boundaries inside one sentence.
const CLAUSE_DELIM_RE = /\s*(?:[—–]|\s-\s|[,;])\s*/g;
const GEORGIAN_RE = /[Ⴀ-ჿ]/;

const isAnnounce = (s: string, beforeBlock: boolean) =>
  ANNOUNCE_RES.some((re) => re.test(s)) || (beforeBlock && AI_COLON_RE.test(s));

/** Split one line into sentences; joining the pieces gives the line back. */
function splitSentences(line: string): string[] {
  const out: string[] = [];
  const re = /[.!?:]+(?=\s|$)\s*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const end = m.index + m[0].length;
    out.push(line.slice(last, end));
    last = end;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/**
 * The sentence with its pointer part removed: unchanged, shortened, or "".
 * `beforeBlock` = this sentence sits on the last prose line before a maika fence.
 */
function cleanSentence(sentence: string, beforeBlock: boolean): string {
  const ann = (x: string) => isAnnounce(x, beforeBlock);
  if (!ann(sentence)) {
    // „აი, საქართველო შავ მაისურზე." — keep the content, drop the „აი, ".
    return sentence.replace(/^(\s*)აი,\s+(?=\S)/, "$1");
  }
  const trailing = sentence.match(/\s*$/)?.[0] ?? "";
  const body = sentence.slice(0, sentence.length - trailing.length);
  const delims = [...body.matchAll(CLAUSE_DELIM_RE)];
  // 1. A trailing clause that points at the block: keep the head.
  for (const d of delims) {
    const head = body.slice(0, d.index).trim();
    const tail = body.slice((d.index ?? 0) + d[0].length);
    if (ann(tail) && !PROTECTED_RE.test(tail) && /[\p{L}\d]{3,}/u.test(head) && !ann(head)) {
      return head.replace(/[.!?:,;—–\s]+$/, "") + "." + trailing;
    }
  }
  // 2. Not protected → the whole sentence is the pointer.
  if (!PROTECTED_RE.test(body)) return "";
  // 3. Protected: drop a LEADING pointer clause, keep the content after it.
  for (let i = delims.length - 1; i >= 0; i--) {
    const d = delims[i];
    const head = body.slice(0, d.index);
    const tail = body.slice((d.index ?? 0) + d[0].length).trim();
    if (ann(head) && !PROTECTED_RE.test(head) && PROTECTED_RE.test(tail) && !ann(tail)) {
      return tail + trailing;
    }
  }
  return sentence; // cannot separate pointer from content → keep it
}

/**
 * Remove prose that only announces / points at the sketch block. Exported for
 * tests; sanitizeReply runs it last.
 */
export function stripBlockAnnouncements(text: string): string {
  if (!text || !MAIKA_BLOCK_RE.test(text)) return text;
  const parts: { prose: boolean; s: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(ANY_FENCE_RE)) {
    if ((m.index ?? 0) > last) parts.push({ prose: true, s: text.slice(last, m.index) });
    parts.push({ prose: false, s: m[0] });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) parts.push({ prose: true, s: text.slice(last) });

  let changed = false;
  parts.forEach((p, idx) => {
    if (!p.prose) return;
    const nextIsBlock = idx + 1 < parts.length && MAIKA_BLOCK_RE.test(parts[idx + 1].s);
    const lines = p.s.split("\n");
    let lastText = -1;
    lines.forEach((l, i) => { if (l.trim()) lastText = i; });
    const kept: string[] = [];
    lines.forEach((line, i) => {
      const bb = nextIsBlock && i === lastText;
      const cleaned = splitSentences(line).map((x) => cleanSentence(x, bb)).join("");
      if (cleaned === line) { kept.push(line); return; }
      changed = true;
      // A line that only held the pointer disappears entirely.
      if (cleaned.trim()) kept.push(cleaned.replace(/\s+$/, ""));
    });
    p.s = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  });
  if (!changed) return text;

  // A colon left right before a maika fence still points at it.
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].prose && MAIKA_BLOCK_RE.test(parts[i + 1].s)) {
      parts[i].s = parts[i].s.replace(/:(\s*)$/, ".$1");
    }
  }

  let out = parts.map((p) => p.s).join("");
  const prose = parts.filter((p) => p.prose).map((p) => p.s).join("").trim();
  if (!prose) {
    const ka = GEORGIAN_RE.test(text.replace(ANY_FENCE_RE, ""));
    const isMockup = /```maika-mockup/.test(text);
    const line = isMockup
      ? (ka ? SKETCH_FALLBACK_KA : SKETCH_FALLBACK_EN)
      : (ka ? GENERATE_FALLBACK_KA : GENERATE_FALLBACK_EN);
    out = line + "\n\n" + out.replace(/^\s+/, "");
  }
  return out.replace(/^\s+/, "");
}
