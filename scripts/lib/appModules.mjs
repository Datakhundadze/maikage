// Loads app modules (src/**/*.ts) into the build scripts, so a script reads
// the SAME constants the React app renders instead of keeping a retyped copy:
// the landing slugs App.tsx registers, the FAQ text (and its FAQPage JSON-LD
// builder) FaqPage shows, the lead
// time LandingHero prints, the landing <title>s SeoHead sets, the /corporate
// title and text section.
//
// How: a bare Vite dev server in middleware mode (no config file, no plugins,
// no dependency scan, no file watcher) and ssrLoadModule — esbuild strips the
// TypeScript and the "@/…" alias resolves as in vite.config.ts. About half a
// second. Only plain-data / pure modules are loaded; nothing here touches
// React, the DOM or Supabase (faqContent.ts imports pricing.ts and fees.ts,
// both pure data).
//
// Never throws: on any failure it returns null and logs one warning, and the
// caller skips what needed these values (same never-fail rule as the scripts).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MODULES = {
  slugs: "/src/lib/productSlugs.ts",
  i18n: "/src/lib/i18n.ts",
  heroTitle: "/src/lib/heroTitle.ts",
  leadTime: "/src/lib/leadTime.ts",
  landingSeo: "/src/lib/landingSeo.ts",
  faq: "/src/lib/faqContent.ts",
  showroom: "/src/lib/showroomSeo.ts",
  landingCopy: "/src/lib/landingCopy.ts",
  corporateCopy: "/src/lib/corporateCopy.ts",
  imageTransform: "/src/lib/imageTransform.ts",
};

/**
 * @param {string} log  prefix for the warning line, e.g. "[prerender]"
 * @returns {Promise<null | {
 *   PRODUCT_SLUGS: Record<string, string>,
 *   LANDING_PRODUCT_SLUGS: readonly string[],
 *   BRAND_SLUGS: Record<string, Record<string, string>>,
 *   resolveProductSlug: (slug: string) => string | null,
 *   resolveBrandSlug: (product: string, slug: string) => string | null,
 *   productTypeKa: (typeEn: string) => string,
 *   heroTitle: (productKa: string, brand: string | null) => string,
 *   LEAD_TIME_KA: string,
 *   landingSeo: (product: string, productKa: string, brand: string | null) => { title: string, description: string },
 *   LANDING_TAIL_KA: string,
 *   FAQ_PAGE: { title: string, description: string, h1: string, intro: string, backLabel: string },
 *   FAQ_GROUPS: { heading: string, items: { q: string, a: string }[] }[],
 *   faqPageSchema: (groups: { heading: string, items: { q: string, a: string }[] }[]) => object,
 *   SHOWROOM_INDEXABLE: boolean,
 *   landingCopyFor: (productSlug: string, brandSlug: string | null) => null | {
 *     h2: string, intro: string,
 *     sections: { h3: string, body: string, priceLead?: Function, link?: { href: string, label: string } }[],
 *   },
 *   CORPORATE_SEO: { title: string, description: string },
 *   CORPORATE_COPY: {
 *     h2: string, intro: string,
 *     sections: { h3: string, body?: string, bullets?: { term: string, text: string }[], link?: { href: string, label: string } }[],
 *   },
 *   transformedDisplayUrl: (url: string, opts: { width: number, quality?: number }) => string,
 * }>}
 */
export async function loadAppModules(log) {
  let server;
  try {
    const { createServer } = await import("vite");
    server = await createServer({
      configFile: false,
      root: ROOT,
      logLevel: "error",
      resolve: { alias: { "@": resolve(ROOT, "src") } },
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const m = {};
    for (const [key, path] of Object.entries(MODULES)) m[key] = await server.ssrLoadModule(path);
    return {
      PRODUCT_SLUGS: m.slugs.PRODUCT_SLUGS,
      LANDING_PRODUCT_SLUGS: m.slugs.LANDING_PRODUCT_SLUGS,
      BRAND_SLUGS: m.slugs.BRAND_SLUGS,
      resolveProductSlug: m.slugs.resolveProductSlug,
      resolveBrandSlug: m.slugs.resolveBrandSlug,
      productTypeKa: m.i18n.productTypeKa,
      heroTitle: m.heroTitle.heroTitle,
      LEAD_TIME_KA: m.leadTime.LEAD_TIME_KA,
      landingSeo: m.landingSeo.landingSeo,
      LANDING_TAIL_KA: m.landingSeo.LANDING_TAIL_KA,
      FAQ_PAGE: m.faq.FAQ_PAGE,
      FAQ_GROUPS: m.faq.FAQ_GROUPS,
      faqPageSchema: m.faq.faqPageSchema,
      SHOWROOM_INDEXABLE: m.showroom.SHOWROOM_INDEXABLE,
      landingCopyFor: m.landingCopy.landingCopyFor,
      CORPORATE_SEO: m.corporateCopy.CORPORATE_SEO,
      CORPORATE_COPY: m.corporateCopy.CORPORATE_COPY,
      transformedDisplayUrl: m.imageTransform.transformedDisplayUrl,
    };
  } catch (e) {
    console.warn(`${log} WARNING: could not load app modules from src/: ${e?.message ?? e}`);
    return null;
  } finally {
    try {
      await server?.close();
    } catch {
      /* already closed */
    }
  }
}
