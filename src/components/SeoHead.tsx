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
const TWITTER_HANDLE = "@maika_ge";

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
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={resolvedTitle} />
      <meta name="twitter:description" content={resolvedDescription} />
      <meta name="twitter:image" content={resolvedImage} />

      {schemas?.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
        >
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}
