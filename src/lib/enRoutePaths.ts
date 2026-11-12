// The English pages' paths (lib/enPages.ts EN_PAGE_LIST), kept apart so
// App.tsx can register the routes without pulling the page copy into the
// main chunk. src/test/enPages.test.ts checks the two lists match.
export const EN_ROUTE_PATHS = [
  "/en",
  "/en/t-shirt-printing",
  "/en/dtf-printing",
  "/en/screen-printing",
  "/en/logo-embroidery",
  "/en/team-kits",
  "/en/corporate-merch",
  "/en/georgian-alphabet-t-shirts",
  "/en/mug-printing",
  "/en/phone-cases",
  "/en/tote-bags",
] as const;
