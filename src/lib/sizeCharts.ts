// Garment size charts shown next to the size selector (2026-10-30).
//
// Source: the owner's measurement sheets (maika@maika.ge, „ზომები", 2025-09-02),
// units confirmed as centimetres 2026-10-22, with the owner's corrections
// (GIORDANO S width 52, JEL hoodie M length 70, kids ages + XL).
// Keys are SUB_PRODUCTS names (src/lib/catalog.ts). A brand with no entry shows
// no chart link — add a row set here when its measurements arrive.
//
//   length — shoulder to bottom hem
//   width  — chest, measured flat (half the circumference)

export interface SizeRow {
  size: string;
  /** Optional second label, e.g. the kids' age band. */
  note?: string;
  length: number;
  width: number;
}

export const SIZE_CHARTS: Record<string, SizeRow[]> = {
  "GILDAN": [
    { size: "S", length: 71, width: 46 },
    { size: "M", length: 74, width: 51 },
    { size: "L", length: 77, width: 56 },
    { size: "XL", length: 79, width: 61 },
    { size: "XXL", length: 83, width: 66 },
  ],
  "GILDAN Hoodie": [
    { size: "S", length: 69, width: 51 },
    { size: "M", length: 71, width: 56 },
    { size: "L", length: 74, width: 61 },
    { size: "XL", length: 76, width: 66 },
    { size: "XXL", length: 79, width: 71 },
  ],
  "Khundadze": [
    { size: "S", length: 66, width: 49 },
    { size: "M", length: 68, width: 53 },
    { size: "L", length: 70, width: 57 },
    { size: "XL", length: 72, width: 61 },
    { size: "XXL", length: 74, width: 65 },
    { size: "XXXL", length: 76, width: 69 },
    { size: "XXXXL", length: 78, width: 73 },
    { size: "XXXXXL", length: 81, width: 77 },
  ],
  "GIORDANO": [
    { size: "S", length: 67, width: 52 },
    { size: "M", length: 70, width: 54 },
    { size: "L", length: 71, width: 55 },
    { size: "XL", length: 78, width: 60 },
    { size: "XXL", length: 80, width: 60 },
    { size: "XXXL", length: 82, width: 65 },
  ],
  "TH": [
    { size: "S", length: 66, width: 48 },
    { size: "M", length: 70, width: 53 },
    { size: "L", length: 73, width: 55 },
    { size: "XL", length: 75, width: 59 },
    { size: "XXL", length: 79, width: 61 },
  ],
  "GILDAN KIDS": [
    { size: "XS", note: "3/4 წელი", length: 46, width: 35 },
    { size: "S", note: "5/6 წელი", length: 48, width: 38 },
    { size: "M", note: "7/8 წელი", length: 52, width: 41 },
    { size: "L", note: "9/11 წელი", length: 56, width: 44 },
    { size: "XL", note: "12/14 წელი", length: 58, width: 46 },
  ],
  "JEL Standard Hoodie": [
    { size: "S", length: 63, width: 51 },
    { size: "M", length: 70, width: 54 },
    { size: "L", length: 75, width: 56 },
    { size: "XL", length: 77, width: 61 },
    { size: "XXL", length: 79, width: 65 },
    { size: "XXXL", length: 80, width: 67 },
  ],
};

/** The chart for a brand, or null when none is on file. */
export function getSizeChart(subProduct: string | undefined | null): SizeRow[] | null {
  if (!subProduct) return null;
  const rows = SIZE_CHARTS[subProduct];
  return rows && rows.length ? rows : null;
}
