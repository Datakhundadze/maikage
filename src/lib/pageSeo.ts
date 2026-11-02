// <title> / meta description of pages whose static HTML and Helmet tags must
// agree but which had no module of their own:
//
//   HOME_SEO     "/" — LandingPage's SeoHead AND index.html's <title> /
//                description (index.html is static: src/test/seoStatic.test.ts
//                fails when it no longer carries these exact strings).
//   CATALOG_SEO  /designs — CatalogPage's SeoHead and the prerendered
//                dist/designs/index.html (scripts/prerender.mjs loads this
//                module through scripts/lib/appModules.mjs).
//
// No prices. The lead time comes from LEAD_TIME_KA.
import { LEAD_TIME_KA } from "@/lib/leadTime";

export const HOME_SEO = {
  // Brand + broad: the exact phrase "მაისურებზე ბეჭდვა" belongs to
  // /maisurebze-bechdva alone (no cannibalisation). ≤60 characters.
  title: "Maika.ge — ტანსაცმელზე ბეჭდვა თბილისში: მაისურები, ჰუდები",
  description: `Maika.ge — საქართველოს ცნობილი მაისურების ბრენდი. მაისურების ბეჭდვა შენი ფოტოთი, ლოგოთი ან AI დიზაინით, ${LEAD_TIME_KA}ში. შოურუმი დინამო არენაზე.`,
} as const;

export const CATALOG_SEO = {
  title: "მაისურები ქართული წარწერით და დიზაინით | maika.ge",
  description:
    "ქართული მაისურები — ასობით მზა დიზაინი: ქართული წარწერები, პატრიოტული, იუმორი, მუსიკა, კინო. აირჩიე დიზაინი და დაბეჭდე მაისურზე ან ჰუდზე.",
} as const;
