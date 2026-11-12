// English pages under /en — the hub (/en) and English versions of the main
// service pages. Same facts as the Georgian pages (lib/serviceCopy.ts), written
// for people who search and ask AI assistants in English: visitors, expats,
// international companies.
//
// ONE SOURCE for the live page (pages/EnPage.tsx) and the static prerender
// (scripts/prerender.mjs → dist/en/<slug>/index.html, loaded through
// scripts/lib/appModules.mjs). Never retype a string from here.
//
// Rules (same as serviceCopy.ts):
// - Prices are never typed: product prices come from fromPrice (pricing.ts),
//   courier prices from FAQ_DELIVERY_PRICES, the lead time from LEAD_TIME_EN.
//   A price that cannot be computed drops its line. Prices appear only where
//   the Georgian twin shows them (the hub and /en/t-shirt-printing); the
//   other pages carry no amount, like their phase-2 Georgian twins.
// - Owner-confirmed facts only. Partner brands: Dinamo and Nike only.
// - Every page names its Georgian twin (kaPath) for hreflang.
import type { ProductType } from "@/lib/catalog";
import type { FaqItem } from "@/lib/faqContent";
import { FAQ_DELIVERY_PRICES, faqPageSchema } from "@/lib/faqContent";
import { fromPrice } from "@/lib/landingPrice";
import { LEAD_TIME_EN } from "@/lib/leadTime";
import { buildBreadcrumbList, SITE_URL } from "@/lib/seoSchemas";
import type { ServiceBullet, ServiceImage, ServiceLink, ServiceSection } from "@/lib/serviceCopy";

export interface EnPageCopy {
  /** "" for the hub, else the segment after /en/. */
  slug: string;
  /** "/en" or "/en/<slug>". */
  path: string;
  /** The Georgian page with the same content (hreflang ka / x-default). */
  kaPath: string;
  seo: { title: string; description: string };
  /** Breadcrumb / link label. */
  name: string;
  h1: string;
  intro: string;
  heroLinks: ServiceLink[];
  images?: ServiceImage[];
  sections: ServiceSection[];
  faqHeading: string;
  faq: FaqItem[];
  cta: { h2: string; body: string; links: ServiceLink[] };
  /** schema.org Service.serviceType ("" on the hub: LocalBusiness only). */
  serviceType: string;
}

export const EN_HOME_LABEL = "Home";
export const EN_SERVICES_HEADING = "Our services in English";
export const EN_GEORGIAN_LINK_LABEL = "ქართულად";
/** The link from a Georgian page to its English twin. */
export const EN_SWITCH_LABEL = "English";

// ── Shared facts ────────────────────────────────────────────────────────────

const SHOWROOM_EN = "Dinamo Arena, Gate 10 (2 Akaki Tsereteli Ave, Tbilisi 0112)";
const HOURS_EN = "Monday–Friday 11:00–19:00, Saturday 11:00–18:00, closed on Sunday";

const lari = (amount: number): string => `${amount} GEL`;

function priceOf(product: ProductType): number | null {
  try {
    const p = fromPrice(product, null);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

function priceBullets(rows: readonly [string, ProductType, boolean][]): ServiceBullet[] {
  const out: ServiceBullet[] = [];
  for (const [term, product, from] of rows) {
    const p = priceOf(product);
    if (p === null) continue;
    out.push({ term, text: from ? `from ${lari(p)}` : lari(p) });
  }
  return out;
}

const TSHIRT_FROM = priceOf("T-Shirt");
const HOODIE_FROM = priceOf("Hoodie");

const COURIER_EN = `We deliver by courier across Georgia: ${lari(FAQ_DELIVERY_PRICES.courier_tbilisi)} in Tbilisi, ${lari(FAQ_DELIVERY_PRICES.courier_outside)} to the regions.`;
const DELIVERY_EN = `We deliver by courier across Georgia, or you can pick up your order at our showroom: ${SHOWROOM_EN}.`;
const PARTNERS_EN =
  "We are an official partner of FC Dinamo Tbilisi and work with Nike's official representative in Georgia.";
const BROUGHT_ITEM_EN =
  "You can bring your own garment and we will print on it. We check the fabric on the spot — not every material takes a print — and we cannot take responsibility for damage to a garment you bring.";
const FILE_EN =
  "Send a high-resolution photo, and your logo preferably as a PNG with a transparent background. Screenshots and small images saved from social media often print blurry. No good file? Message us and we will help prepare the layout.";
const KIT_LIMITS_EN =
  "We don't make striped kits or kits with colour gradients. We don't sell or copy the kits of famous clubs or national teams — we only make your own team's kit.";
const INVOICE_EN = "Companies always get an invoice; on request we also sign a contract and issue a waybill and a tax invoice.";

const DESIGNER: ServiceLink = { href: "/t-shirt", label: "Design yours online" };
const CORPORATE: ServiceLink = { href: "/en/corporate-merch", label: "Corporate orders" };
const CONTACT_LINKS: ServiceLink[] = [
  { href: "tel:+995599050807", label: "Call +995 599 05 08 07" },
  { href: "https://wa.me/995599050807", label: "WhatsApp us" },
  { href: "https://www.facebook.com/maika.ge", label: "Message us on Facebook" },
];
const VISIT: ServiceSection = {
  h2: "Delivery and showroom",
  body: `${DELIVERY_EN} Showroom hours: ${HOURS_EN}.`,
  links: [{ href: "/contact", label: "Map and directions" }],
};

// ── /en (hub) ───────────────────────────────────────────────────────────────

const HUB_PRICE =
  TSHIRT_FROM !== null
    ? `A printed T-shirt starts from ${lari(TSHIRT_FROM)}${HOODIE_FROM !== null ? `, a printed hoodie from ${lari(HOODIE_FROM)}` : ""}. `
    : "";

export const EN_HUB: EnPageCopy = {
  slug: "",
  path: "/en",
  kaPath: "/",
  seo: {
    title: "Custom T-shirt & Hoodie Printing in Tbilisi | maika.ge",
    description: `Custom T-shirts, hoodies, mugs and phone cases printed with your photo, logo or an AI-made design — from a single item, ready in ${LEAD_TIME_EN}. Showroom at Dinamo Arena, Gate 10, Tbilisi.`,
  },
  name: "maika.ge in English",
  h1: "Custom T-shirt and hoodie printing in Tbilisi",
  intro: `maika.ge prints T-shirts, hoodies, caps, tote bags, mugs and phone cases with your own photo, logo, text or a design made with AI — from a single item. We have been sewing and printing in Tbilisi for 15 years. Orders are ready in ${LEAD_TIME_EN}, and we deliver across Georgia. Our showroom is at Dinamo Arena, Gate 10.`,
  heroLinks: [DESIGNER, CORPORATE],
  images: [
    { src: "/showroom/tee-white-front.webp", alt: "White T-shirt ready for printing your photo, logo or text", width: 646, height: 948 },
    { src: "/showroom/tee-black-front.webp", alt: "Black T-shirt for DTF printing from a single item", width: 660, height: 942 },
  ],
  sections: [
    {
      h2: "What we print",
      bullets: [
        { term: "Your photo", text: "on a T-shirt, hoodie, mug or phone case — a personal gift from one piece." },
        { term: "Your logo", text: "branded T-shirts, polos, hoodies, caps and tote bags for companies, events and teams." },
        { term: "Your text", text: "a name, a quote, an inside joke — in Georgian, English or any language." },
        { term: "A design made with AI", text: "describe your idea and the AI designer creates it for free, then you see it on the product." },
        { term: "Ready-made designs", text: "hundreds of designs in our catalogue: Georgian alphabet and inscriptions, the Georgian flag, humour, sport." },
      ],
      links: [{ href: "/designs", label: "Browse the design catalogue" }],
    },
    {
      h2: "Services",
      links: [
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
      ],
    },
    {
      h2: "Prices",
      body: `${HUB_PRICE}The price includes a one-sided A4 print; the exact price shows instantly in the online designer, depending on the brand, print size and printing on both sides. Discounts from 10 items.`,
      links: [{ href: "/en/t-shirt-printing", label: "All prices" }],
    },
    {
      h2: "How to order",
      steps: [
        "Upload a photo or logo, type your text, or describe an idea and let the AI create a design for free.",
        "Choose the item, brand, colour and size — you see exactly how it will look.",
        "Pay online, or come to the showroom and order in person.",
      ],
      links: [DESIGNER],
    },
    { h2: "Lead time", body: `Orders are ready in ${LEAD_TIME_EN}. Need it for a specific day? Message us and we will do our best. Large runs, screen printing and embroidery are scheduled by quantity.` },
    { ...VISIT, body: `${COURIER_EN} You can also pick up your order at our showroom: ${SHOWROOM_EN}. Showroom hours: ${HOURS_EN}.` },
    { h2: "Partners", body: PARTNERS_EN, links: [{ href: "/portfolio", label: "Our work" }] },
  ],
  faqHeading: "Frequently asked questions",
  faq: [
    { q: "Can you print just one T-shirt?", a: "Yes. With DTF printing we print a single item too — a photo or any full-colour design." },
    { q: "How long does an order take?", a: `${LEAD_TIME_EN}. Large runs, screen printing and embroidery depend on the quantity; we agree the date when you order.` },
    { q: "Where is the showroom?", a: `${SHOWROOM_EN} — right at the stadium. Open ${HOURS_EN}.` },
    { q: "Do you deliver outside Tbilisi?", a: COURIER_EN },
    { q: "Can I order in English?", a: "Yes — write to us on WhatsApp or Facebook, or order online in the designer." },
  ],
  cta: {
    h2: "Start your design",
    body: "Create your design on the site and order in a few minutes. For company or team orders, message us and we will agree the price and the date.",
    links: [DESIGNER, ...CONTACT_LINKS],
  },
  serviceType: "",
};

// ── /en/t-shirt-printing ↔ /maisurebze-bechdva ──────────────────────────────

export const EN_TSHIRT: EnPageCopy = {
  slug: "t-shirt-printing",
  path: "/en/t-shirt-printing",
  kaPath: "/maisurebze-bechdva",
  seo: {
    title: "T-shirt Printing in Tbilisi — From 1 Item, 1–3 Days | maika.ge",
    description: `Custom T-shirt and hoodie printing in Tbilisi from a single item: DTF, screen printing, FLEX and embroidery. Upload a photo or logo and order online — ready in ${LEAD_TIME_EN}.`,
  },
  name: "T-shirt & hoodie printing",
  h1: "T-shirt and hoodie printing in Tbilisi",
  intro: `Print a T-shirt with your photo, logo, text or an AI-made design — even just one. We have been sewing and printing in Tbilisi for 15 years. Orders are ready in ${LEAD_TIME_EN}, with delivery across Georgia.`,
  heroLinks: [DESIGNER, CORPORATE],
  images: EN_HUB.images,
  sections: [
    {
      h2: "Printing methods",
      body: "We choose the method by the design and the quantity. Not sure which one you need? Ask us.",
      bullets: [
        { term: "DTF printing", text: "any colour, photos and fine detail, from one item. Bright colours that survive washing. Everything ordered online is printed with DTF." },
        { term: "Screen printing", text: "for large runs: the more you order, the cheaper each piece." },
        { term: "Heat transfer (FLEX)", text: "names, numbers and simple one-colour logos." },
        { term: "Embroidery", text: "for large quantities — a premium look on polos, hoodies and caps." },
      ],
      links: [
        { href: "/en/dtf-printing", label: "DTF printing" },
        { href: "/en/screen-printing", label: "Screen printing" },
        { href: "/en/logo-embroidery", label: "Logo embroidery" },
      ],
    },
    {
      h2: "What we print on",
      body: "T-shirts (including polos, oversized and kids' models), hoodies, zip hoodies and bombers, caps, tote bags, aprons, mugs and phone cases.",
      links: [
        { href: "/t-shirt", label: "T-shirts" },
        { href: "/hoodie", label: "Hoodies" },
        { href: "/cap", label: "Caps" },
        { href: "/tote-bag", label: "Tote bags" },
        { href: "/mug", label: "Mugs" },
        { href: "/phone-case", label: "Phone cases" },
      ],
    },
    {
      h2: "Prices",
      bullets: priceBullets([
        ["Printed T-shirt", "T-Shirt", true],
        ["Printed hoodie", "Hoodie", true],
        ["Tote bag", "Tote Bag", false],
        ["Cap", "Cap", false],
        ["Apron", "Apron", false],
        ["Mug", "Mug", false],
        ["Phone case", "Phone Case", false],
      ]),
      note: "The price includes a one-sided A4 print. The exact price shows instantly in the designer — by brand, print size and printing on both sides. Discounts from 10 items.",
    },
    {
      h2: "How to order",
      steps: [
        "Upload a photo or logo, type your text, or describe an idea and the AI creates a design for free.",
        "Choose the item, brand, colour and size — you see how it looks on screen.",
        "Pay online, or come to the showroom and order in person.",
      ],
      links: [DESIGNER],
    },
    { h2: "Preparing your file", body: FILE_EN },
    { h2: "Lead time and print size", body: `Orders are ready in ${LEAD_TIME_EN}; for a specific day, message us. The standard print size is A4, the maximum is A3.` },
    { h2: "Printing on your own garment", body: BROUGHT_ITEM_EN },
    { ...VISIT, body: `${COURIER_EN} Pick-up is also possible at our showroom: ${SHOWROOM_EN}. Showroom hours: ${HOURS_EN}.` },
    {
      h2: "For companies and teams",
      body: `Branded T-shirts, hoodies and caps with your company logo, with discounts from 10 items. ${PARTNERS_EN}`,
      links: [CORPORATE, { href: "/en/team-kits", label: "Team kits with names and numbers" }],
    },
  ],
  faqHeading: "T-shirt printing — FAQ",
  faq: [
    {
      q: "How much does T-shirt printing cost?",
      a: `${TSHIRT_FROM !== null ? `A printed T-shirt starts from ${lari(TSHIRT_FROM)}${HOODIE_FROM !== null ? `, a hoodie from ${lari(HOODIE_FROM)}` : ""}. ` : ""}That includes a one-sided A4 print; the exact price depends on the brand, print size and two-sided printing and shows instantly in the designer.`,
    },
    { q: "Can you print a single T-shirt?", a: "Yes. DTF prints one item too — photos and any full-colour design. Discounts from 10 items." },
    { q: "How fast is it?", a: `${LEAD_TIME_EN}. Large runs, screen printing and embroidery depend on the quantity and are agreed when you order.` },
    { q: "Can you print a photo on a T-shirt?", a: "Yes. Upload it in the designer — DTF keeps the colours and detail of a photo. The better the file, the cleaner the print." },
    { q: "What print size is possible?", a: "Standard A4, maximum A3." },
    { q: "Will you print on a T-shirt I bring?", a: "Yes. We check the fabric on the spot; we cannot take responsibility for a garment you bring." },
    { q: "Which method is best for a logo?", a: "DTF for small quantities and colourful logos, screen printing or embroidery for large runs, FLEX for names and numbers." },
  ],
  cta: {
    h2: "Start now",
    body: "Create your design on the site and order in minutes. For a company or team order, message us — we will agree the price and the date.",
    links: [DESIGNER, ...CONTACT_LINKS],
  },
  serviceType: "T-shirt printing",
};

// ── /en/dtf-printing ↔ /dtf-bechdva ─────────────────────────────────────────

export const EN_DTF: EnPageCopy = {
  slug: "dtf-printing",
  path: "/en/dtf-printing",
  kaPath: "/dtf-bechdva",
  seo: {
    title: "DTF Printing on Clothes in Tbilisi — From 1 Item | maika.ge",
    description: `DTF printing on T-shirts, hoodies, caps and tote bags in Tbilisi: photos, full-colour logos and text from a single item. Ready in ${LEAD_TIME_EN}.`,
  },
  name: "DTF printing",
  h1: "DTF printing on clothes in Tbilisi",
  intro: `With DTF we transfer any design — a photo, a full-colour logo, text or an illustration — onto T-shirts, hoodies, caps and tote bags, even a single piece. Everything you order on maika.ge is printed this way, and it is ready in ${LEAD_TIME_EN}.`,
  heroLinks: [DESIGNER, ...CONTACT_LINKS.slice(1, 2)],
  sections: [
    {
      h2: "What is DTF printing",
      body: "The design is first printed on a special film, then pressed onto the fabric with heat. There is no limit on colours, so photos, colour gradients and fine detail come out well. Colours are bright and the print survives washing.",
    },
    {
      h2: "When DTF is the right choice",
      bullets: [
        { term: "Photos and colourful designs", text: "no limit on the number of colours." },
        { term: "One or a few items", text: "gifts, couple T-shirts, birthdays, small events." },
        { term: "A logo in a small quantity", text: "a colourful logo for a team or a small company." },
      ],
      note: "For large runs screen printing is often cheaper, for a premium look we recommend embroidery, and for names and numbers — FLEX.",
      links: [
        { href: "/en/screen-printing", label: "Screen printing" },
        { href: "/en/logo-embroidery", label: "Embroidery" },
      ],
    },
    {
      h2: "What we print on",
      body: "T-shirts (including polos, oversized and kids' models), hoodies, zip hoodies and bombers, caps, tote bags and aprons.",
    },
    {
      h2: "How to order online",
      steps: [
        "Upload a photo or logo, type text, or describe an idea and the AI designs it for free.",
        "Choose the item, colour and size and see the result on screen.",
        "Pay online, or order in person at the showroom.",
      ],
      links: [DESIGNER],
    },
    { h2: "What we need from you", body: FILE_EN },
    { h2: "Print size and lead time", body: `Standard print size A4, maximum A3 — on the front, the back or both. Ready in ${LEAD_TIME_EN}; for a specific day, message us.` },
    { h2: "For companies and teams", body: `A colourful logo for a small company, team or event — from one piece, with no setup. Names and numbers on sports kits are printed with FLEX. Discounts on large quantities. ${INVOICE_EN}` },
    { h2: "Printing on your own garment", body: BROUGHT_ITEM_EN },
    VISIT,
  ],
  faqHeading: "DTF printing — FAQ",
  faq: [
    { q: "Can you DTF-print a single item?", a: "Yes — one photo or any full-colour design on a single item." },
    { q: "Does a photo print well?", a: "Yes. DTF keeps a photo's colours and detail. The better the file, the cleaner the print." },
    { q: "Does a DTF print survive washing?", a: "Yes — the colours stay bright and the print survives washing." },
    { q: "What size can the print be?", a: "Standard A4, maximum A3." },
    { q: "How long does it take?", a: `${LEAD_TIME_EN}. For large runs the date depends on the quantity.` },
    { q: "DTF or screen printing?", a: "DTF prints from one item in any colours; screen printing is for large runs, where the more you order, the cheaper each piece." },
  ],
  cta: { h2: "Print your design", body: "Create it in the online designer, or send us your file.", links: [DESIGNER, ...CONTACT_LINKS] },
  serviceType: "DTF printing",
};

// ── /en/screen-printing ↔ /shelkografia ─────────────────────────────────────

export const EN_SCREEN: EnPageCopy = {
  slug: "screen-printing",
  path: "/en/screen-printing",
  kaPath: "/shelkografia",
  seo: {
    title: "Screen Printing on T-shirts in Tbilisi — Large Runs | maika.ge",
    description: "Screen printing on T-shirts, hoodies and tote bags in Tbilisi for companies, events, festivals and teams. The more you order, the cheaper each piece. Invoice for companies.",
  },
  name: "Screen printing",
  h1: "Screen printing on T-shirts in Tbilisi",
  intro: "Screen printing is the classic method for large runs — when the same logo or text goes on many T-shirts, hoodies or tote bags. The more you order, the cheaper each piece. We print for companies, events, festivals and teams in Tbilisi and deliver across Georgia.",
  heroLinks: CONTACT_LINKS,
  sections: [
    { h2: "How screen printing works", body: "A separate screen is made for every colour of the design, and the ink goes through it straight onto the fabric. Setup takes time, but every following piece prints fast — which is why it pays off on large quantities." },
    {
      h2: "When screen printing is the right choice",
      bullets: [
        { term: "Large runs", text: "one design on many items — for a company, an event or a team." },
        { term: "A simple logo or text", text: "clear shapes and a few colours." },
        { term: "Matching staff uniforms", text: "T-shirts, hoodies and bags in one style." },
      ],
      note: "For photos, colour gradients and small quantities DTF is better — it prints from one item. For a premium look we recommend embroidery.",
      links: [{ href: "/en/dtf-printing", label: "DTF printing" }],
    },
    { h2: "Colours and print position", body: "Every colour needs its own screen, so the number of colours affects the price and the lead time. The print can go on the front, the back or both." },
    {
      h2: "How we work",
      steps: [
        "Send us your logo and tell us the item, the quantity and the sizes.",
        "We choose the method and agree the layout: position, size and colours.",
        "We print, pack and send it by courier, or hand it over at the showroom.",
      ],
    },
    { h2: "What we need from you", body: `${FILE_EN} Standard print size A4, maximum A3.` },
    { h2: "Price and lead time", body: `The price and the date depend on the quantity, the number of colours and the item — we agree them when you order. Discounts on large runs. ${INVOICE_EN}` },
    VISIT,
  ],
  faqHeading: "Screen printing — FAQ",
  faq: [
    { q: "Screen printing or DTF?", a: "Screen printing puts one design on many items and gets cheaper per piece as the quantity grows. DTF prints from one item and handles photos and any colour." },
    { q: "Can you screen-print a photo?", a: "For photos and colour gradients we recommend DTF." },
    { q: "How long does it take?", a: "It depends on the quantity and the method; we agree the exact date when you order." },
    { q: "Do you issue an invoice?", a: "Yes, always. On request — a contract and a waybill too." },
    { q: "Do you deliver to the regions?", a: "Yes, by courier across Georgia." },
  ],
  cta: { h2: "Send us your order details", body: "Logo, item, quantity and sizes — we will reply with the method, price and date.", links: [...CONTACT_LINKS, CORPORATE] },
  serviceType: "Screen printing",
};

// ── /en/logo-embroidery ↔ /logos-kargva ─────────────────────────────────────

export const EN_EMBROIDERY: EnPageCopy = {
  slug: "logo-embroidery",
  path: "/en/logo-embroidery",
  kaPath: "/logos-kargva",
  seo: {
    title: "Logo Embroidery on Polos, Hoodies & Caps in Tbilisi | maika.ge",
    description: "Logo embroidery on polo shirts, hoodies and caps in Tbilisi for companies, hotels, restaurants, events and teams — for large quantities. Invoice and contract for companies.",
  },
  name: "Logo embroidery",
  h1: "Logo embroidery on clothes in Tbilisi",
  intro: "An embroidered logo gives clothing a premium, durable look. It works especially well on polo shirts, hoodies and caps. We embroider for large quantities — companies, hotels, cafés and restaurants, events and teams.",
  heroLinks: CONTACT_LINKS,
  sections: [
    {
      h2: "What we embroider",
      bullets: [
        { term: "Polo shirts", text: "a logo on the chest — for staff uniforms." },
        { term: "Hoodies and bombers", text: "on the chest or wherever the design calls for." },
        { term: "Caps", text: "a logo on the front." },
      ],
    },
    { h2: "When embroidery is the right choice", body: "When you want a durable, high-end look and the logo is simple and clear. Very fine detail, photos and colour gradients don't translate well into thread — for those we recommend DTF or screen printing. Because we embroider only large quantities, a small order with a colourful logo is printed with DTF." },
    {
      h2: "How we work",
      steps: [
        "Send us your logo and tell us the item, quantity and sizes.",
        "We agree the layout: logo position, size and thread colours.",
        "We embroider, pack and send it by courier, or hand it over at the showroom.",
      ],
    },
    { h2: "What we need from you", body: FILE_EN },
    { h2: "Who we embroider for", body: "Staff uniforms for offices, hotels, restaurants, salons and clinics; company gifts; polos and caps for sports clubs and schools. An embroidered logo is ideal for workwear that is washed often." },
    { h2: "Price, lead time and documents", body: `The price and the date depend on the quantity, the logo size and the item — we agree them when you order. Discounts on large quantities. ${INVOICE_EN}` },
    VISIT,
  ],
  faqHeading: "Logo embroidery — FAQ",
  faq: [
    { q: "Can you embroider just a few pieces?", a: "We embroider only large quantities. For a few pieces we print a colourful logo with DTF, even a single item." },
    { q: "What do you embroider on?", a: "Mainly polo shirts, hoodies and caps. Need something else? Ask us." },
    { q: "Can any logo be embroidered?", a: "Simple, clear logos embroider best. For photos, very fine detail and gradients DTF is better." },
    { q: "How long does it take?", a: "It depends on the quantity; we agree the exact date when you order." },
    { q: "Do you sign contracts and issue invoices?", a: "Invoices always; a contract and other documents on request." },
  ],
  cta: { h2: "Send us your order details", body: "Logo, item, quantity and sizes — we will reply with the price and the date.", links: [...CONTACT_LINKS, CORPORATE] },
  serviceType: "Logo embroidery",
};

// ── /en/team-kits ↔ /sportuli-formebi ───────────────────────────────────────

export const EN_TEAM_KITS: EnPageCopy = {
  slug: "team-kits",
  path: "/en/team-kits",
  kaPath: "/sportuli-formebi",
  seo: {
    title: "Football & Basketball Team Kits with Names and Numbers | maika.ge",
    description: "Custom football and basketball kits for teams in Tbilisi: jersey, shorts, team logo, player names and numbers. From 10–12 kits, adult and kids' sizes.",
  },
  name: "Team kits",
  h1: "Football and basketball team kits with names and numbers",
  intro: "We make custom kits for football and basketball teams — amateur, school, corporate and kids' teams. A kit is a jersey and shorts in your team's colours, with the team logo and each player's name and number. Adult sizes and kids' sizes for any age.",
  heroLinks: CONTACT_LINKS,
  images: [
    { src: "/products/sport/jersey-3.webp", alt: "Football jersey with a number — custom team kit", width: 832, height: 1248 },
    { src: "/products/sport/jersey-2.webp", alt: "Basketball jersey in team colours with lettering", width: 832, height: 1248 },
  ],
  sections: [
    {
      h2: "What a kit includes",
      bullets: [
        { term: "Jersey and shorts", text: "in your team's colours, with your own design." },
        { term: "Team logo", text: "on the jersey, where the design places it. Colourful logos are printed with DTF." },
        { term: "Name and number", text: "for every player, printed with FLEX or DTF." },
      ],
    },
    {
      h2: "How we work",
      steps: [
        "Message us with your idea or a rough sketch — colours, logo, style. No sketch? We will help.",
        "We agree the design, the quantity and the sizes.",
        "You send the players' names, numbers and sizes.",
        "We sew and print. The date depends on the quantity — we agree it when you order.",
      ],
    },
    { h2: "Minimum order", body: "Team kits start from 10–12 kits, for adults and for kids of any age." },
    { h2: "Price and lead time", body: "The price and the date depend on the design and the number of kits — message us and we will tell you after seeing the sketch. Discounts on larger orders." },
    { h2: "What we can't do", body: KIT_LIMITS_EN },
    { h2: "Names and numbers on your existing kit", body: "Already have kits? Bring them — we print names and numbers with FLEX or DTF." },
    { h2: "Partners", body: PARTNERS_EN },
    VISIT,
  ],
  faqHeading: "Team kits — FAQ",
  faq: [
    { q: "What is the minimum order?", a: "10–12 kits. One kit is a jersey and shorts with the logo, name and number." },
    { q: "How much does a team kit cost?", a: "It depends on the design and the quantity — message us." },
    { q: "How long does it take?", a: "It depends on the quantity; we give you the exact date once the design and quantity are agreed." },
    { q: "Do you make kids' kits?", a: "Yes, for kids of any age and for adults." },
    { q: "Which kits can't you make?", a: "Striped and gradient kits, and copies of famous clubs' or national teams' kits." },
    { q: "Can you add names and numbers to my kit?", a: "Yes — bring it and we print them with FLEX or DTF." },
  ],
  cta: { h2: "Tell us about your team", body: "Share the idea, the quantity and the sizes — we will agree the design, price and date together.", links: CONTACT_LINKS },
  serviceType: "Sports team kits",
};

// ── /en/corporate-merch ↔ /korporatiuli-sachukrebi ──────────────────────────

export const EN_CORPORATE: EnPageCopy = {
  slug: "corporate-merch",
  path: "/en/corporate-merch",
  kaPath: "/korporatiuli-sachukrebi",
  seo: {
    title: "Branded Merch & Corporate Gifts with Your Logo in Tbilisi | maika.ge",
    description: "Branded T-shirts, polos, hoodies, caps, mugs and tote bags with your company logo in Tbilisi — DTF, screen printing and embroidery. Invoice, contract and waybill.",
  },
  name: "Branded merch & corporate gifts",
  h1: "Branded merch and corporate gifts in Tbilisi",
  intro: "We make branded merch for employees, partners and clients — with your company logo, in one style. It works for New Year, company anniversaries, conferences, trainings and welcome kits for new hires. You send the logo; we do the layout, printing and packing.",
  heroLinks: CONTACT_LINKS,
  sections: [
    {
      h2: "What we brand",
      bullets: [
        { term: "T-shirts and polos", text: "logo on the front, back or both." },
        { term: "Hoodies and bombers", text: "printed or embroidered." },
        { term: "Caps", text: "printed or embroidered logo." },
        { term: "Mugs", text: "your logo on an everyday office item." },
        { term: "Tote bags", text: "for conferences, shops and events." },
        { term: "Phone cases", text: "an everyday item with your brand on it." },
        { term: "Vests and raincoats", text: "made to order for staff, volunteers and campaigns." },
      ],
    },
    {
      h2: "Branding methods",
      bullets: [
        { term: "DTF printing", text: "colourful logo or photo, any quantity." },
        { term: "Screen printing", text: "large runs — the more you order, the cheaper each piece." },
        { term: "Embroidery", text: "large quantities — a premium look on polos, hoodies and caps." },
      ],
    },
    {
      h2: "How we work",
      steps: [
        "Send your logo and tell us what you need: items, quantity, sizes, deadline.",
        "We agree the layout — where and how big the logo goes on each item.",
        "We produce, pack and deliver by courier, or you pick up at the showroom.",
      ],
    },
    { h2: "What we need from you", body: `${FILE_EN} Production starts once the layout is approved.` },
    { h2: "Documents and public procurement", body: `${INVOICE_EN} Documents can be signed electronically.` },
    { h2: "Price and lead time", body: "The price depends on the item, the branding method and the quantity, with discounts on large orders. The lead time depends on the method and the quantity — we agree both when you order." },
    { h2: "Partners", body: `${PARTNERS_EN} We produce branded merchandise for international and Georgian brands.`, links: [{ href: "/portfolio", label: "Our work" }] },
    VISIT,
  ],
  faqHeading: "Corporate orders — FAQ",
  faq: [
    { q: "What can we brand with our logo?", a: "T-shirts, polos, hoodies, bombers, caps, mugs, tote bags, phone cases, and made-to-order vests and raincoats." },
    { q: "Do you issue an invoice and sign a contract?", a: "Invoices always; a contract, acceptance act, waybill and tax invoice on request." },
    { q: "Which branding method should we choose?", a: "DTF for colourful logos and smaller quantities, screen printing for large runs, embroidery for a premium look on large quantities." },
    { q: "How long does a corporate order take?", a: "It depends on the method and the quantity; we agree the exact date when you order." },
    { q: "We only have a low-quality logo — what now?", a: "Send what you have and we will help prepare the layout." },
  ],
  cta: { h2: "Tell us about your company", body: "Items, quantity and deadline — we will reply with options, price and date.", links: CONTACT_LINKS },
  serviceType: "Branded merchandise and corporate gifts",
};

// ── /en/georgian-alphabet-t-shirts ↔ /maisurebi-kartuli-tsartserebit ────────

export const EN_GEORGIAN: EnPageCopy = {
  slug: "georgian-alphabet-t-shirts",
  path: "/en/georgian-alphabet-t-shirts",
  kaPath: "/maisurebi-kartuli-tsartserebit",
  seo: {
    title: "Georgian Alphabet T-shirts & Souvenirs in Tbilisi | maika.ge",
    description: `T-shirts and hoodies with the Georgian alphabet, Georgian words and symbols — hundreds of ready designs or your own text, printed from one item in ${LEAD_TIME_EN}. Tbilisi showroom and delivery.`,
  },
  name: "Georgian alphabet T-shirts",
  h1: "Georgian alphabet T-shirts in Tbilisi",
  intro: `Georgian letters are beautiful on their own — and especially on a T-shirt. Pick one of hundreds of ready designs in our catalogue (Georgian inscriptions, the flag and symbols, humour, sport) or write your own text in Georgian. We print from a single item, ready in ${LEAD_TIME_EN}.`,
  heroLinks: [{ href: "/designs?category=georgian", label: "Georgian designs" }, DESIGNER],
  sections: [
    { h2: "Ready-made designs", body: "The catalogue is sorted by category: Georgian, patriotic, the Georgian table, funny, couples, sport, travel and more. Choose a design, then the item, colour and size.", links: [{ href: "/designs", label: "Open the catalogue" }] },
    { h2: "Your own Georgian text", body: "A name, a quote, a line of poetry, a team motto? Type it in the designer, or describe the idea and the AI creates the design for free. You see the result on screen." },
    { h2: "What it prints on", body: "T-shirts (including oversized and kids' models), hoodies, tote bags and mugs. Standard print size A4, maximum A3. One order can hold several different designs." },
    { h2: "A souvenir from Georgia", body: "A T-shirt with Georgian letters is a great gift for friends abroad, guests and family — a piece of Georgia you wear every day. Matching designs work well for couples and friends." },
    { h2: "Colour tips", body: "Dark lettering stands out on white, grey or yellow T-shirts; light lettering on black, navy or red. Use the size chart on each model's page, or ask us." },
    { h2: "For events and groups", body: "Matching T-shirts with Georgian inscriptions look great at events, festivals and team outings. Discounts on large quantities; companies get an invoice." },
    { ...VISIT, body: `Ready in ${LEAD_TIME_EN}. ${DELIVERY_EN} Showroom hours: ${HOURS_EN}.` },
  ],
  faqHeading: "Georgian alphabet T-shirts — FAQ",
  faq: [
    { q: "Can I order one T-shirt with my own Georgian text?", a: "Yes — type the text in the designer and we print a single item." },
    { q: "Where can I buy a Georgian alphabet T-shirt in Tbilisi?", a: `Order online on maika.ge, or visit our showroom: ${SHOWROOM_EN}.` },
    { q: "How long does it take?", a: `${LEAD_TIME_EN}.` },
    { q: "Do you ship outside Tbilisi?", a: "Yes, by courier across Georgia." },
  ],
  cta: { h2: "Choose your design", body: "Browse the Georgian designs or write your own text.", links: [{ href: "/designs?category=georgian", label: "Georgian designs" }, DESIGNER] },
  serviceType: "Georgian text T-shirt printing",
};

// ── /en/mug-printing ↔ /chiqaze-bechdva ─────────────────────────────────────

export const EN_MUG: EnPageCopy = {
  slug: "mug-printing",
  path: "/en/mug-printing",
  kaPath: "/chiqaze-bechdva",
  seo: {
    title: "Custom Mug Printing with Your Photo in Tbilisi | maika.ge",
    description: `Mugs printed with your photo, text or logo — designed online, ready in ${LEAD_TIME_EN}. Gifts, family sets and branded office mugs. Delivery across Georgia.`,
  },
  name: "Mug printing",
  h1: "Custom mug printing with your photo",
  intro: `A mug with your photo, text or logo is one of the simplest and most personal gifts. Design it yourself online, see how it looks on screen, and it is ready in ${LEAD_TIME_EN}.`,
  heroLinks: [{ href: "/mug", label: "Design your mug" }],
  sections: [
    {
      h2: "What we print on mugs",
      bullets: [
        { term: "Photos", text: "family, friends, pets or a day to remember." },
        { term: "Text", text: "a name, a greeting, a quote or a joke — in Georgian or any language." },
        { term: "Logos", text: "your company's, café's or team's logo." },
      ],
    },
    {
      h2: "How to order online",
      steps: [
        "Open the mug designer and upload a photo or logo, or type text. Have an idea? The AI designs it for free.",
        "Place the design — you see how it looks on screen.",
        "Pay online, or order in person at the showroom.",
      ],
      links: [{ href: "/mug", label: "Mug designer" }],
    },
    { h2: "Preparing your photo", body: "Upload a high-resolution photo straight from your phone camera, not a compressed copy from social media. A mug is round, so keep the face or the main detail in the centre. For logos, a transparent PNG is best. We print on white mugs, where colours look clean." },
    { h2: "Gift ideas", body: "Birthdays, New Year, Mother's Day, Valentine's Day or a thank-you for a teacher. A single mug or a set — each with a different photo or name — for the whole family." },
    { h2: "Mugs with your company logo", body: "Branded mugs for the office, clients or events. Discounts on large quantities.", links: [CORPORATE] },
    { ...VISIT, body: `Ready in ${LEAD_TIME_EN}. ${DELIVERY_EN} Showroom hours: ${HOURS_EN}.` },
  ],
  faqHeading: "Mug printing — FAQ",
  faq: [
    { q: "Can I order a single mug?", a: "Yes, one mug or several, each with its own design." },
    { q: "How long does it take?", a: `${LEAD_TIME_EN}.` },
    { q: "What photo works best?", a: "A sharp, high-resolution photo with the main detail in the centre." },
    { q: "Do you make mugs with a company logo?", a: "Yes, with discounts on large quantities." },
  ],
  cta: { h2: "Create your mug", body: "Upload a photo and see it on the mug in seconds.", links: [{ href: "/mug", label: "Design your mug" }] },
  serviceType: "Mug printing",
};

// ── /en/phone-cases ↔ /telefonis-qeisebi ────────────────────────────────────

export const EN_PHONE: EnPageCopy = {
  slug: "phone-cases",
  path: "/en/phone-cases",
  kaPath: "/telefonis-qeisebi",
  seo: {
    title: "Custom Phone Cases with Your Photo in Tbilisi | maika.ge",
    description: `Custom phone cases with your photo, text or design for iPhone, Xiaomi and Samsung — designed online, ready in ${LEAD_TIME_EN}. Delivery across Georgia.`,
  },
  name: "Custom phone cases",
  h1: "Custom phone cases with your photo",
  intro: `A phone case with your photo, text or design — something you hold every day and nobody else has. Design it online: upload a photo, type text or describe an idea for the AI. You see the result on screen, and it is ready in ${LEAD_TIME_EN}.`,
  heroLinks: [{ href: "/phone-case", label: "Design your case" }],
  sections: [
    { h2: "Which phones", body: "Mainly iPhone, Xiaomi and Samsung models. Not sure we have your model? Message us before ordering." },
    {
      h2: "What we print",
      bullets: [
        { term: "Photos", text: "family, friends, pets or a trip to remember." },
        { term: "Text", text: "a name, initials, a quote — in Georgian or any language." },
        { term: "Designs", text: "your drawing, a logo or an AI-made design." },
      ],
    },
    { h2: "Preparing your photo", body: "A case is narrow and tall, so a vertical photo fits best. Keep the main detail near the centre so it doesn't fall under the camera. Upload a high-resolution photo straight from the camera." },
    { h2: "Cases with your company logo", body: "Branded phone cases for clients, partners or staff. Discounts on large quantities; companies get an invoice.", links: [CORPORATE] },
    { ...VISIT, body: `Ready in ${LEAD_TIME_EN}. ${DELIVERY_EN} Showroom hours: ${HOURS_EN}.` },
  ],
  faqHeading: "Custom phone cases — FAQ",
  faq: [
    { q: "Which phone models do you have?", a: "Mainly iPhone, Xiaomi and Samsung. Ask us about your model before ordering." },
    { q: "How long does it take?", a: `${LEAD_TIME_EN}.` },
    { q: "Can I put my own photo on it?", a: "Yes — a vertical, high-resolution photo works best." },
  ],
  cta: { h2: "Create your case", body: "Upload a photo and see it on the case right away.", links: [{ href: "/phone-case", label: "Design your case" }, ...CONTACT_LINKS.slice(1, 2)] },
  serviceType: "Custom phone case printing",
};

// ── /en/tote-bags ↔ /natsris-chantebi ───────────────────────────────────────

export const EN_TOTE: EnPageCopy = {
  slug: "tote-bags",
  path: "/en/tote-bags",
  kaPath: "/natsris-chantebi",
  seo: {
    title: "Custom Tote Bags with Your Design or Logo in Tbilisi | maika.ge",
    description: `Cloth tote bags printed with your design, photo or company logo — one bag online in ${LEAD_TIME_EN}, or large runs for events and companies. Delivery across Georgia.`,
  },
  name: "Custom tote bags",
  h1: "Custom tote bags with your design or logo",
  intro: "A tote bag goes everywhere — shopping, work, university, travel. With your design, photo or text it becomes a personal accessory; with your company logo, an ad that walks around the city. Order one bag online, or a large run for an event or a company.",
  heroLinks: [{ href: "/tote-bag", label: "Design your bag" }, CORPORATE],
  sections: [
    { h2: "A tote bag with your design", body: "Upload a photo or drawing, type text, or pick a ready design from the catalogue — Georgian inscriptions, humour, travel and more. Have an idea? The AI designs it for free." },
    {
      h2: "Tote bags with a logo",
      bullets: [
        { term: "Conferences and trainings", text: "a participant kit — a bag with the event logo." },
        { term: "Shops and cafés", text: "a reusable bag with your brand instead of a plastic one." },
        { term: "Festivals and exhibitions", text: "matching bags for guests and staff." },
      ],
    },
    {
      h2: "Branding methods",
      bullets: [
        { term: "DTF printing", text: "colourful logo, photo or detailed design, from one bag." },
        { term: "Screen printing", text: "large runs — the more you order, the cheaper each bag." },
      ],
    },
    { h2: "What we need from you", body: FILE_EN },
    { ...VISIT, body: `A bag ordered online is ready in ${LEAD_TIME_EN}; for large corporate orders the date depends on the quantity. ${DELIVERY_EN} Showroom hours: ${HOURS_EN}.` },
  ],
  faqHeading: "Custom tote bags — FAQ",
  faq: [
    { q: "Can I order a single tote bag?", a: "Yes, online — printed with DTF." },
    { q: "Do you make tote bags with a company logo in bulk?", a: "Yes — DTF or screen printing, with discounts on large quantities and an invoice for companies." },
    { q: "How long does it take?", a: `${LEAD_TIME_EN} for online orders; large runs are agreed by quantity.` },
  ],
  cta: { h2: "Create your tote bag", body: "Design it online, or send us your logo for a bulk order.", links: [{ href: "/tote-bag", label: "Design your bag" }, ...CONTACT_LINKS] },
  serviceType: "Tote bag printing",
};

// ── Lists, links, JSON-LD ───────────────────────────────────────────────────

/** Every English page, hub first. */
export const EN_PAGE_LIST: readonly EnPageCopy[] = [
  EN_HUB,
  EN_TSHIRT,
  EN_DTF,
  EN_SCREEN,
  EN_EMBROIDERY,
  EN_TEAM_KITS,
  EN_CORPORATE,
  EN_GEORGIAN,
  EN_MUG,
  EN_PHONE,
  EN_TOTE,
];

/** path → page, for the router. */
export const EN_PAGES: Record<string, EnPageCopy> = Object.fromEntries(EN_PAGE_LIST.map((p) => [p.path, p]));

/** Georgian path → its English twin (hreflang on the Georgian pages). */
export const EN_PATH_FOR_KA: Record<string, string> = Object.fromEntries(EN_PAGE_LIST.map((p) => [p.kaPath, p.path]));

/** The services block at the foot of every English page (the hub's list). */
export function enServiceLinksFor(path: string): ServiceLink[] {
  const list = EN_HUB.sections.find((s) => s.h2 === "Services")?.links ?? [];
  return [{ href: "/en", label: "maika.ge in English" }, ...list].filter((l) => l.href !== path);
}

/** hreflang alternates for a page: en, ka and x-default (the Georgian page). */
export function enAlternates(page: EnPageCopy): { hreflang: string; href: string }[] {
  const ka = page.kaPath === "/" ? SITE_URL : `${SITE_URL}${page.kaPath}`;
  return [
    { hreflang: "en", href: `${SITE_URL}${page.path}` },
    { hreflang: "ka", href: ka },
    { hreflang: "x-default", href: ka },
  ];
}

const PROVIDER_EN = {
  "@type": "LocalBusiness",
  name: "Maika.ge",
  url: SITE_URL,
  image: `${SITE_URL}/maika-logo.png`,
  telephone: "+995599050807",
  email: "maika@maika.ge",
  address: {
    "@type": "PostalAddress",
    streetAddress: "2 Akaki Tsereteli Ave, Dinamo Arena, Gate 10",
    addressLocality: "Tbilisi",
    postalCode: "0112",
    addressCountry: "GE",
  },
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "11:00", closes: "19:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "11:00", closes: "18:00" },
  ],
};

/** JSON-LD: Service (or LocalBusiness on the hub) + FAQPage + BreadcrumbList — live page and static file alike. */
export function enSchemas(page: EnPageCopy): object[] {
  const url = `${SITE_URL}${page.path}`;
  const main = page.serviceType
    ? {
        "@context": "https://schema.org",
        "@type": "Service",
        name: page.h1,
        serviceType: page.serviceType,
        description: page.seo.description,
        url,
        inLanguage: "en",
        provider: PROVIDER_EN,
        areaServed: [
          { "@type": "Country", name: "Georgia" },
          { "@type": "City", name: "Tbilisi" },
        ],
      }
    : { "@context": "https://schema.org", ...PROVIDER_EN, description: page.seo.description, inLanguage: "en" };
  const crumbs = page.path === "/en" ? [{ name: EN_HOME_LABEL }] : [{ name: EN_HOME_LABEL, url: `${SITE_URL}/en` }, { name: page.name }];
  return [main, faqPageSchema([{ heading: page.faqHeading, items: [...page.faq] }]), buildBreadcrumbList(crumbs)];
}
