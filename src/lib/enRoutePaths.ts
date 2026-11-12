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
  "/en/restaurant-cafe-uniforms",
  "/en/event-t-shirts",
  "/en/photo-t-shirt-printing",
] as const;

/**
 * The header's services menu when the site is switched to English
 * (AppHeader / MobileNav): the hub, then lib/enPages.ts EN_HUB's
 * "Services" links in the same order. src/test/enPages.test.ts checks it.
 */
export const EN_SERVICE_MENU: readonly { href: string; label: string }[] = [
  { href: "/en", label: "maika.ge in English" },
  { href: "/en/t-shirt-printing", label: "T-shirt & hoodie printing" },
  { href: "/en/dtf-printing", label: "DTF printing" },
  { href: "/en/screen-printing", label: "Screen printing" },
  { href: "/en/logo-embroidery", label: "Logo embroidery" },
  { href: "/en/team-kits", label: "Football & basketball team kits" },
  { href: "/en/corporate-merch", label: "Branded merch & corporate gifts" },
  { href: "/en/georgian-alphabet-t-shirts", label: "Georgian alphabet T-shirts" },
  { href: "/en/mug-printing", label: "Mug printing" },
  { href: "/en/phone-cases", label: "Custom phone cases" },
  { href: "/en/tote-bags", label: "Custom tote bags" },
  { href: "/en/restaurant-cafe-uniforms", label: "Restaurant & café uniforms" },
  { href: "/en/event-t-shirts", label: "Event T-shirts & merch" },
  { href: "/en/photo-t-shirt-printing", label: "Photo T-shirt printing" },
];
