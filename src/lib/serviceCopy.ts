// Service landing pages — /maisurebze-bechdva (printing) and /sportuli-formebi
// (team kits): title, description, every visible text, the FAQ and the
// JSON-LD.
//
// ONE SOURCE for the live page (pages/ServicePage.tsx) and the static
// prerender (scripts/prerender.mjs → dist/<slug>/index.html, which loads this
// module through scripts/lib/appModules.mjs). Never retype a string from here.
//
// Prices are NOT typed in this file: product prices come from pricing.ts
// through lib/landingPrice.ts fromPrice (the same "from" price the product
// landing hero shows), courier prices from faqContent.ts FAQ_DELIVERY_PRICES
// (a mirror of OrderDialog's, guarded by src/test/faqPrices.test.tsx), the
// lead time from LEAD_TIME_KA. src/test/servicePages.test.ts fails on any
// digit typed next to ₾ in this file. A price that cannot be computed drops
// its line — never a placeholder.
//
// Facts: owner-confirmed for this page (print methods, A3 maximum, printing
// on a brought item, team-kit minimum and limits). Partner brands: Dinamo and
// Nike only; everyone else stays generic.
import type { ProductType } from "@/lib/catalog";
import { fromPrice } from "@/lib/landingPrice";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import { FAQ_DELIVERY_PRICES, faqPageSchema, type FaqItem } from "@/lib/faqContent";
import { buildBreadcrumbList, SITE_URL } from "@/lib/seoSchemas";
import {
  SERVICE_LINKS,
  SERVICE_PAGE_NAMES,
  SERVICE_PAGE_SLUGS,
  SERVICES_HEADING,
  type ServicePageSlug,
} from "@/lib/serviceRouteSlugs";

export { SERVICE_LINKS, SERVICES_HEADING };

export interface ServiceLink {
  href: string;
  label: string;
}

/** A bold term, " — ", then the text (same shape as LandingCopyBullet). */
export interface ServiceBullet {
  term: string;
  text: string;
}

export interface ServiceSection {
  h2: string;
  /** Paragraph before any list. */
  body?: string;
  bullets?: ServiceBullet[];
  /** Numbered steps (<ol>). */
  steps?: string[];
  /** Paragraph after the list(s). */
  note?: string;
  links?: ServiceLink[];
}

export interface ServicePageCopy {
  slug: ServicePageSlug;
  path: string;
  seo: { title: string; description: string };
  /** Breadcrumb / link label for this page. */
  name: string;
  h1: string;
  intro: string;
  /** Call-to-action row right under the intro. */
  heroLinks: ServiceLink[];
  sections: ServiceSection[];
  faqHeading: string;
  faq: FaqItem[];
  cta: { h2: string; body: string; links: ServiceLink[] };
  /** schema.org Service.serviceType */
  serviceType: string;
}

// ── Shared facts ────────────────────────────────────────────────────────────

/**
 * Contact links — the same values as the /contact page and SeoHead
 * (scripts/lib/seo.mjs CONTACT; src/test/servicePages.test.ts checks them).
 */
export const SERVICE_CONTACT = {
  phone: { display: "+995 599 05 08 07", tel: "+995599050807" },
  whatsapp: "https://wa.me/995599050807",
  facebook: "https://www.facebook.com/maika.ge",
} as const;

/** Showroom line — the address /contact shows, in the wording the owner uses. */
const SHOWROOM_KA = "დინამო არენა, მე-10 კარი (ა. წერეთლის #2, თბილისი)";

/** "{amount} ₾" — LandingHero's price format. */
const lari = (amount: number): string => `${amount} ₾`;

/** fromPrice, or null when it cannot be computed (the line is then left out). */
function priceOf(product: ProductType): number | null {
  try {
    const p = fromPrice(product, null);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Price bullets: [label, product, "-დან" or exact]. Unpriceable products drop out. */
function priceBullets(rows: readonly [string, ProductType, boolean][]): ServiceBullet[] {
  const out: ServiceBullet[] = [];
  for (const [term, product, from] of rows) {
    const p = priceOf(product);
    if (p === null) continue;
    out.push({ term, text: from ? `${lari(p)}-დან` : lari(p) });
  }
  return out;
}

const TSHIRT_FROM = priceOf("T-Shirt");
const HOODIE_FROM = priceOf("Hoodie");

const COURIER_SENTENCE = `კურიერით ვაწვდით მთელ საქართველოში: თბილისში — ${lari(FAQ_DELIVERY_PRICES.courier_tbilisi)}, რეგიონებში — ${lari(FAQ_DELIVERY_PRICES.courier_outside)}.`;

const DESIGNER_LINK: ServiceLink = { href: "/t-shirt", label: "შექმენი დიზაინი ონლაინ" };
const CORPORATE_LINK: ServiceLink = { href: "/corporate", label: "კორპორატიული შეკვეთა" };
const CONTACT_LINKS: ServiceLink[] = [
  { href: `tel:${SERVICE_CONTACT.phone.tel}`, label: `დაგვირეკე: ${SERVICE_CONTACT.phone.display}` },
  { href: SERVICE_CONTACT.whatsapp, label: "მოგვწერე WhatsApp-ზე" },
  { href: SERVICE_CONTACT.facebook, label: "მოგვწერე Facebook-ზე" },
];

// ── /maisurebze-bechdva ─────────────────────────────────────────────────────

const PRINTING_PRICE_LEAD =
  TSHIRT_FROM !== null
    ? `მაისური ბეჭდვით ${lari(TSHIRT_FROM)}-დან ღირს${HOODIE_FROM !== null ? `, ჰუდი — ${lari(HOODIE_FROM)}-დან` : ""}. `
    : "";

export const PRINTING_PAGE: ServicePageCopy = {
  slug: "maisurebze-bechdva",
  path: "/maisurebze-bechdva",
  seo: {
    title: "მაისურებზე ბეჭდვა თბილისში — 1–2 დღეში | maika.ge",
    description: `მაისურებზე და ჰუდებზე ბეჭდვა 1 ცალიდან — DTF, შელკოგრაფია, FLEX და ქარგვა. ატვირთე ფოტო ან ლოგო და შეუკვეთე ონლაინ, მზადდება ${LEAD_TIME_KA}ში.`,
  },
  name: SERVICE_PAGE_NAMES["maisurebze-bechdva"],
  h1: "მაისურებზე ბეჭდვა თბილისში",
  intro: `maika.ge-ზე მაისურის დაბეჭდვა ერთი ცალიდანაც შეგიძლია — შენი ფოტოთი, ლოგოთი, წარწერით ან ხელოვნური ინტელექტით შექმნილი დიზაინით. 15 წელია ვკერავთ და ვბეჭდავთ თბილისში. შეკვეთა მზადდება ${LEAD_TIME_KA}ში, მიწოდება მთელ საქართველოშია.`,
  heroLinks: [DESIGNER_LINK, CORPORATE_LINK],
  sections: [
    {
      h2: "ბეჭდვის მეთოდები",
      body: "მეთოდს დიზაინისა და რაოდენობის მიხედვით ვარჩევთ. თუ არ იცი, რომელი გჭირდება, მოგვწერე და გირჩევთ.",
      bullets: [
        {
          term: "DTF ბეჭდვა",
          text: "ნებისმიერი ფერი, ფოტო და დეტალური დიზაინი, ერთი ცალიდანაც. ფერი ნათელია და პრინტი რეცხვას უძლებს. საიტიდან შეკვეთილი ნივთი DTF-ით იბეჭდება.",
        },
        { term: "შელკოგრაფია", text: "დიდი ტირაჟისთვის: რაც მეტია რაოდენობა, მით იაფია ერთი ცალი." },
        { term: "თერმული ბეჭდვა (FLEX)", text: "გვარები, ნომრები და მარტივი ერთფეროვანი ლოგოები." },
        { term: "ქარგვა", text: "დიდი რაოდენობისთვის. პრემიუმ იერი პოლოებზე, ჰუდებზე და კეპებზე." },
      ],
    },
    {
      h2: "რაზე ვბეჭდავთ",
      body: "მაისურებზე (მათ შორის პოლოებზე, oversize და საბავშვო მოდელებზე), ჰუდებზე, ელვიან ჰუდებზე და ბომბერებზე, კეპებზე, ნაჭრის ჩანთებზე, წინსაფრებზე, ჭიქებზე და ტელეფონის ქეისებზე.",
      links: [
        { href: "/t-shirt", label: "მაისურები" },
        { href: "/t-shirt/polo", label: "პოლო მაისურები" },
        { href: "/hoodie", label: "ჰუდები" },
        { href: "/hoodie/jel-zipper", label: "ელვიანი ჰუდები" },
        { href: "/hoodie/gildan-bomber", label: "ბომბერები" },
        { href: "/cap", label: "კეპები" },
        { href: "/tote-bag", label: "ნაჭრის ჩანთები" },
        { href: "/apron", label: "წინსაფრები" },
        { href: "/mug", label: "ჭიქები" },
        { href: "/phone-case", label: "ტელეფონის ქეისები" },
      ],
    },
    {
      h2: "ფასები",
      bullets: priceBullets([
        ["მაისური ბეჭდვით", "T-Shirt", true],
        ["ჰუდი ბეჭდვით", "Hoodie", true],
        ["ნაჭრის ჩანთა", "Tote Bag", false],
        ["კეპი", "Cap", false],
        ["წინსაფარი", "Apron", false],
        ["ჭიქა", "Mug", false],
        ["ტელეფონის ქეისი", "Phone Case", false],
      ]),
      note: "ფასში შედის ცალმხრივი A4 ბეჭდვა. ზუსტი ფასი კონსტრუქტორში მაშინვე ჩანს — ბრენდის, პრინტის ზომისა და ორმხრივი ბეჭდვის მიხედვით. 10 ცალიდან ფასდაკლებაა.",
      links: [{ href: "/faq", label: "ყველა ფასი — ხშირი კითხვები" }],
    },
    {
      h2: "როგორ შევუკვეთო",
      steps: [
        "ატვირთე ფოტო ან ლოგო, დაწერე ტექსტი, ან აღწერე იდეა და AI დიზაინს უფასოდ შეგიქმნის.",
        "აირჩიე ნივთი, ბრენდი, ფერი და ზომა — როგორ გამოჩნდება, ეკრანზევე ნახავ.",
        "გადაიხადე ონლაინ, ან მოდი შოურუმში და შეუკვეთე ადგილზე.",
      ],
      links: [DESIGNER_LINK],
    },
    {
      h2: "ფაილის მომზადება",
      body: "საუკეთესო შედეგისთვის ატვირთე მაღალი გარჩევადობის ფოტო, ლოგო კი — სასურველია გამჭვირვალე ფონით (PNG). თუ ლოგო მხოლოდ დაბალი ხარისხით გაქვს ან ფაილი არ გაქვს საერთოდ, მოგვწერე და მაკეტის მომზადებაში დაგეხმარებით.",
    },
    {
      h2: "მზა დიზაინები ქართული წარწერით",
      body: "საკუთარი დიზაინი არ გაქვს? კატალოგში ასობით მზა დიზაინია: ქართული წარწერები, საქართველოს დროშა და სიმბოლიკა, იუმორი, სპორტი. აირჩიე და დაბეჭდე ნებისმიერ მაისურზე ან ჰუდზე.",
      links: [{ href: "/designs", label: "მზა დიზაინების კატალოგი" }],
    },
    {
      h2: "ვადა და პრინტის ზომა",
      body: `შეკვეთა მზადდება ${LEAD_TIME_KA}ში. კონკრეტული დღისთვის თუ გჭირდება, მოგვწერე და დაგეხმარებით. პრინტის სტანდარტული ზომა A4-ია, მაქსიმალური — A3.`,
    },
    {
      h2: "ბეჭდვა შენს მოტანილ ნივთზე",
      body: "შეგიძლია შენი მაისური ან ჰუდი მოიტანო და მასზე დაგიბეჭდავთ. ქსოვილს ადგილზე ვამოწმებთ — ყველა მასალა ბეჭდვისთვის არ გამოდგება. მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ.",
    },
    {
      h2: "მიწოდება და შოურუმი",
      body: `${COURIER_SENTENCE} შეკვეთის აღება შოურუმშიც შეიძლება: ${SHOWROOM_KA}.`,
      links: [{ href: "/contact", label: "მისამართი და სამუშაო საათები" }],
    },
    {
      h2: "კომპანიებისა და გუნდებისთვის",
      body: "ბრენდირებული მაისურები, ჰუდები და კეპები კომპანიის ლოგოთი, 10 ცალიდან ფასდაკლებით. ვართ დინამო თბილისის ოფიციალური პარტნიორი, ვთანამშრომლობთ Nike-ის ოფიციალურ წარმომადგენლობასთან საქართველოში და ცნობილი ბრენდების ადგილობრივ წარმომადგენლობებთან.",
      links: [CORPORATE_LINK, { href: "/sportuli-formebi", label: "სპორტული ფორმები გვარით და ნომრით" }, { href: "/portfolio", label: "ჩვენი ნამუშევრები" }],
    },
  ],
  faqHeading: "ხშირი კითხვები ბეჭდვაზე",
  faq: [
    {
      q: "რა ღირს მაისურზე ბეჭდვა?",
      a: `${PRINTING_PRICE_LEAD}ფასში შედის ცალმხრივი A4 ბეჭდვა. ზუსტი ფასი დამოკიდებულია ბრენდზე, პრინტის ზომასა და ორმხრივ ბეჭდვაზე და კონსტრუქტორში მაშინვე ჩანს.`,
    },
    {
      q: "ერთი ცალის დაბეჭდვაც შეიძლება?",
      a: "დიახ. DTF ბეჭდვით ერთ ცალსაც ვბეჭდავთ — ფოტოსაც და ნებისმიერ ფერად დიზაინსაც. 10 ცალიდან ფასდაკლებაა.",
    },
    {
      q: "რამდენ ხანში მზადდება შეკვეთა?",
      a: `${LEAD_TIME_KA}. დიდ ტირაჟზე, შელკოგრაფიასა და ქარგვაზე ვადა რაოდენობაზეა დამოკიდებული და შეკვეთისას შეგითანხმებთ.`,
    },
    {
      q: "ფოტოს დაბეჭდვა მაისურზე შეიძლება?",
      a: "დიახ. ატვირთე ფოტო კონსტრუქტორში — DTF ბეჭდვა ფოტოს ფერებს და დეტალებს კარგად გადმოსცემს. რაც უკეთესი ხარისხისაა ფაილი, მით სუფთაა პრინტი.",
    },
    {
      q: "რა ზომის პრინტი შეიძლება?",
      a: "სტანდარტული ზომა A4-ია, მაქსიმალური — A3.",
    },
    {
      q: "ჩემს მოტანილ მაისურზე დამიბეჭდავთ?",
      a: "დიახ. ქსოვილს ადგილზე ვამოწმებთ, რომ ბეჭდვისთვის გამოდგეს. მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ.",
    },
    {
      q: "ლოგოსთვის რომელი მეთოდი ჯობია?",
      a: "მცირე რაოდენობაზე და ფერად ლოგოზე — DTF, დიდ ტირაჟზე — შელკოგრაფია ან ქარგვა, გვარებსა და ნომრებზე — FLEX. მოგვწერე და მეთოდს ერთად შევარჩევთ.",
    },
  ],
  cta: {
    h2: "დაიწყე ახლავე",
    body: "შექმენი დიზაინი საიტზე და შეუკვეთე რამდენიმე წუთში. კომპანიის ან გუნდის შეკვეთისთვის მოგვწერე — ფასს და ვადას შეგითანხმებთ.",
    links: [DESIGNER_LINK, CORPORATE_LINK, ...CONTACT_LINKS],
  },
  serviceType: "მაისურებზე ბეჭდვა",
};

// ── /sportuli-formebi ───────────────────────────────────────────────────────

const KIT_PRICE = "ფასი დამოკიდებულია დიზაინსა და რაოდენობაზე — მოგვწერეთ.";

export const SPORT_KITS_PAGE: ServicePageCopy = {
  slug: "sportuli-formebi",
  path: "/sportuli-formebi",
  seo: {
    title: "სპორტული ფორმები გვარით და ნომრით | maika.ge",
    description:
      "ფეხბურთის და კალათბურთის ფორმების შეკერვა გუნდებისთვის — მაისური, შორტი, ლოგო, გვარი და ნომერი. 10–12 კომპლექტიდან. მოგვწერე და შეგითანხმებთ.",
  },
  name: SERVICE_PAGE_NAMES["sportuli-formebi"],
  h1: "სპორტული ფორმები გვარით და ნომრით",
  intro:
    "ვკერავთ სპორტულ ფორმებს გუნდებისთვის — ფეხბურთისა და კალათბურთისთვის. კომპლექტში შედის მაისური და შორტი, გუნდის ლოგო, მოთამაშის გვარი და ნომერი. ვამზადებთ ზრდასრულებისთვისაც და ნებისმიერი ასაკის ბავშვებისთვისაც.",
  heroLinks: CONTACT_LINKS,
  sections: [
    {
      h2: "რა შედის ფორმაში",
      bullets: [
        { term: "მაისური და შორტი", text: "შენი გუნდის ფერებში, ინდივიდუალური დიზაინით." },
        { term: "გუნდის ლოგო", text: "მაისურზე, დიზაინით შეთანხმებულ ადგილას." },
        { term: "გვარი და ნომერი", text: "თითოეულ მოთამაშეზე ცალ-ცალკე, FLEX ან DTF ბეჭდვით." },
      ],
    },
    {
      h2: "ფეხბურთის ფორმები და მაისურები",
      body: "ფეხბურთის გუნდის ფორმა — მაისური და შორტი ლოგოთი, გვარით და ნომრით, როგორც ზრდასრულთა, ისე საბავშვო გუნდებისთვის.",
    },
    {
      h2: "კალათბურთის ფორმები და მაისურები",
      body: "კალათბურთის მაისური და შორტი გუნდის ფერებში, ლოგოთი, გვარით და ნომრით.",
    },
    {
      h2: "როგორ ვმუშაობთ",
      steps: [
        "მოგვწერე და გაგვიზიარე იდეა ან უხეში ესკიზი — ფერები, ლოგო, სასურველი სტილი. თუ ესკიზი არ გაქვს, დაგეხმარებით.",
        "ერთად ვათანხმებთ დიზაინს, რაოდენობას და ზომებს.",
        "გამოგვიგზავნი მოთამაშეების გვარებს, ნომრებს და ზომებს.",
        "ვკერავთ და ვბეჭდავთ. ვადა რაოდენობაზეა დამოკიდებული — შეკვეთისას შეგითანხმებთ.",
      ],
    },
    {
      h2: "მინიმალური რაოდენობა",
      body: "გუნდის ფორმებს ვკერავთ 10–12 კომპლექტიდან, ზრდასრულებისთვის და ნებისმიერი ასაკის ბავშვებისთვის.",
    },
    {
      h2: "ფასი და ვადა",
      body: `${KIT_PRICE} ვადაც რაოდენობაზეა დამოკიდებული და შეკვეთისას შეგითანხმებთ.`,
    },
    {
      h2: "რას ვერ ვაკეთებთ",
      body: "ზოლიან ფორმებს და ფორმებს გრადიენტით (ფერის თანდათანობითი გადასვლით) ვერ ვკერავთ. ცნობილი კლუბებისა და ეროვნული ნაკრებების ფორმებს არ ვყიდით და არ ვკერავთ — არც მათ ასლებს ვამზადებთ. ვკერავთ მხოლოდ შენი გუნდის საკუთარ ფორმას.",
    },
    {
      h2: "გვარი და ნომერი შენს ფორმაზე",
      body: "თუ ფორმა უკვე გაქვს, მოიტანე — გვარს და ნომერს FLEX ან DTF ბეჭდვით დაგიტანთ.",
      links: [{ href: "/maisurebze-bechdva", label: "მაისურებზე ბეჭდვა — მეთოდები და ვადები" }],
    },
  ],
  faqHeading: "ხშირი კითხვები სპორტულ ფორმებზე",
  faq: [
    {
      q: "რა მინიმალური რაოდენობით კერავთ ფორმებს?",
      a: "10–12 კომპლექტიდან. ერთი კომპლექტი არის მაისური და შორტი ლოგოთი, გვარით და ნომრით.",
    },
    { q: "რა ღირს გუნდის ფორმა?", a: KIT_PRICE },
    {
      q: "რამდენ ხანში მზადდება ფორმები?",
      a: "ვადა რაოდენობაზეა დამოკიდებული. დიზაინისა და რაოდენობის შეთანხმებისას ზუსტ ვადას გეტყვით.",
    },
    {
      q: "ბავშვებისთვისაც კერავთ?",
      a: "დიახ, ნებისმიერი ასაკის ბავშვებისთვის და ზრდასრულებისთვის.",
    },
    {
      q: "რა ტიპის ფორმებს ვერ კერავთ?",
      a: "ზოლიან და გრადიენტიან ფორმებს ვერ ვკერავთ. ცნობილი კლუბებისა და ნაკრებების ფორმებს არ ვყიდით და არ ვკერავთ, არც მათ ასლებს ვამზადებთ.",
    },
    {
      q: "ჩემს ფორმაზე გვარს და ნომერს დამიწერთ?",
      a: "დიახ. მოიტანე ფორმა და გვარს და ნომერს FLEX ან DTF ბეჭდვით დაგიტანთ.",
    },
  ],
  cta: {
    h2: "მოგვწერე შენი გუნდის შესახებ",
    body: "გაგვიზიარე იდეა, რაოდენობა და ზომები — დიზაინს, ფასს და ვადას ერთად შევათანხმებთ.",
    links: [...CONTACT_LINKS, CORPORATE_LINK],
  },
  serviceType: "სპორტული ფორმების შეკერვა",
};

/** Every service page, keyed by slug (SERVICE_PAGE_SLUGS order). */
export const SERVICE_PAGES: Readonly<Record<ServicePageSlug, ServicePageCopy>> = {
  "maisurebze-bechdva": PRINTING_PAGE,
  "sportuli-formebi": SPORT_KITS_PAGE,
};

/** The pages in SERVICE_PAGE_SLUGS order. */
export const SERVICE_PAGE_LIST: readonly ServicePageCopy[] = SERVICE_PAGE_SLUGS.map((s) => SERVICE_PAGES[s]);

// ── JSON-LD ─────────────────────────────────────────────────────────────────

const PROVIDER = {
  "@type": "LocalBusiness",
  name: "Maika.ge",
  url: SITE_URL,
  image: `${SITE_URL}/maika-logo.png`,
  telephone: SERVICE_CONTACT.phone.tel,
  email: "maika@maika.ge",
  address: {
    "@type": "PostalAddress",
    streetAddress: "ა. წერეთლის #2, დინამოს სტადიონი, კარი #10",
    addressLocality: "Tbilisi",
    addressCountry: "GE",
  },
};

/** Service + FAQPage + BreadcrumbList — the same three on the live page and in the static file. */
export function serviceSchemas(page: ServicePageCopy): object[] {
  const url = `${SITE_URL}${page.path}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: page.h1,
      serviceType: page.serviceType,
      description: page.seo.description,
      url,
      provider: PROVIDER,
      areaServed: [
        { "@type": "Country", name: "Georgia" },
        { "@type": "City", name: "Tbilisi" },
      ],
    },
    faqPageSchema([{ heading: page.faqHeading, items: page.faq }]),
    buildBreadcrumbList([{ name: "მთავარი", url: SITE_URL }, { name: page.name }]),
  ];
}
