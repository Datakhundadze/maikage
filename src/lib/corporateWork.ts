// "ჩვენი კორპორატიული ნამუშევრები" gallery + "ვისთან ვთანამშრომლობთ" partner
// strip on /corporate and /korporatiuli-sachukrebi.
//
// ONE SOURCE for the live pages (components/CorporateWorkGallery.tsx, which
// fetches portfolio_items itself) and the static prerender
// (scripts/prerender.mjs → scripts/lib/seo.mjs corporateWorkHtml, loaded
// through scripts/lib/appModules.mjs): the copy, the partner list and the
// selection rule below are used by both, so the 12 photos a crawler gets in
// the raw HTML are the 12 the live page shows.
//
// Pure: no React, no DOM, no Supabase client (the prerender loads it in Node).
// No prices here, by rule.
import { transformedDisplayUrl } from "@/lib/imageTransform";

/** The pages that show the gallery and the strip — nowhere else. */
export const CORPORATE_WORK_PATHS: readonly string[] = ["/corporate", "/korporatiuli-sachukrebi"];

export const CORPORATE_WORK_COPY = {
  heading: "ჩვენი კორპორატიული ნამუშევრები",
  intro: "ბრენდირებული ფორმა და საჩუქრები საქართველოს წამყვანი კომპანიებისთვის — ყველა ფოტო ჩვენი ნამუშევარია.",
  allLink: { href: "/portfolio", label: "ნახე ყველა ნამუშევარი" },
} as const;

/** Partner names, as text (no logos). Official partners first. */
export const CORPORATE_PARTNERS_HEADING = "ვისთან ვთანამშრომლობთ";
export const CORPORATE_PARTNERS: readonly string[] = [
  "Dinamo Tbilisi",
  "Nike",
  "Lexus Tbilisi",
  "elf",
  "EPAM",
  "Citycom",
  "MEGA SPORT",
  "iSupport",
  "SABA",
  "Black Coral",
  "Pasticceria Napoli",
  "Competento",
  "Nutrimax",
  "Aspria Fitness",
  "CAVAVIN",
  "Caparol",
  "Matchabeli",
  "TOPSPORT",
];

/** Photos in the gallery. */
export const CORPORATE_WORK_LIMIT = 12;
/** At most this many photos of one brand. */
export const CORPORATE_WORK_MAX_PER_BRAND = 2;
/** Square tile: the <img> width/height attributes and the 1x render width. */
export const CORPORATE_WORK_TILE = 400;
/** 2 columns on mobile, 4 from md (768px) up, inside a max-w-3xl column. */
export const CORPORATE_WORK_SIZES = "(min-width: 768px) 25vw, 50vw";

/** portfolio_items columns the gallery needs (runtime select and prerender REST select). */
export const CORPORATE_WORK_COLUMNS = "id,title,image_path,category,alt_text,sort_order,created_at";

export interface CorporateWorkRow {
  id: string;
  title?: string | null;
  image_path: string | null;
  category?: string | null;
  alt_text: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  active?: boolean | null;
}

const CORPORATE_ALT = /კორპორატიულ|ლოგოთი|ბრენდირებ/;
const EXCLUDED_ALT = /კლუბის ემბლემით/;
const LOGO_WORD = /^ლოგო(?:თი|ებით)/;
const LATIN = /[A-Za-z]/;

/** Corporate work: active, has an image, alt_text says so, not a club emblem. */
export function isCorporateWork(row: CorporateWorkRow | null | undefined): boolean {
  if (!row || row.active === false) return false;
  if (typeof row.image_path !== "string" || !row.image_path.trim()) return false;
  const alt = row.alt_text ?? "";
  return CORPORATE_ALT.test(alt) && !EXCLUDED_ALT.test(alt);
}

/**
 * The brand an alt_text names: the Latin word(s) nearest before
 * "ლოგოთი" / "ლოგოებით" ("… Lexus Tbilisi ლოგოთი —" → "Lexus Tbilisi";
 * "CAVAVIN ღვინის ბრენდის ლოგოთი" → "CAVAVIN"), never across a "—". Null
 * when there is none ("კომპანიის ლოგოთი").
 */
export function corporateBrand(alt: string | null | undefined): string | null {
  const tokens = String(alt ?? "").split(/\s+/).filter(Boolean);
  const at = tokens.findIndex((t) => LOGO_WORD.test(t));
  if (at <= 0) return null;
  let i = at - 1;
  while (i >= 0 && !LATIN.test(tokens[i])) {
    if (/^[—–-]$/.test(tokens[i])) return null;
    i--;
  }
  if (i < 0) return null;
  const words: string[] = [];
  while (i >= 0 && LATIN.test(tokens[i])) words.unshift(tokens[i--]);
  return words.join(" ");
}

/**
 * Grouping key for the per-brand cap: the brand's first word, lower-cased
 * ("Lexus" and "Lexus Tbilisi" are one brand); a row with no brand is its own
 * group (its id).
 */
export function corporateBrandKey(row: Pick<CorporateWorkRow, "id" | "alt_text">): string {
  const brand = corporateBrand(row.alt_text);
  if (!brand) return `id:${row.id}`;
  return `brand:${brand.split(" ")[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")}`;
}

/** PortfolioPage's order — sort_order ASC (nulls last), then newest — with id as the final tie-break. */
function compareRows(a: CorporateWorkRow, b: CorporateWorkRow): number {
  const sa = a.sort_order ?? null;
  const sb = b.sort_order ?? null;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  }
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) return ca < cb ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The gallery's photos. Deterministic — the input order does not matter.
 * Corporate rows only, in the order above; variety first: one photo per
 * brand, then a second per brand only if slots remain (never more than
 * CORPORATE_WORK_MAX_PER_BRAND). The result keeps the sorted order.
 */
export function selectCorporateWork<T extends CorporateWorkRow>(rows: readonly T[], limit = CORPORATE_WORK_LIMIT): T[] {
  const sorted = rows.filter(isCorporateWork).sort(compareRows);
  const picked = new Set<T>();
  const perBrand = new Map<string, number>();
  for (let round = 1; round <= CORPORATE_WORK_MAX_PER_BRAND && picked.size < limit; round++) {
    for (const row of sorted) {
      if (picked.size >= limit) break;
      if (picked.has(row)) continue;
      const key = corporateBrandKey(row);
      const n = perBrand.get(key) ?? 0;
      if (n >= round) continue;
      perBrand.set(key, n + 1);
      picked.add(row);
    }
  }
  return sorted.filter((r) => picked.has(r));
}

export interface CorporateWorkImage {
  id: string;
  src: string;
  srcSet: string;
  alt: string;
}

/**
 * <img> attributes for a selected row, from its public storage URL
 * (supabase.storage.from("portfolio").getPublicUrl(image_path) — the
 * prerender builds the same URL). 400w / 800w downscaled renders.
 */
export function corporateWorkImage(row: CorporateWorkRow, publicUrl: string): CorporateWorkImage {
  const w1 = transformedDisplayUrl(publicUrl, { width: CORPORATE_WORK_TILE });
  const w2 = transformedDisplayUrl(publicUrl, { width: CORPORATE_WORK_TILE * 2 });
  return {
    id: row.id,
    src: w1,
    srcSet: `${w1} ${CORPORATE_WORK_TILE}w, ${w2} ${CORPORATE_WORK_TILE * 2}w`,
    alt: row.alt_text || row.title || "Maika.ge კორპორატიული ნამუშევარი",
  };
}
