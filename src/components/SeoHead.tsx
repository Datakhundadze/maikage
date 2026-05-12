import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

// Brand constants. Hard-coded so SeoHead doesn't have to pull from a hook
// just to set <meta> defaults — these change rarely.
export const SITE_URL = "https://maika.ge";
const DEFAULT_TITLE =
  "Maika.ge — საქართველოს ცნობილი მაისურების ბრენდი 15 წლის გამოცდილებით";
const DEFAULT_DESCRIPTION =
  "Maika.ge — საქართველოს ცნობილი ბრენდი 15 წლის გამოცდილებით კერვაში, ბეჭდვაში და კასტომ აპარელის წარმოებაში.";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;


// Site-wide Organization schema. Emitted on every page so any URL Google
// crawls anchors the brand entity, surfaces the logo in the knowledge panel,
// and ties social profiles to the same entity.
const ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": ["Organization", "ClothingStore"],
  name: "Maika.ge",
  alternateName: "Maika",
  url: SITE_URL,
  logo: `${SITE_URL}/maika-logo.png`,
  image: `${SITE_URL}/maika-logo.png`,
  description:
    "Maika.ge — საქართველოს ცნობილი ბრენდი 15 წლის გამოცდილებით კერვაში, ბეჭდვაში და კასტომ აპარელის წარმოებაში.",
  email: "maika@maika.ge",
  telephone: "+995599050807",
  foundingDate: "2011",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Tbilisi",
    addressCountry: "GE",
  },
  sameAs: [
    "https://www.facebook.com/maika.ge",
    "https://www.instagram.com/maika.ge_/",
    "https://www.tiktok.com/@maika.ge",
  ],
};

export interface SeoHeadProps {
  title?: string;
  description?: string;
  image?: string;
  /** Override the canonical/og:url. Defaults to the current pathname under SITE_URL. */
  url?: string;
  type?: "website" | "product" | "article";
  /** Set true on pages we don't want indexed (cart, my-designs, admin). */
  noindex?: boolean;
  /** Extra JSON-LD blobs to emit alongside the defaults. */
  schemas?: object[];
}

export default function SeoHead({
  title,
  description,
  image,
  url,
  type = "website",
  noindex = false,
  schemas,
}: SeoHeadProps) {
  const location = useLocation();
  const resolvedTitle = title ?? DEFAULT_TITLE;
  const resolvedDescription = description ?? DEFAULT_DESCRIPTION;
  const resolvedImage = image ?? DEFAULT_OG_IMAGE;
  // Canonical / og:url: strip query + hash so filtered catalog views all
  // consolidate ranking signals onto the base list page.
  const resolvedUrl = url ?? `${SITE_URL}${location.pathname}`;

  return (
    <Helmet>
      <title>{resolvedTitle}</title>
      <meta name="description" content={resolvedDescription} />
      <link rel="canonical" href={resolvedUrl} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph */}
      <meta property="og:site_name" content="Maika.ge" />
      <meta property="og:type" content={type} />
      <meta property="og:locale" content="ka_GE" />
      <meta property="og:locale:alternate" content="en_US" />
      <meta property="og:title" content={resolvedTitle} />
      <meta property="og:description" content={resolvedDescription} />
      <meta property="og:url" content={resolvedUrl} />
      <meta property="og:image" content={resolvedImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={resolvedTitle} />
      <meta name="twitter:description" content={resolvedDescription} />
      <meta name="twitter:image" content={resolvedImage} />

      <script type="application/ld+json">
        {JSON.stringify(ORGANIZATION_SCHEMA)}
      </script>

      {schemas?.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}
