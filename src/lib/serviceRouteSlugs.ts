// URL slugs and link labels of the service landing pages
// (/maisurebze-bechdva, /sportuli-formebi).
//
// Kept apart from lib/serviceCopy.ts on purpose, like productRouteSlugs.ts:
// App.tsx (routes) and LandingPage (the "სერვისები" links) need only these
// strings, while serviceCopy.ts pulls pricing / the catalog / the FAQ, which
// must stay out of those bundles. src/test/servicePages.test.ts fails if this
// file and SERVICE_PAGES differ.

export const SERVICE_PAGE_SLUGS = ["maisurebze-bechdva", "sportuli-formebi"] as const;

export type ServicePageSlug = (typeof SERVICE_PAGE_SLUGS)[number];

/** Each service page's short name: its breadcrumb and its link label. */
export const SERVICE_PAGE_NAMES: Readonly<Record<ServicePageSlug, string>> = {
  "maisurebze-bechdva": "მაისურებზე ბეჭდვა",
  "sportuli-formebi": "სპორტული ფორმები",
};

/** One link per service page (the home footer). */
export const SERVICE_PAGE_LINKS: readonly { href: string; label: string }[] = SERVICE_PAGE_SLUGS.map((slug) => ({
  href: `/${slug}`,
  label: SERVICE_PAGE_NAMES[slug],
}));

/** The crawlable "სერვისები" links block: home page, /faq, the static home shell. */
export const SERVICES_HEADING = "სერვისები";
export const SERVICE_LINKS: readonly { href: string; label: string }[] = [
  ...SERVICE_PAGE_LINKS,
  { href: "/corporate", label: "კორპორატიული შეკვეთები" },
];
