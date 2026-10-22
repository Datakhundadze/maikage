// /faq content — the text FaqPage.tsx renders AND the build-time prerender
// writes to dist/faq/index.html (scripts load this module through Vite,
// scripts/lib/appModules.mjs — never a retyped copy).
//
// Product prices are NOT typed here: they are read from pricing.ts PRICES
// (the table calculatePrice charges at checkout) and the bag fee from
// fees.ts BAG_FEE. Both imports are pure data modules, safe for the
// prerender. Delivery prices live in OrderDialog.tsx (a React component the
// prerender must not load), so they are mirrored below and a test
// (src/test/faqPrices.test.tsx) fails if they ever differ.

import { PRICES } from "@/lib/pricing";
import { BAG_FEE } from "@/lib/fees";
import { CATALOG_PROMO, isCatalogPromoActive } from "@/lib/catalogPromo";

/** The page's head and intro — FaqPage's SeoHead, <h1> and lead paragraph. */
export const FAQ_PAGE = {
  title: "ხშირად დასმული კითხვები (FAQ) | Maika.ge",
  description: "მაისურზე და ჰუდზე ბეჭდვის ფასები, მიწოდება, ვადები, გადახდა და ხშირი კითხვები — ყველაფერი Maika.ge-ის სერვისების შესახებ ერთ გვერდზე.",
  h1: "ხშირად დასმული კითხვები",
  intro: "ფასები, მიწოდება, ვადები და გადახდა — ყველაფერი ერთ გვერდზე.",
  backLabel: "მთავარი გვერდი",
} as const;

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqGroup {
  heading: string;
  items: FaqItem[];
}

/** [pricing.ts PRICES key, customer-facing name], in the order the answer lists them. */
export type FaqBrand = readonly [priceKey: string, label: string];

/** Every T-shirt brand (catalog SUB_PRODUCTS["T-Shirt"]) as the FAQ names it. */
export const FAQ_TSHIRT_BRANDS: readonly FaqBrand[] = [
  ["GILDAN", "GILDAN"],
  ["TH", "TH"],
  ["Polo", "Polo"],
  ["Sol's", "Sol's"],
  ["GILDAN HUMMER", "პრემიუმ ხარისხის"],
  ["GIORDANO", "GIORDANO"],
  ["Oversize", "Oversize"],
  ["JEL T-Shirt", "მოხარშული ნაჭარი"],
  ["Khundadze", "Khundadze"],
  ["NIKE", "NIKE"],
  ["GILDAN KIDS", "GILDAN KIDS (საბავშვო)"],
];

/** Every hoodie brand (catalog SUB_PRODUCTS["Hoodie"]) as the FAQ names it. */
export const FAQ_HOODIE_BRANDS: readonly FaqBrand[] = [
  ["GILDAN Hoodie", "GILDAN"],
  ["JEL Standard Hoodie", "JEL"],
  ["JEL Standard Zipper", "JEL ელვიანი"],
  ["Premium Washed Hoodie", "მოხარშული ნაჭარი"],
  ["JEL Zipper", "ელვიანი მოხარშული"],
  ["GILDAN Bomber", "GILDAN Bomber"],
];

/** pricing.ts PRICES keys of the single-price products the FAQ quotes. */
export const FAQ_PRODUCT_KEYS = {
  phoneCase: "Phone Case",
  mug: "Mug",
  tote: "Tote Bag",
  cap: "Cap",
  apron: "Apron",
} as const;

/**
 * Courier prices — a mirror of OrderDialog.tsx DELIVERY_PRICES
 * (courier_tbilisi / courier_outside). Not imported: OrderDialog is a React
 * component with Supabase wiring. src/test/faqPrices.test.tsx reads
 * OrderDialog's source and fails if these differ.
 */
export const FAQ_DELIVERY_PRICES = {
  courier_tbilisi: 8,
  courier_outside: 12,
} as const;

/** "35₾" — the FAQ's price format (no space). */
export const gel = (amount: number): string => `${amount}₾`;

/** Front-only (one-side) price from pricing.ts, as the checkout charges it. */
const frontPrice = (key: string): string => gel(PRICES[key]?.frontOnly);

/**
 * Catalog SALE sentence (lib/catalogPromo.ts), appended to the T-shirt answer
 * while the promo runs — the regular Sol's price in the brand list stays as is.
 * Evaluated when this module loads (build time for the prerendered /faq).
 */
export const FAQ_CATALOG_PROMO_SENTENCE = isCatalogPromoActive()
  ? ` კატალოგიდან შეკვეთისას ${CATALOG_PROMO.subProduct} მაისური ფასდაკლებით ${gel(CATALOG_PROMO.price)} ღირს.`
  : "";

/** "GILDAN 35₾, TH 45₾, …" — a brand missing from PRICES is left out, never priced by hand. */
const brandPrices = (brands: readonly FaqBrand[]): string =>
  brands
    .filter(([key]) => PRICES[key] !== undefined)
    .map(([key, label]) => `${label} ${frontPrice(key)}`)
    .join(", ");

// Single source of truth for the rendered accordion, its FAQPage JSON-LD
// (FaqPage.tsx) AND the build-time static /faq page (scripts/prerender.mjs,
// which loads this module — it never retypes the text). Keep questions and
// answers verbatim — these are the brand-approved phrasings used by the
// storefront. Product, delivery and bag-fee numbers are interpolated from
// their sources above; the service prices (A3, surname + number, express
// courier, own-item print, დაუთბილავი ჰუდი) are owner-confirmed literals.
export const FAQ_GROUPS: FaqGroup[] = [
  {
    heading: "ფასები — ბეჭდვა",
    items: [
      {
        q: "რა ღირს მაისურზე ბეჭდვა?",
        a: `${brandPrices(FAQ_TSHIRT_BRANDS)}. ფასში შედის ცალმხრივი A4 ბეჭდვა. ორმხრივი ბეჭდვა: +10₾ პატარა წარწერა ან ლოგო, +15₾ დიდი პრინტი.${FAQ_CATALOG_PROMO_SENTENCE}`,
      },
      {
        q: "რა ღირს ჰუდი?",
        a: `${brandPrices(FAQ_HOODIE_BRANDS)}. დაუთბილავი ჰუდი — 85₾, შეზღუდული ფერები და ზომები, მხოლოდ შოურუმში. ფასში შედის ბეჭდვა.`,
      },
      {
        q: "რა ღირს ქეისზე ბეჭდვა?",
        a: `${frontPrice(FAQ_PRODUCT_KEYS.phoneCase)} სასურველი პრინტით.`,
      },
      {
        q: "რა ღირს ჭიქაზე ბეჭდვა?",
        a: `${frontPrice(FAQ_PRODUCT_KEYS.mug)} სასურველი პრინტით.`,
      },
      {
        q: "რა ღირს ნაჭრის ჩანთაზე ბეჭდვა?",
        a: `${frontPrice(FAQ_PRODUCT_KEYS.tote)} სასურველი პრინტით.`,
      },
      {
        q: "რა ღირს კეპზე ბეჭდვა?",
        a: `${frontPrice(FAQ_PRODUCT_KEYS.cap)} სასურველი პრინტით.`,
      },
      {
        q: "რა ღირს წინსაფარზე ბეჭდვა?",
        a: `${frontPrice(FAQ_PRODUCT_KEYS.apron)} სასურველი პრინტით.`,
      },
      {
        q: "A4-ზე დიდი პრინტი შეიძლება?",
        a: "დიახ, მაქსიმუმ A3 ფორმატამდე, +10/15₾ ზომის მიხედვით.",
      },
      {
        q: "ფასდაკლება გაქვთ დიდი რაოდენობით შეკვეთაზე?",
        a: "დიახ, 10 ცალიდან ზემოთ ვრცელდება ფასდაკლება. ზუსტი ფასი დამოკიდებულია შეკვეთის დეტალებზე — დაგვიკავშირდით და შემოგთავაზებთ ინდივიდუალურ ფასს.",
      },
    ],
  },
  {
    heading: "სპორტული და კორპორატიული",
    items: [
      {
        q: "ბეჭდავთ თუ არა სპორტულ მაისურზე გვარს და ნომერს?",
        a: "დიახ, 20₾ სასურველი გვარითა და ნომრით.",
      },
      {
        q: "გაქვთ თუ არა სპორტული მაისურები?",
        a: "ვკერავთ ინდივიდუალურად სპორტული გუნდებისთვის.",
      },
    ],
  },
  {
    heading: "ვადები",
    items: [
      {
        q: "რამდენ ხანში მზადდება შეკვეთა?",
        a: "1-2 სამუშაო დღე. კონკრეტული დღისთვის თუ გჭირდებათ — მოგვწერეთ და დაგეხმარებით.",
      },
    ],
  },
  {
    heading: "მიწოდება",
    items: [
      {
        q: "მთელ საქართველოში აგზავნით?",
        a: `დიახ. საკურიერო მომსახურება თბილისში ${gel(FAQ_DELIVERY_PRICES.courier_tbilisi)}, თბილისს გარეთ ${gel(FAQ_DELIVERY_PRICES.courier_outside)}. კურიერი კარზე მოგაწვდით. ონლაინ შეკვეთას ემატება ${gel(BAG_FEE)} შეფუთვის საფასური.`,
      },
      {
        q: "სასწრაფოდ შეიძლება მიღება?",
        a: "დიახ, ექსპრეს კურიერი 12₾. 15:00-მდე გაფორმებული შეკვეთა იმავე დღეს იგზავნება.",
      },
      {
        q: "შოურუმში მოსვლა და ადგილზე წაღება შეიძლება?",
        a: "დიახ. მისამართი: ა. წერეთლის #2, დინამოს სტადიონი, მე-10 კარი.",
      },
    ],
  },
  {
    heading: "დიზაინი და მასალა",
    items: [
      {
        q: "შეიძლება ჩემი მაისური/ჰუდი მოვიტანო ბეჭდვისთვის?",
        a: "დიახ, A4 პრინტი 20₾. გაითვალისწინეთ — მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ.",
      },
      {
        q: "რეცხვის შემდეგ პრინტი ხომ არ წავა?",
        a: "არა. ვბეჭდავთ DTF ტექნოლოგიით — ფერი სტაბილურია, ბუნებრივი და ნათელი, პრინტი ქსოვილში ინტეგრირებული და რეცხვაგამძლეა.",
      },
      {
        q: "AI დიზაინი როგორ მუშაობს?",
        a: "Maika.ge-ის AI სტუდიაში უფასოდ შეგიძლიათ შექმნათ უნიკალური დიზაინი ხელოვნური ინტელექტით და დაბეჭდოთ მაისურზე, ჰუდიზე თუ სხვა ნივთზე.",
      },
    ],
  },
  {
    heading: "გადახდა და საათები",
    items: [
      {
        q: "როგორ ხდება გადახდა?",
        a: "საბანკო გადარიცხვით, ონლაინ, ბარათით ან ნაღდი ანგარიშსწორებით.",
      },
      {
        q: "როდის ხართ ღია?",
        a: "ორშაბათი-პარასკევი 11:00-19:00, შაბათი 11:00-18:00, კვირა არასამუშაო დღეა.",
      },
    ],
  },
];

/**
 * schema.org FAQPage for the given groups — the ONE builder used by the live
 * page (FaqPage.tsx) and the static prerender (scripts/prerender.mjs).
 */
export function faqPageSchema(groups: readonly FaqGroup[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups
      .flatMap((g) => g.items)
      .map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
  };
}
