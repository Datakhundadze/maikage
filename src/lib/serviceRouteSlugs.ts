// URL slugs and link labels of the service landing pages
// (/maisurebze-bechdva, /sportuli-formebi).
//
// Kept apart from lib/serviceCopy.ts on purpose, like productRouteSlugs.ts:
// App.tsx (routes) and LandingPage (the "სერვისები" links) need only these
// strings, while serviceCopy.ts pulls pricing / the catalog / the FAQ, which
// must stay out of those bundles. src/test/servicePages.test.ts fails if this
// file and SERVICE_PAGES differ.
import { LEAD_TIME_KA } from "@/lib/leadTime";

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

/** One service link: exact-match anchor text plus a one-line description. */
export interface ServiceNavLink {
  href: string;
  label: string;
  /** Short Georgian description (home "სერვისები" section, static home shell). */
  description: string;
}

/**
 * The crawlable "სერვისები" links — the four money pages, each with its
 * exact-match anchor text. ONE LIST for every place that links them: the home
 * page section, the header (desktop dropdown + mobile sheet), /faq, the
 * "ბეჭდვის სერვისები" block on /design/:slug and on the product landing
 * routes, and the static prerender of all of those.
 *
 * Facts only from the existing copy (serviceCopy.ts, corporateCopy.ts,
 * landingCopy.ts). No prices.
 */
export const SERVICES_HEADING = "სერვისები";
export const PRINT_SERVICES_HEADING = "ბეჭდვის სერვისები";
export const SERVICE_LINKS: readonly ServiceNavLink[] = [
  {
    href: "/maisurebze-bechdva",
    label: "მაისურებზე ბეჭდვა",
    description: `შენი ფოტოთი, ლოგოთი ან წარწერით, ერთი ცალიდანაც — DTF, შელკოგრაფია, FLEX და ქარგვა. მზადდება ${LEAD_TIME_KA}ში.`,
  },
  {
    href: "/hoodie",
    label: "ჰუდებზე ბეჭდვა",
    description: "ჰუდები, ელვიანი ჰუდები და ბომბერები შენი დიზაინით — როგორ გამოჩნდება, ეკრანზევე ნახავ.",
  },
  {
    href: "/corporate",
    label: "მაისურების ბრენდირება კომპანიის ლოგოთი",
    description: "ბრენდირებული მაისურები, ჰუდები, ჩანთები და კეპები კომპანიებისთვის, ღონისძიებებისა და გუნდებისთვის.",
  },
  {
    href: "/sportuli-formebi",
    label: "ფეხბურთის და სპორტული ფორმები",
    description: "ფეხბურთისა და კალათბურთის ფორმები გუნდებისთვის — ლოგოთი, გვარით და ნომრით.",
  },
];
