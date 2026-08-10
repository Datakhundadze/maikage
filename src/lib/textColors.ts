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
