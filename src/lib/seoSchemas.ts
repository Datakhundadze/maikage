// Shared JSON-LD schema builders used by SeoHead consumers (LocalBusiness,
// BreadcrumbList, etc.). Organization schema lives inside SeoHead because
// it's emitted on every page; the schemas here are page-specific.

export const SITE_URL = "https://maika.ge";

// LocalBusiness / ClothingStore — emitted on the homepage and contact page
// so Google can show the business in local search results (hours, phone,
// map). Geo coords match the Google Maps Place ID:
// https://www.google.com/maps/place/Maika.ge/@41.7231446,44.7910174,17z
export const LOCAL_BUSINESS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "ClothingStore",
  name: "Maika.ge",
  image: `${SITE_URL}/maika-logo.png`,
  url: SITE_URL,
  telephone: "+995599050807",
  email: "maika@maika.ge",
  priceRange: "₾20-₾200",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Tbilisi",
    addressCountry: "GE",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: 41.7231446,
    longitude: 44.7910174,
  },
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "11:00",
      closes: "19:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Saturday",
      opens: "11:00",
      closes: "18:00",
    },
  ],
  sameAs: [
    "https://www.facebook.com/maika.ge",
    "https://www.instagram.com/maika.ge_/",
    "https://www.tiktok.com/@maika.ge",
  ],
  hasMap:
    "https://www.google.com/maps/place/Maika.ge/@41.7231446,44.7910174,17z",
};

// Breadcrumb builder used on catalog detail pages. The final item omits the
// `item` URL per Google's guidance ("the current page is implicit").
export function buildBreadcrumbList(items: Array<{ name: string; url?: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => {
      const node: Record<string, unknown> = {
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
      };
      if (it.url) node.item = it.url;
      return node;
    }),
  };
}
