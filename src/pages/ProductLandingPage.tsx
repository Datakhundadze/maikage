import { useRef } from "react";
import { Navigate, useLocation, useNavigationType, useParams } from "react-router-dom";
import SimplePage from "@/pages/SimplePage";
import NotFound from "@/pages/NotFound";
import { writeConstructorSeed } from "@/lib/constructorSeed";
import { productTypeKa } from "@/lib/i18n";
import { BRAND_SLUGS, defaultBrandFor, resolveBrandSlug, resolveProductSlug } from "@/lib/productSlugs";

// Product landing routes (/hoodie, /hoodie/premium-washed, …) — ENTRY POINTS
// for ad clicks. They render the ordinary constructor with a product (and
// optionally a brand) preselected, and change nothing else: the selection goes
// through the constructor's existing seed handoff, so SimplePage applies it
// with the same setProduct / setSubProduct a hand pick uses, and pricing, cart
// and ordering see exactly what they would after that hand pick.
//
// ORDER MATTERS. SimplePage consumes the seed in its own mount effect, and
// React runs a child's effects BEFORE its parent's — so the seed is written
// here during render, before SimplePage mounts, not in an effect.
//
// The seed always carries BOTH product and brand (the default brand when the
// URL names none), so a config stored earlier in this tab is overridden by the
// URL either way.
//
// Only on ARRIVAL, though: a visitor who lands, switches brand, opens the cart
// and presses Back (or reloads) comes back to this same URL, and their own
// choices since landing must survive that — so no seed then.

/**
 * Marker designRecovery.ts leaves in sessionStorage while a sign-in redirect
 * is returning to this tab with a design in progress (designRecovery.ts,
 * MARKER_KEY). Duplicated, read-only, for the same reason constructorSeed.ts
 * duplicates the product-config key: no import of that module's internals.
 * While it is present the tab is coming BACK, not landing — the visitor's own
 * product choice must win over the URL, so no seed is written.
 */
const DESIGN_RECOVERY_MARKER_KEY = "maika-design-recovery";

function returningFromSignIn(): boolean {
  try {
    return sessionStorage.getItem(DESIGN_RECOVERY_MARKER_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Whether this render is the visitor ARRIVING at the landing URL, as opposed
 * to coming back to it.
 *
 * PUSH / REPLACE: an in-app navigation to it, or the redirect below from a
 * non-canonical spelling — an arrival.
 * POP: either the document's own first render (the ad click or typed URL
 * itself — an arrival only if the browser loaded this document fresh, not by
 * reload or Back/Forward) or Back/Forward within the tab to an entry left
 * earlier (not an arrival). The document's first render is told apart by its
 * navigation entry's URL, and only counts once per document.
 */
let initialEntryHandled = false;

function isArrival(navigationType: string, pathname: string): boolean {
  if (navigationType !== "POP") return true;
  if (initialEntryHandled) return false;
  try {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!nav) return true;
    return nav.type === "navigate" && new URL(nav.name).pathname === pathname;
  } catch {
    return true;
  }
}

// SEO — one fixed template. Phrases are copied from existing strings:
//   "შექმენი დიზაინი"                                         LandingPage.tsx:159
//   "ატვირთე ფოტო, დაწერე ტექსტი, ან აღწერე და AI შეგიქმნის."   LandingPage.tsx:164
//   "შეუკვეთე ონლაინ Maika.ge-ზე."                             designMetaDescription.ts:41,43
// plus the product's Georgian label (i18n.ts products) and the brand string
// exactly as the brand picker shows it (catalog.ts SUB_PRODUCTS).
function seoFor(productKa: string, brand: string | null) {
  const name = brand ? `${productKa} · ${brand}` : productKa;
  return {
    title: `${name} — შექმენი დიზაინი | Maika.ge`,
    description: `${name}. ატვირთე ფოტო, დაწერე ტექსტი, ან აღწერე და AI შეგიქმნის. შეუკვეთე ონლაინ Maika.ge-ზე.`,
  };
}

function brandSlugOf(product: Parameters<typeof resolveBrandSlug>[0], brand: string): string | null {
  const map = BRAND_SLUGS[product] ?? {};
  return Object.keys(map).find((s) => map[s] === brand) ?? null;
}

export default function ProductLandingPage({ productSlug }: { productSlug: string }) {
  const { brandSlug } = useParams<{ brandSlug?: string }>();
  const { pathname, search, hash } = useLocation();
  const navigationType = useNavigationType();
  const seededRef = useRef(false);

  // Validate everything before anything is written.
  const product = resolveProductSlug(productSlug);
  const brand = product && brandSlug ? resolveBrandSlug(product, brandSlug.toLowerCase()) : null;
  const brandPart = product && brand ? brandSlugOf(product, brand) : null;
  const canonicalPath = `/${productSlug}${brandPart ? `/${brandPart}` : ""}`;
  const isCanonical = product !== null && pathname === canonicalPath;

  // Decide once per mount, and only on the canonical URL: a non-canonical URL
  // redirects below without mounting SimplePage, and the clean path it lands
  // on decides then.
  if (product && isCanonical && !seededRef.current) {
    seededRef.current = true;
    const arrival = isArrival(navigationType, pathname);
    initialEntryHandled = true;
    if (arrival && !returningFromSignIn()) {
      writeConstructorSeed({ product, subProduct: brand ?? defaultBrandFor(product) });
    }
  }

  // A routed slug whose product catalog.ts has since removed or hidden is a
  // plain 404, as any unknown path is (the unit test flags it first).
  if (!product) return <NotFound />;

  // Unknown brand → the product's own URL (default brand); upper case or a
  // trailing slash → the clean URL. Ad query strings (utm_*, gclid) are kept.
  if (!isCanonical) return <Navigate to={`${canonicalPath}${search}${hash}`} replace />;

  const seo = seoFor(productTypeKa(product), brand);
  return <SimplePage seoTitle={seo.title} seoDescription={seo.description} />;
}
