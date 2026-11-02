// Service + FAQPage + BreadcrumbList JSON-LD for a page that sells one
// service: the service pages (lib/serviceCopy.ts serviceSchemas), /corporate
// (lib/corporateCopy.ts) and /hoodie (lib/landingCopy.ts). The live page
// (SeoHead / Helmet) and the static prerender (scripts/prerender.mjs) call the
// same builder, so both emit the same three objects.
import { faqPageSchema, type FaqItem } from "@/lib/faqContent";
import { buildBreadcrumbList, SITE_URL } from "@/lib/seoSchemas";

/**
 * Contact links — the same values as the /contact page and SeoHead
 * (scripts/lib/seo.mjs CONTACT; src/test/servicePages.test.ts checks them).
 */
export const SERVICE_CONTACT = {
  phone: { display: "+995 599 05 08 07", tel: "+995599050807" },
  whatsapp: "https://wa.me/995599050807",
  facebook: "https://www.facebook.com/maika.ge",
} as const;

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

export interface ServiceSchemaInput {
  /** Site path, e.g. "/corporate". */
  path: string;
  /** Service.name — the page's H1. */
  h1: string;
  /** Breadcrumb label of the page. */
  name: string;
  serviceType: string;
  description: string;
  faqHeading: string;
  faq: readonly FaqItem[];
}

/** Service + FAQPage + BreadcrumbList — the same three on the live page and in the static file. */
export function buildServiceSchemas(input: ServiceSchemaInput): object[] {
  const url = `${SITE_URL}${input.path}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: input.h1,
      serviceType: input.serviceType,
      description: input.description,
      url,
      provider: PROVIDER,
      areaServed: [
        { "@type": "Country", name: "Georgia" },
        { "@type": "City", name: "Tbilisi" },
      ],
    },
    faqPageSchema([{ heading: input.faqHeading, items: [...input.faq] }]),
    buildBreadcrumbList([{ name: "მთავარი", url: SITE_URL }, { name: input.name }]),
  ];
}
