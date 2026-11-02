// Copy and limits for the two home-page showcase sections (LandingPage):
// "მზა დიზაინები" (catalog rail, components/home/HomeCatalogShowcase.tsx)
// and "ჩვენი ნამუშევრები" (portfolio photos, components/home/HomeWorkStrip.tsx).
//
// The home page has no t() helper — every string is `lang === "en" ? … : …`
// inline — so these are kept as one ka/en pair per string, picked with
// homeShowcaseCopy(lang).

/** How many catalog designs hang on the home rail (before the "see all" tile). */
export const HOME_CATALOG_LIMIT = 12;

/** How many portfolio photos the home strip shows. */
export const HOME_WORK_LIMIT = 6;

const KA = {
  catalogTitle: "მზა დიზაინები",
  catalogSubtitle: "აირჩიე კატალოგიდან და შეუკვეთე — ან შეცვალე შენებურად",
  catalogCta: "ნახე მთელი კატალოგი",
  designsCount: (n: number) => `${n} დიზაინი`,
  prev: "წინა",
  next: "შემდეგი",
  workTitle: "ჩვენი ნამუშევრები",
  workAll: "ყველა ნამუშევარი",
  workAlt: "Maika.ge-ს ნამუშევარი — დაბეჭდილი ტანსაცმელი",
};

const EN: typeof KA = {
  catalogTitle: "Ready-made designs",
  catalogSubtitle: "Pick from the catalog and order — or make it yours",
  catalogCta: "See the full catalog",
  designsCount: (n: number) => `${n} designs`,
  prev: "Previous",
  next: "Next",
  workTitle: "Our work",
  workAll: "All work",
  workAlt: "Maika.ge work — printed clothing",
};

export type HomeShowcaseCopy = typeof KA;

export function homeShowcaseCopy(lang: string): HomeShowcaseCopy {
  return lang === "en" ? EN : KA;
}
