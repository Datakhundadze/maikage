// Constructor chat: does a free-text message ask for the BACKGROUND to go, or
// for WHITE to go? Pure, no React — unit-tested in src/test/cutoutIntent.test.ts.
//
// WHY THIS EXISTS. handleChatSubmit sent every message with a photo layer to
// edit-image. Gemini cannot output alpha, so "remove the background" came back
// with a grey/white checkerboard PAINTED INTO THE PIXELS, and nothing keyed it.
// These signals let the chat route those requests to paths that produce real
// transparency (edit-image-cutout + green key, or the white-removal
// transparency pipeline). Anything else still goes to edit-image unchanged.
//
// MATCHED PER CLAUSE. The noun and the verb must sit in the same clause, so
// „ფონი ლურჯი გახადე და კატა წაშალე" (blue background, delete the cat) is NOT a
// background removal, while „ფონი მოაშორე და დამადე მაისურზე" is.
//
// Georgian is matched on STEMS by substring: JS `\b` is ASCII-only and never
// fires between Georgian letters, so word starts are guarded explicitly
// (otherwise „ტელეფონი" would contain „ფონ").

/** Any Georgian letter (Mkhedruli/Asomtavruli/Nuskhuri + Mtavruli). */
const KA_LETTER = "\\u10A0-\\u10FF\\u1C90-\\u1CBF";
const kaWord = (stems: string) => new RegExp(`(^|[^${KA_LETTER}])(${stems})`);

const KA_BACKGROUND = kaWord("ფონ");
// Removal / transparency stems: მოხსენი / მოხსნა / მოხსნი, მოაშორე, მოაცილე,
// წაშალე / წაშლა, გარეშე ("without"), გამჭვირვალე ("transparent"), ამოიღე,
// ამოჭერი, გააქრე.
const KA_REMOVE = kaWord("მოხსენ|მოხსნ|მოაშორ|მოაცილ|წაშალ|წაშლ|გარეშე|გამჭვირვალ|ამოიღ|ამოჭერ|გააქრ");
// „არ მოაშორო", „ნუ წაშლი" — a negated verb is not a request.
const KA_NEGATED_VERB = new RegExp(
  `(^|[^${KA_LETTER}])(არ|ნუ)\\s+(მოხსენ|მოხსნ|მოაშორ|მოაცილ|წაშალ|წაშლ|ამოიღ|ამოჭერ|გააქრ)`,
);
// „ფონი დატოვე" — keep the background.
const KA_KEEP = kaWord("დატოვ|შეინარჩუნ");

const KA_WHITE = kaWord("თეთრ");
const KA_REMOVE_WHITE = kaWord("ამოიღ|მოაშორ|მოხსენ|მოხსნ|წაშალ|წაშლ|მოაცილ|გააქრ|გამჭვირვალ");

const EN_BACKGROUND = /\b(background|bg)\b/i;
const EN_REMOVE = /\b(remove|removed|removal|delete|erase|strip|cut\s*out|get\s+rid\s+of|without|transparent)\b/i;
const EN_NO_BACKGROUND = /\bno\s+(the\s+|a\s+|any\s+)?(background|bg)\b/i;
const EN_NEGATED = /\b(don'?t|do\s+not|never|keep)\b/i;

const EN_WHITE = /\bwhite\b/i;
const EN_REMOVE_WHITE = /\b(remove|removed|delete|erase|strip|get\s+rid\s+of|take\s+out|without|transparent)\b/i;

/** Split on sentence punctuation and on the conjunctions და / and / but. */
function clauses(text: string): string[] {
  return text
    .split(/[.,!?;:\n]+|\s+და\s+|\s+(?:and|but|then)\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

function kaNegated(clause: string): boolean {
  return KA_NEGATED_VERB.test(clause);
}

/** True when the message asks for the BACKGROUND to be removed / made transparent. */
export function wantsBackgroundRemoval(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return clauses(t).some((c) => {
    if (KA_BACKGROUND.test(c) && KA_REMOVE.test(c) && !kaNegated(c) && !KA_KEEP.test(c)) return true;
    if (EN_BACKGROUND.test(c) && (EN_REMOVE.test(c) || EN_NO_BACKGROUND.test(c)) && !EN_NEGATED.test(c)) return true;
    return false;
  });
}

/**
 * True when the message asks for WHITE to be removed from the design
 * („დიზაინიდან ამოიღე ყველა თეთრი ფერი", "remove all the white"). Independent
 * of wantsBackgroundRemoval — cutoutIntent decides precedence.
 */
export function wantsWhiteRemoval(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return clauses(t).some((c) => {
    if (KA_WHITE.test(c) && KA_REMOVE_WHITE.test(c) && !kaNegated(c) && !KA_KEEP.test(c)) return true;
    if (EN_WHITE.test(c) && EN_REMOVE_WHITE.test(c) && !EN_NEGATED.test(c)) return true;
    return false;
  });
}

/**
 * Routing for the constructor chat. "white" only when the message is about
 * white and NOT about the background — „თეთრი ფონი მოაშორე" is a background
 * removal (the green-key path removes a white backdrop and keeps white artwork,
 * which the white-removal pipeline would punch out).
 */
export function cutoutIntent(text: string): "white" | "background" | null {
  const bg = wantsBackgroundRemoval(text);
  if (bg) return "background";
  if (wantsWhiteRemoval(text)) return "white";
  return null;
}
