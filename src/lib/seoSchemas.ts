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

// Standard shipping rate (kept in sync with OrderDialog's
// courier_tbilisi delivery — the only fee customers see at checkout).
const SHIPPING_RATE_GEL = "8.00";

// Build the Product JSON-LD blob for a catalog design detail page. Driven
// by the design row from the catalog_designs table plus the calculated
// price for whichever default product the design renders on.
//
// Shipping / return values are constants here rather than per-design
// columns: the business uses a single courier rate (8 ₾ inside Tbilisi)
// and custom-printed garments are not returnable, so emitting them
// uniformly is honest and avoids per-row churn.
export function buildProductSchema(input: {
  /** Localized title from the DB (catalog_designs.title_ka). */
  name: string;
  /** Long description shown to crawlers. Pass null/undefined to fall back. */
  description: string | null | undefined;
  /** Full https://maika.ge/design/{slug} URL. */
  url: string;
  /** Used for both sku and mpn — design slug is stable per design. */
  slug: string;
  /** Full image URL for og + Product.image (thumbnail / print file). */
  image: string;
  /** Resolved category label (Georgian) or null when uncategorized. */
  category?: string | null;
  /** Final customer price for this design in GEL (numeric). */
  priceGEL: number;
  /** Optional design tags joined into Product.keywords for SEO. */
  tags?: string[] | null;
}) {
  const fallbackDescription = `${input.name} მაისური — maika.ge-ის ექსკლუზიური დიზაინი`;
  const description =
    input.description && input.description.trim().length > 0
      ? input.description.trim()
      : fallbackDescription;

  // Recomputed each render — Google's freshness is per-crawl so a
  // page-load-time computation gives a rolling +1y horizon without any
  // build-time stale state.
  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description,
    image: input.image,
    url: input.url,
    sku: input.slug,
    mpn: input.slug,
    // Brand is maika.ge because customers experience this as a maika.ge
    // product — a custom design on a curated catalog garment — not as a
    // generic blank shirt. The blank-garment manufacturer (e.g. GILDAN)
    // is a supply detail the buyer isn't shopping for.
    brand: { "@type": "Brand", name: "maika.ge" },
    offers: {
      "@type": "Offer",
      url: input.url,
      priceCurrency: "GEL",
      price: input.priceGEL.toFixed(2),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      priceValidUntil: oneYearFromNow,
      seller: { "@type": "Organization", name: "maika.ge" },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: SHIPPING_RATE_GEL,
          currency: "GEL",
        },
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "GE",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: 0,
            maxValue: 1,
            unitCode: "DAY",
          },
          transitTime: {
            "@type": "QuantitativeValue",
            minValue: 1,
            maxValue: 3,
            unitCode: "DAY",
          },
        },
      },
    },
    // Custom-printed garments aren't returnable — this is the honest
    // legal posture, surfaced to crawlers so Google can pass it through
    // to shopping snippets without inferring a default policy that
    // doesn't apply. Change if business policy changes.
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "GE",
      returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
      merchantReturnLink: `${SITE_URL}/terms`,
    },
  };

  if (input.category) {
    product.category = input.category;
  }
  if (input.tags && input.tags.length > 0) {
    product.keywords = input.tags.join(", ");
  }

  return product;
}
