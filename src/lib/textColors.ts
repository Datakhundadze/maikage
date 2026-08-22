// The constructor's text-colour palette — the ONLY colours a text layer may
// take. Extracted verbatim from SimplePage (where it was module-private) so the
// /chat handoff can validate against the same list without importing the whole
// page module. Values and order are unchanged.
//
// A seeded textColor is matched against these NAMES case-insensitively; an
// unknown value is ignored and the constructor's default (Black) applies. An
// arbitrary hex is never injected.
export const TEXT_COLORS = [
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Red", hex: "#DC2626" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Green", hex: "#16A34A" },
  { name: "Yellow", hex: "#EAB308" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Purple", hex: "#9333EA" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Gray", hex: "#6B7280" },
  { name: "Gold", hex: "#D4A017" },
  { name: "Navy", hex: "#1E3A5F" },
];

/** Default text colour for a new/seeded text layer. */
export const DEFAULT_TEXT_COLOR_HEX = "#000000";

/**
 * Resolve a palette colour NAME (case-insensitive) to its hex.
 * Returns null for anything not in the palette — never a made-up value.
 */
export function resolveTextColorHex(name: string | undefined | null): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return TEXT_COLORS.find((c) => c.name.toLowerCase() === key)?.hex ?? null;
}

/**
 * WCAG 2.1 relative luminance of an sRGB hex colour, 0 (black) to 1 (white).
 *
 * Accepts "#RGB", "#RRGGBB" or the same without the "#". Returns null for
 * anything it cannot parse — the caller decides what to do about that rather
 * than being handed a plausible-looking wrong number.
 */
export function relativeLuminance(hex: string | undefined | null): number | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const channel = (byte: number) => {
    const s = byte / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(h.slice(0, 2), 16));
  const g = channel(parseInt(h.slice(2, 4), 16));
  const b = channel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick the palette colour — White or Black, both of which ARE in TEXT_COLORS —
 * that reads best on a garment of the given hex.
 *
 * The threshold is not a guess: white-on-background and black-on-background
 * give equal WCAG contrast at L ≈ 0.1791 (the L where 1.05/(L+0.05) equals
 * (L+0.05)/0.05), so anything darker than that takes white and anything lighter
 * takes black. Black on Red (#E21818, L ≈ 0.169) is the case this gets right
 * and a naive 0.5 midpoint gets wrong.
 *
 * An unparseable or absent garment hex — a Phone Case, which has no colour at
 * all — falls back to DEFAULT_TEXT_COLOR_HEX, exactly what the caller used to
 * do unconditionally.
 */
export function contrastingTextColorHex(garmentHex: string | undefined | null): string {
  const l = relativeLuminance(garmentHex);
  if (l === null) return DEFAULT_TEXT_COLOR_HEX;
  return l > 0.1791 ? "#000000" : "#FFFFFF";
}
