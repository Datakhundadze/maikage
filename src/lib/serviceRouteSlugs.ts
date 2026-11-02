// URL slugs and link labels of the service landing pages
// (/maisurebze-bechdva, /sportuli-formebi, /fekhburtis-formebi, …).
//
// Kept apart from lib/serviceCopy.ts on purpose, like productRouteSlugs.ts:
// App.tsx (routes) and LandingPage (the "სერვისები" links) need only these
// strings, while serviceCopy.ts pulls pricing / the catalog / the FAQ, which
// must stay out of those bundles. src/test/servicePages.test.ts fails if this
// file and SERVICE_PAGES differ.
import { LEAD_TIME_KA } from "@/lib/leadTime";

export const SERVICE_PAGE_SLUGS = [
  "maisurebze-bechdva",
  "sportuli-formebi",
  "fekhburtis-formebi",
  "kalatburtis-formebi",
  "dtf-bechdva",
  "shelkografia",
  "logos-kargva",
  "chiqaze-bechdva",
  "korporatiuli-sachukrebi",
  "maisurebi-kartuli-tsartserebit",
  "telefonis-qeisebi",
  "natsris-chantebi",
  "zhiletebi-da-satsvimrebi",
] as const;

export type ServicePageSlug = (typeof SERVICE_PAGE_SLUGS)[number];

/** Each service page's short name: its breadcrumb and its link label. */
export const SERVICE_PAGE_NAMES: Readonly<Record<ServicePageSlug, string>> = {
  "maisurebze-bechdva": "მაისურებზე ბეჭდვა",
  "sportuli-formebi": "სპორტული ფორმები",
  "fekhburtis-formebi": "ფეხბურთის ფორმები",
  "kalatburtis-formebi": "კალათბურთის ფორმები",
  "dtf-bechdva": "DTF ბეჭდვა",
  shelkografia: "შოლკოგრაფია",
  "logos-kargva": "ლოგოს ქარგვა",
  "chiqaze-bechdva": "ჭიქაზე ბეჭდვა",
  "korporatiuli-sachukrebi": "კორპორატიული საჩუქრები",
  "maisurebi-kartuli-tsartserebit": "მაისურები ქართული წარწერით",
  "telefonis-qeisebi": "ტელეფონის ქეისები",
  "natsris-chantebi": "ნაჭრის ჩანთები",
  "zhiletebi-da-satsvimrebi": "ჟილეტები და საწვიმრები",
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
    description: `შენი ფოტოთი, ლოგოთი ან წარწერით, ერთი ცალიდანაც — DTF, შოლკოგრაფია, FLEX და ქარგვა. მზადდება ${LEAD_TIME_KA}ში.`,
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
    label: "სპორტული ფორმები გვარით და ნომრით",
    description: "ფეხბურთისა და კალათბურთის ფორმები გუნდებისთვის — ლოგოთი, გვარით და ნომრით.",
  },
];

/**
 * The phase-2 service pages, one link each with its exact-match anchor (the
 * page's target query) and a one-line description. Together with
 * SERVICE_LINKS they make ALL_SERVICE_LINKS. Facts only from the owner's list
 * (no prices, no quantities for corporate orders).
 */
export const MORE_SERVICE_LINKS: readonly ServiceNavLink[] = [
  {
    href: "/fekhburtis-formebi",
    label: "ფეხბურთის ფორმები",
    description: "გუნდის ფორმების შეკერვა: მაისური, შორტი, ლოგო, გვარი და ნომერი, საბავშვო ზომებითაც.",
  },
  {
    href: "/kalatburtis-formebi",
    label: "კალათბურთის ფორმები",
    description: "კალათბურთის მაისური და შორტი გუნდის ფერებში, ლოგოთი, გვარით და ნომრით.",
  },
  {
    href: "/dtf-bechdva",
    label: "DTF ბეჭდვა",
    description: `ნებისმიერი ფერი და ფოტო ტანსაცმელზე, ერთი ცალიდანაც — მზადდება ${LEAD_TIME_KA}ში.`,
  },
  {
    href: "/shelkografia",
    label: "შოლკოგრაფია",
    description: "ბეჭდვა დიდი ტირაჟისთვის: რაც მეტია რაოდენობა, მით იაფია ერთი ცალი.",
  },
  {
    href: "/logos-kargva",
    label: "ლოგოს ქარგვა",
    description: "ნაქარგი ლოგო პოლოებზე, ჰუდებზე და კეპებზე — დიდი რაოდენობისთვის.",
  },
  {
    href: "/chiqaze-bechdva",
    label: "ჭიქაზე ბეჭდვა",
    description: "ჭიქა შენი ფოტოთი, წარწერით ან ლოგოთი — საჩუქრად ან კომპანიისთვის.",
  },
  {
    href: "/korporatiuli-sachukrebi",
    label: "კორპორატიული საჩუქრები",
    description: "მაისურები, ჰუდები, კეპები, ჭიქები, ჩანთები და ქეისები კომპანიის ლოგოთი.",
  },
  {
    href: "/maisurebi-kartuli-tsartserebit",
    label: "მაისურები ქართული წარწერით",
    description: "ასობით მზა დიზაინი ქართული წარწერით, ან შენი საკუთარი ტექსტი.",
  },
  {
    href: "/telefonis-qeisebi",
    label: "ტელეფონის ქეისები",
    description: "ქეისი შენი ფოტოთი, წარწერით ან დიზაინით — ძირითადად iPhone, Xiaomi და Samsung მოდელებზე.",
  },
  {
    href: "/natsris-chantebi",
    label: "ნაჭრის ჩანთები",
    description: "ნაჭრის ჩანთა შენი დიზაინით, ან კომპანიის ლოგოთი ღონისძიებისა და ბიზნესისთვის.",
  },
  {
    href: "/zhiletebi-da-satsvimrebi",
    label: "ჟილეტები და საწვიმრები",
    description: "შეკვეთით შეკერილი ჟილეტები და საწვიმრები კომპანიის ლოგოთი — თანამშრომლებისა და ღონისძიებებისთვის.",
  },
];

/**
 * Every service page link: the four main ones, then the phase-2 pages. The
 * home top bar, the header dropdown, the mobile menu and /faq list these.
 */
export const ALL_SERVICE_LINKS: readonly ServiceNavLink[] = [...SERVICE_LINKS, ...MORE_SERVICE_LINKS];

/** Most links the "ბეჭდვის სერვისები" block shows. */
export const PRINT_SERVICES_MAX = 8;

/**
 * The "ბეჭდვის სერვისები" block's links per page, most relevant first. A path
 * missing here (every /design/:slug, every product / brand landing route)
 * gets DEFAULT_PRINT_SERVICES.
 */
const DEFAULT_PRINT_SERVICES = [
  "/maisurebze-bechdva",
  "/maisurebi-kartuli-tsartserebit",
  "/hoodie",
  "/dtf-bechdva",
  "/corporate",
  "/sportuli-formebi",
  "/chiqaze-bechdva",
  "/korporatiuli-sachukrebi",
];
const PRINT_SERVICES_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  "/maisurebze-bechdva": ["/dtf-bechdva", "/shelkografia", "/logos-kargva", "/hoodie", "/maisurebi-kartuli-tsartserebit", "/corporate", "/sportuli-formebi", "/chiqaze-bechdva"],
  "/sportuli-formebi": ["/fekhburtis-formebi", "/kalatburtis-formebi", "/maisurebze-bechdva", "/dtf-bechdva", "/corporate", "/logos-kargva"],
  "/fekhburtis-formebi": ["/sportuli-formebi", "/kalatburtis-formebi", "/dtf-bechdva", "/maisurebze-bechdva", "/corporate", "/logos-kargva"],
  "/kalatburtis-formebi": ["/sportuli-formebi", "/fekhburtis-formebi", "/dtf-bechdva", "/maisurebze-bechdva", "/corporate"],
  "/dtf-bechdva": ["/maisurebze-bechdva", "/shelkografia", "/logos-kargva", "/hoodie", "/maisurebi-kartuli-tsartserebit", "/chiqaze-bechdva", "/corporate", "/sportuli-formebi"],
  "/shelkografia": ["/maisurebze-bechdva", "/dtf-bechdva", "/logos-kargva", "/corporate", "/korporatiuli-sachukrebi", "/natsris-chantebi", "/zhiletebi-da-satsvimrebi", "/sportuli-formebi"],
  "/logos-kargva": ["/maisurebze-bechdva", "/shelkografia", "/dtf-bechdva", "/corporate", "/korporatiuli-sachukrebi", "/zhiletebi-da-satsvimrebi", "/hoodie"],
  "/chiqaze-bechdva": ["/korporatiuli-sachukrebi", "/telefonis-qeisebi", "/natsris-chantebi", "/maisurebze-bechdva", "/maisurebi-kartuli-tsartserebit", "/dtf-bechdva", "/corporate"],
  "/korporatiuli-sachukrebi": ["/corporate", "/zhiletebi-da-satsvimrebi", "/natsris-chantebi", "/telefonis-qeisebi", "/logos-kargva", "/chiqaze-bechdva", "/shelkografia", "/dtf-bechdva"],
  "/maisurebi-kartuli-tsartserebit": ["/maisurebze-bechdva", "/dtf-bechdva", "/hoodie", "/chiqaze-bechdva", "/korporatiuli-sachukrebi", "/sportuli-formebi"],
  "/corporate": ["/korporatiuli-sachukrebi", "/logos-kargva", "/zhiletebi-da-satsvimrebi", "/natsris-chantebi", "/shelkografia", "/dtf-bechdva", "/maisurebze-bechdva", "/sportuli-formebi"],
  "/telefonis-qeisebi": ["/chiqaze-bechdva", "/natsris-chantebi", "/korporatiuli-sachukrebi", "/maisurebze-bechdva", "/maisurebi-kartuli-tsartserebit", "/dtf-bechdva"],
  "/natsris-chantebi": ["/korporatiuli-sachukrebi", "/dtf-bechdva", "/shelkografia", "/corporate", "/telefonis-qeisebi", "/chiqaze-bechdva", "/maisurebze-bechdva"],
  "/zhiletebi-da-satsvimrebi": ["/corporate", "/korporatiuli-sachukrebi", "/logos-kargva", "/shelkografia", "/dtf-bechdva", "/sportuli-formebi"],
  "/hoodie": ["/maisurebze-bechdva", "/dtf-bechdva", "/maisurebi-kartuli-tsartserebit", "/logos-kargva", "/corporate", "/korporatiuli-sachukrebi", "/sportuli-formebi"],
};

/**
 * The "ბეჭდვის სერვისები" links for a page (components/PrintServicesLinks
 * and the prerender's servicesBlock): the most relevant services for that
 * path, never the page itself, at most PRINT_SERVICES_MAX.
 */
export function printServiceLinksFor(path?: string): ServiceNavLink[] {
  const own = path !== undefined && Object.prototype.hasOwnProperty.call(PRINT_SERVICES_BY_PATH, path);
  const hrefs = own ? PRINT_SERVICES_BY_PATH[path] : DEFAULT_PRINT_SERVICES;
  const byHref = new Map(ALL_SERVICE_LINKS.map((l) => [l.href, l]));
  return hrefs
    .filter((h) => h !== path)
    .map((h) => byHref.get(h))
    .filter((l): l is ServiceNavLink => l !== undefined)
    .slice(0, PRINT_SERVICES_MAX);
}
