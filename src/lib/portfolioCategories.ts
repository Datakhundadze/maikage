// /portfolio category chips — one fixed order for the public gallery
// (pages/PortfolioPage.tsx), the admin category picker
// (components/admin/AdminPortfolio.tsx <datalist>) and the static prerender
// (scripts/prerender.mjs, loaded through scripts/lib/appModules.mjs).
//
// The labels are the portfolio_items.category values admins type. Those used
// by the product landing photo strip (hooks/useLandingPhotos.ts
// LANDING_PHOTO_CATEGORY) are all in this list, so one label serves both.
//
// Pure data + pure functions: no React, no Supabase (the prerender loads it).

/** Chip order. Categories not in this list follow it, in first-seen order. */
export const PORTFOLIO_CATEGORY_ORDER: readonly string[] = [
  "მაისური",
  "ჰუდი",
  "პოლო",
  "სპორტული ფორმა",
  "ჩანთა",
  "კეპი",
  "წინსაფარი",
  "სხვა",
];

export interface PortfolioCategoryCount {
  label: string;
  count: number;
}

/** The trimmed category, or "" when the row has none. */
export function normalizePortfolioCategory(category: string | null | undefined): string {
  return typeof category === "string" ? category.trim() : "";
}

/**
 * Categories present in `items`, with their item counts: the fixed order
 * first (only labels that have items), then any other label in the order it
 * first appears. Rows with no category are not counted (they show under
 * "ყველა" only).
 */
export function orderPortfolioCategories(
  items: readonly { category?: string | null }[],
): PortfolioCategoryCount[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const c = normalizePortfolioCategory(it.category);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const fixed = PORTFOLIO_CATEGORY_ORDER.filter((label) => counts.has(label));
  const extra = [...counts.keys()].filter((label) => !PORTFOLIO_CATEGORY_ORDER.includes(label));
  return [...fixed, ...extra].map((label) => ({ label, count: counts.get(label)! }));
}

/**
 * The gallery size as the subtitle shows it: exact below 20, otherwise
 * rounded down to a ten with "+" (283 → "280+ ნამუშევარი").
 */
export function portfolioCountLabel(n: number): string {
  const total = Math.max(0, Math.floor(n));
  const shown = total < 20 ? `${total}` : `${Math.floor(total / 10) * 10}+`;
  return `${shown} ნამუშევარი`;
}
