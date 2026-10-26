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
import { LEAD_TIME_KA } from "@/lib/leadTime";

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

export interface LandingCopy {
  h2: string;
  intro: string;
  sections: LandingCopySection[];
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
};

/** The copy for a bare product route, or null (brand routes never get one). */
export function landingCopyFor(productSlug: string, brandSlug: string | null): LandingCopy | null {
  if (brandSlug) return null;
  return Object.prototype.hasOwnProperty.call(LANDING_COPY, productSlug) ? LANDING_COPY[productSlug] : null;
}
