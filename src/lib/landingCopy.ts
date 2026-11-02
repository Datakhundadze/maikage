// Text section shown BELOW the constructor on a product landing route, keyed
// by product slug. Only the bare product route gets it (/t-shirt — never
// /t-shirt/<brand>, so the brand pages don't repeat the same text).
//
// ONE SOURCE for the live page (components/landing/LandingCopySection.tsx,
// mounted by ProductLandingPage) and the static prerender
// (scripts/prerender.mjs, which loads this module through
// scripts/lib/appModules.mjs). Text is owner-approved — keep it verbatim.
//
// No prices in this file, by rule: a section's `priceLead` receives the price
// already formatted by the page (lib/landingPrice.ts → calculatePrice). The
// live page omits the sentence when no price is available; the prerender
// always omits it. The lead time comes from LEAD_TIME_KA.
//
// A copy may also carry photos (`images`), a FAQ (`faqHeading` + `faq`) and
// the data for its Service + FAQPage + BreadcrumbList JSON-LD (`schema`,
// built by lib/serviceSchema.ts — the same builder the service pages use).
// /hoodie and /corporate (lib/corporateCopy.ts) have them; /t-shirt does not,
// so its markup is unchanged.
import type { FaqItem } from "@/lib/faqContent";
import { LANDING_SEO_OVERRIDES_KA } from "@/lib/landingSeo";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import { buildServiceSchemas } from "@/lib/serviceSchema";

/** One list item: a bold term, then " — ", then the text. */
export interface LandingCopyBullet {
  term: string;
  text: string;
}

export interface LandingCopySection {
  h3: string;
  /** First sentence, built around the formatted "from" price. Optional. */
  priceLead?: (price: string) => string;
  /** A section has a body paragraph, a bullet list, or both (body first). */
  body?: string;
  bullets?: LandingCopyBullet[];
  link?: { href: string; label: string };
}

/** A photo: a file under public/, its Georgian alt text and its pixel size. */
export interface LandingCopyImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** What the Service / BreadcrumbList JSON-LD needs beyond the FAQ. */
export interface LandingCopySchema {
  /** Site path of the page, e.g. "/hoodie". */
  path: string;
  /** Service.name. */
  h1: string;
  /** Breadcrumb label. */
  name: string;
  serviceType: string;
  description: string;
}

export interface LandingCopy {
  h2: string;
  intro: string;
  /** Photos shown right after the intro (lazy-loaded, explicit size). */
  images?: LandingCopyImage[];
  sections: LandingCopySection[];
  /** FAQ after the sections: an h3 heading, then h4 question / answer. */
  faqHeading?: string;
  faq?: FaqItem[];
  schema?: LandingCopySchema;
}

export const LANDING_COPY: Readonly<Record<string, LandingCopy>> = {
  "t-shirt": {
    h2: "მაისურების დამზადება და ბეჭდვა თბილისში",
    intro: `maika.ge-ზე შენი დიზაინით მაისურს რამდენიმე წუთში შეუკვეთავ. ატვირთე ფოტო ან ლოგო, დაწერე ტექსტი, ან აღწერე იდეა და AI დიზაინს უფასოდ შეგიქმნის. შეკვეთა მზადდება ${LEAD_TIME_KA}ში.`,
    sections: [
      {
        h3: "მაისურები ქართული წარწერით",
        body: "კატალოგში ასობით მზა დიზაინია: ქართული წარწერები, საქართველოს დროშა და სიმბოლიკა, იუმორი, სპორტი. აირჩიე და დაბეჭდე ნებისმიერ მაისურზე.",
        link: { href: "/designs?category=georgian", label: "კატალოგი" },
      },
      {
        h3: "ბრენდები და მოდელები",
        body: "GILDAN, Sol's, TH, JEL, GIORDANO, NIKE, Polo, Oversize და საბავშვო ზომები.",
      },
      {
        h3: "ფასი",
        priceLead: (price) => `მაისური ბეჭდვით ${price}-დან.`,
        body: "ზუსტი ფასი კონსტრუქტორში ჩანს, ბრენდისა და პრინტის ზომის მიხედვით. 10 ცალიდან ფასდაკლებაა.",
      },
      {
        h3: "ხარისხი",
        body: "ვბეჭდავთ DTF ტექნოლოგიით. ფერი ნათელია, პრინტი რეცხვას უძლებს.",
        link: { href: "/maisurebze-bechdva", label: "ბეჭდვის მეთოდები და ვადები" },
      },
      {
        h3: "მიწოდება და შოურუმი",
        body: "ვაწვდით მთელ საქართველოში. შეგიძლია შოურუმშიც მოხვიდე: ა. წერეთლის #2, დინამოს სტადიონი, მე-10 კარი.",
      },
      {
        h3: "კომპანიებისა და გუნდებისთვის",
        body: "მაისურები კომპანიის ლოგოთი, ფორმები ღონისძიებებისა და გუნდებისთვის.",
        link: { href: "/corporate", label: "კორპორატიული შეკვეთა" },
      },
    ],
  },
  hoodie: {
    h2: "ჰუდებზე ბეჭდვა თბილისში",
    intro: `maika.ge-ზე ჰუდს შენი დიზაინით რამდენიმე წუთში შეუკვეთავ. ატვირთე ფოტო ან ლოგო, დაწერე ტექსტი, ან აღწერე იდეა და AI დიზაინს უფასოდ შეგიქმნის. ჰუდზე ბეჭდვა ერთი ცალიდანაც შეიძლება, შეკვეთა კი მზადდება ${LEAD_TIME_KA}ში.`,
    images: [
      { src: "/showroom/hoodie-black-front.webp", alt: "შავი ჰუდი კაპიუშონით — მასზე შენს დიზაინს დავბეჭდავთ", width: 809, height: 949 },
      { src: "/showroom/hoodie-washed-gray-front.webp", alt: "ნაცრისფერი ნარეცხი ჰუდი ბეჭდვისთვის", width: 776, height: 963 },
    ],
    sections: [
      {
        h3: "მოდელები",
        body: "ჩვეულებრივი ჰუდები, ელვიანი ჰუდები და ბომბერები. ბრენდს, ფერს და ზომას კონსტრუქტორში ირჩევ — როგორ გამოჩნდება, ეკრანზევე ნახავ.",
      },
      {
        h3: "ბეჭდვის მეთოდები",
        bullets: [
          { term: "DTF ბეჭდვა", text: "ნებისმიერი ფერი, ფოტო და დეტალური დიზაინი, ერთი ცალიდანაც. ფერი ნათელია და პრინტი რეცხვას უძლებს." },
          { term: "შოლკოგრაფია", text: "დიდი ტირაჟისთვის: რაც მეტია რაოდენობა, მით იაფია ერთი ცალი." },
          { term: "ქარგვა", text: "დიდი რაოდენობისთვის. პრემიუმ იერი პოლოებზე, ჰუდებზე და კეპებზე." },
        ],
        link: { href: "/maisurebze-bechdva", label: "ბეჭდვის მეთოდები და ვადები" },
      },
      {
        h3: "ფაილის მომზადება",
        body: "საუკეთესო შედეგისთვის ატვირთე მაღალი გარჩევადობის ფოტო, ლოგო კი — სასურველია გამჭვირვალე ფონით (PNG). თუ ფაილი დაბალი ხარისხისაა ან საერთოდ არ გაქვს, მოგვწერე და მაკეტის მომზადებაში დაგეხმარებით.",
      },
      {
        h3: "პრინტის ზომა",
        body: "პრინტის სტანდარტული ზომა A4-ია, მაქსიმალური — A3. ზუსტი ფასი კონსტრუქტორში ჩანს, ბრენდის, პრინტის ზომისა და ორმხრივი ბეჭდვის მიხედვით. 10 ცალიდან ფასდაკლებაა.",
      },
      {
        h3: "ჰუდები ქართული წარწერით",
        body: "საკუთარი დიზაინი არ გაქვს? კატალოგში ასობით მზა დიზაინია: ქართული წარწერები, საქართველოს დროშა და სიმბოლიკა, იუმორი, სპორტი. აირჩიე და დაბეჭდე ნებისმიერ ჰუდზე.",
        link: { href: "/designs", label: "მზა დიზაინების კატალოგი" },
      },
      {
        h3: "მიწოდება და შოურუმი",
        body: "ვაწვდით მთელ საქართველოში. შეკვეთის აღება შოურუმშიც შეიძლება: დინამო არენა, მე-10 კარი.",
      },
      {
        h3: "კომპანიებისა და გუნდებისთვის",
        body: "ჰუდები კომპანიის ლოგოთი — ღონისძიებებისა და გუნდებისთვის, 10 ცალიდან ფასდაკლებით.",
        link: { href: "/corporate", label: "კორპორატიული შეკვეთა" },
      },
    ],
    faqHeading: "ხშირი კითხვები ჰუდებზე ბეჭდვაზე",
    faq: [
      {
        q: "ერთი ჰუდის დაბეჭდვაც შეიძლება?",
        a: "დიახ. DTF ბეჭდვით ერთ ცალსაც ვბეჭდავთ — ფოტოსაც და ნებისმიერ ფერად დიზაინსაც. 10 ცალიდან ფასდაკლებაა.",
      },
      {
        q: "რამდენ ხანში მზადდება ჰუდი?",
        a: `${LEAD_TIME_KA}. დიდ ტირაჟზე, შოლკოგრაფიასა და ქარგვაზე ვადა რაოდენობაზეა დამოკიდებული და შეკვეთისას შეგითანხმებთ.`,
      },
      {
        q: "ფოტოს დაბეჭდვა ჰუდზე შეიძლება?",
        a: "დიახ. ატვირთე ფოტო კონსტრუქტორში — DTF ბეჭდვა ფოტოს ფერებს და დეტალებს კარგად გადმოსცემს. რაც უკეთესი ხარისხისაა ფაილი, მით სუფთაა პრინტი.",
      },
      {
        q: "ჰუდის ორივე მხარეს დაბეჭდვა შეიძლება?",
        a: "დიახ — წინა მხარეს, ზურგზე ან ორივე მხარეს. ზუსტი ფასი კონსტრუქტორში მაშინვე ჩანს, პრინტის ზომისა და ორმხრივი ბეჭდვის მიხედვით.",
      },
      {
        q: "ჩემს მოტანილ ჰუდზე დამიბეჭდავთ?",
        a: "დიახ. ქსოვილს ადგილზე ვამოწმებთ, რომ ბეჭდვისთვის გამოდგეს. მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ.",
      },
      {
        q: "რეგიონებში აგზავნით?",
        a: "დიახ, კურიერით ვაწვდით მთელ საქართველოში. შეკვეთის აღება შოურუმშიც შეიძლება.",
      },
    ],
    schema: {
      path: "/hoodie",
      h1: "ჰუდებზე ბეჭდვა თბილისში",
      name: "ჰუდებზე ბეჭდვა",
      serviceType: "ჰუდებზე ბეჭდვა",
      description: LANDING_SEO_OVERRIDES_KA.Hoodie?.description ?? "",
    },
  },
};

/** The copy for a bare product route, or null (brand routes never get one). */
export function landingCopyFor(productSlug: string, brandSlug: string | null): LandingCopy | null {
  if (brandSlug) return null;
  return Object.prototype.hasOwnProperty.call(LANDING_COPY, productSlug) ? LANDING_COPY[productSlug] : null;
}

/**
 * Service + FAQPage + BreadcrumbList for a copy that carries `schema` and a
 * FAQ (lib/serviceSchema.ts), or null. ProductLandingPage and the prerender
 * both call this.
 */
export function landingCopySchemas(copy: LandingCopy | null): object[] | null {
  if (!copy?.schema || !copy.faq?.length) return null;
  return buildServiceSchemas({ ...copy.schema, faqHeading: copy.faqHeading ?? "", faq: copy.faq });
}
