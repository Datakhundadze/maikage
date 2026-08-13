// Nearest-colour resolution for a name the customer asked for but that the
// resolved product + brand does not stock.
//
// THE BUG THIS EXISTS FOR. A customer says „ლურჯი მაისური". The model does
// exactly what the KB told it and emits "color":"Blue" — a real entry in the
// palette. But plain Blue is stocked by exactly ONE brand in the whole catalog
// (JEL Standard Zipper); GILDAN, the default t-shirt, offers Electric Blue,
// Light Blue and Standard Blue and no plain Blue. The availability check then
// discarded the value without a word and the customer got a WHITE shirt. The
// same shape of failure sent every unrecognised textColor to black.
//
// THE RULE, in full — deterministic, and narrow on purpose:
//
//   1. EXACT. A case-insensitive name match against the available list wins
//      outright. Nothing below runs.
//   2. SAME FAMILY. Otherwise, consider only names that share a whole WORD with
//      the request — "Blue" matches "Electric Blue", "Light Blue" and
//      "Standard Blue"; "Light Gray Melange" matches "Light Gray" and "Gray".
//      Whole words, so "Blue" never matches "Burgundy" on a substring.
//   3. NEAREST WITHIN THE FAMILY. Among those, the smallest RGB distance to the
//      requested colour's own hex. „ლურჯი" (#2563EB) resolves to Standard Blue
//      (#4169E1, distance 30) over Electric Blue (42) and Light Blue (145).
//   4. NO FAMILY, NO GUESS. If nothing shares a word, return null. A blue is
//      only ever replaced by a blue; the caller keeps what the customer already
//      had rather than being handed a purple.
//
// Step 2 is what makes this predictable rather than clever. Nearest-hex across
// the whole palette would "work" and would occasionally answer Purple, which
// is worse than answering nothing.

/** A palette entry: a display name and its hex. Both palettes share this shape. */
export interface NamedColor {
  name: string;
  hex: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Whole words of a colour name, lowercased. "Light Gray" → ["light","gray"]. */
function words(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter(Boolean);
}

/** #RRGGBB → [r,g,b]. Returns null for anything else, so a bad entry is skipped. */
function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Plain Euclidean distance in RGB. Good enough to order shades of one hue. */
function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Resolve `requested` against `available`, following the rule above.
 *
 * @param requested  The colour NAME the customer asked for.
 * @param available  The names actually on offer.
 * @param palette    Every known name → hex, for the distance step.
 * @returns The name to use (always one of `available`), or null when nothing in
 *   the same family is stocked — the caller then keeps the current selection.
 */
export function resolveNearestColor(
  requested: string,
  available: readonly string[],
  palette: readonly NamedColor[],
): string | null {
  const want = norm(requested);
  if (!want || available.length === 0) return null;

  // 1. Exact.
  const exact = available.find((a) => norm(a) === want);
  if (exact) return exact;

  // 2. Same family — a shared whole word, in either direction.
  const wantWords = new Set(words(requested));
  const family = available.filter((a) => words(a).some((w) => wantWords.has(w)));
  if (family.length === 0) return null;
  if (family.length === 1) return family[0];

  // 3. Nearest within the family. A missing hex on either side cannot be
  //    measured, so it loses to anything measurable and the first family member
  //    stands as the stable fallback — never a random pick.
  const wantHex = palette.find((c) => norm(c.name) === want)?.hex;
  const wantRgb = wantHex ? rgb(wantHex) : null;
  if (!wantRgb) return family[0];

  let best = family[0];
  let bestD = Infinity;
  for (const name of family) {
    const hex = palette.find((c) => norm(c.name) === norm(name))?.hex;
    const candidate = hex ? rgb(hex) : null;
    if (!candidate) continue;
    const d = distance(wantRgb, candidate);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}
