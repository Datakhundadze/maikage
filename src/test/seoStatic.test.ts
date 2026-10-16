import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_SLUGS, LANDING_PRODUCT_SLUGS, PRODUCT_SLUGS, resolveBrandSlug, resolveProductSlug } from "@/lib/productSlugs";
import { productTypeKa, translations } from "@/lib/i18n";
import { FAQ_GROUPS, FAQ_PAGE } from "@/lib/faqContent";
import { LANDING_TAIL_KA, landingSeo } from "@/lib/landingSeo";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import {
  CONTACT,
  CORPORATE,
  LANDING_HERO,
  LANDING_LABELS,
  LIST_PAGES,
  PORTFOLIO,
  SHOWROOM,
  buildLlmsTxt,
  containsPrice,
  faqPageSchema,
  jsonLdText,
  landingRoutes,
  landingSitemapEntries,
  mergeSitemapEntries,
  priceFreeFaq,
  sitemapLocs,
} from "../../scripts/lib/seo.mjs";

// The build scripts' static pages, sitemap additions and llms.txt
// (scripts/lib/seo.mjs, scripts/prerender.mjs, scripts/generate-sitemap.mjs).

const ROOT = path.resolve(__dirname, "../..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const app = { LANDING_PRODUCT_SLUGS, BRAND_SLUGS, resolveProductSlug, resolveBrandSlug };

describe("copied page text still matches its source", () => {
  // A static page may show only text its live page shows too. These strings
  // are copied from components (they have no module of their own); if a
  // component's wording changes, update scripts/lib/seo.mjs to match.
  const cases: [string, string[]][] = [
    ["src/pages/CorporatePage.tsx", [CORPORATE.backLabel, CORPORATE.h1, CORPORATE.intro, ...CORPORATE.features, CORPORATE.cta]],
    ["src/pages/PortfolioPage.tsx", [PORTFOLIO.title, PORTFOLIO.description, PORTFOLIO.backLabel, PORTFOLIO.h1, PORTFOLIO.intro, PORTFOLIO.allLabel, PORTFOLIO.altFallback, PORTFOLIO.catalogCta]],
    ["src/pages/ShowroomPage.tsx", [SHOWROOM.title, SHOWROOM.description, SHOWROOM.h1]],
    ["src/components/landing/LandingHero.tsx", [LANDING_HERO.h1Suffix.trim(), LANDING_HERO.leadTimePrefix, LANDING_HERO.uploadCta, LANDING_HERO.chatCta, `to="${LANDING_HERO.chatHref}"`]],
    ["src/components/catalog/CatalogGrid.tsx", [LIST_PAGES.catalog.h1, LIST_PAGES.catalog.intro]],
    ["src/pages/BlogPage.tsx", [LIST_PAGES.blog.h1, LIST_PAGES.blog.intro]],
    ["src/pages/ContactPage.tsx", [CONTACT.h1, CONTACT.addressLabel, CONTACT.address, CONTACT.hoursLabel, ...CONTACT.hours, CONTACT.phoneLabel, ...CONTACT.phones.map((p) => p.display), CONTACT.emailLabel, CONTACT.email, CONTACT.mapLabel, CONTACT.mapLinkText, CONTACT.mapUrl, CONTACT.homeLinkText]],
  ];
  for (const [file, strings] of cases) {
    it(file, () => {
      // Raw source plus the same with JSX tags removed, so text split across
      // inline elements ("ორშ–პარ <span>11:00–19:00</span>") still matches.
      const raw = source(file);
      const src = `${raw}\n${raw.replace(/<[^>]+>/g, "")}`;
      for (const s of strings) expect(src, `${file} no longer contains ${JSON.stringify(s)}`).toContain(s);
    });
  }

  it("/corporate title and description: one source (lib/corporateCopy.ts) for the page and the prerender", () => {
    const page = source("src/pages/CorporatePage.tsx");
    expect(page).toContain('import { CORPORATE_COPY, CORPORATE_SEO } from "@/lib/corporateCopy"');
    expect(page).toContain("title={CORPORATE_SEO.title}");
    expect(page).toContain("description={CORPORATE_SEO.description}");
    expect(page).not.toContain("კორპორაციული შეკვეთები — Maika.ge");
    expect(CORPORATE).not.toHaveProperty("title");
    expect(CORPORATE).not.toHaveProperty("description");
    const prerender = source("scripts/prerender.mjs");
    expect(prerender).toContain("corporatePage(app, { esc, link, style: STYLE })");
    expect(source("scripts/lib/appModules.mjs")).toContain('corporateCopy: "/src/lib/corporateCopy.ts"');
  });

  it("the brand-list heading is the constructor's brand label", () => {
    expect(translations.ge.config.brand).toBe(LANDING_LABELS.brand);
  });

  it("the about line is SeoHead's Organization description", () => {
    expect(source("src/components/SeoHead.tsx")).toContain(CONTACT.about);
  });
});

describe("landing routes come from the slugs App.tsx registers", () => {
  const routes = landingRoutes(app);

  it("App.tsx builds its landing routes from LANDING_PRODUCT_SLUGS", () => {
    const appSrc = source("src/App.tsx");
    expect(appSrc).toContain("LANDING_PRODUCT_SLUGS.map((slug) =>");
    expect(appSrc).toContain('path={`/${slug}`}');
    expect(appSrc).toContain('path={`/${slug}/:brandSlug`}');
  });

  it("every product route and every known brand route, once each, in order", () => {
    const expected = LANDING_PRODUCT_SLUGS.flatMap((s) => [
      `/${s}`,
      ...Object.keys(BRAND_SLUGS[PRODUCT_SLUGS[s]] ?? {}).map((b) => `/${s}/${b}`),
    ]);
    expect(routes.map((r) => r.path)).toEqual(expected);
    expect(routes.find((r) => r.path === "/hoodie/premium-washed")).toMatchObject({
      product: "Hoodie",
      productSlug: "hoodie",
      brandSlug: "premium-washed",
      brand: "Premium Washed Hoodie",
    });
  });

  it("a slug the page would 404 / redirect is left out", () => {
    const narrowed = landingRoutes({
      ...app,
      resolveProductSlug: (s: string) => (s === "mug" ? null : resolveProductSlug(s)),
      resolveBrandSlug: (p: Parameters<typeof resolveBrandSlug>[0], b: string) => (b === "gildan" ? null : resolveBrandSlug(p, b)),
    });
    const paths = narrowed.map((r) => r.path);
    expect(paths).not.toContain("/mug");
    expect(paths).not.toContain("/t-shirt/gildan");
    expect(paths).toContain("/t-shirt/sols");
  });

  it("titles: Georgian, no price, the same function the page uses", () => {
    expect(landingSeo("T-Shirt", productTypeKa("T-Shirt"), null).title).toBe(
      "მაისურები ბეჭდვით — შენი დიზაინით, თბილისი | maika.ge",
    );
    for (const r of routes) {
      const seo = landingSeo(r.product, productTypeKa(r.product), r.brand);
      expect(containsPrice(seo.title) || containsPrice(seo.description), r.path).toBe(false);
      expect(seo.description).toContain(LEAD_TIME_KA);
    }
  });
});

describe("sitemap merge", () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://maika.ge/</loc>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://maika.ge/t-shirt</loc>
    <priority>0.5</priority>
  </url>
</urlset>`;

  it("appends only the missing locs, once each, and keeps existing entries untouched", () => {
    const entries = [
      { loc: "https://maika.ge/t-shirt", priority: "0.8", changefreq: "monthly" },
      { loc: "https://maika.ge/hoodie", priority: "0.8", changefreq: "monthly" },
      { loc: "https://maika.ge/hoodie", priority: "0.8", changefreq: "monthly" },
    ];
    const { xml, added } = mergeSitemapEntries(XML, entries);
    expect(added).toEqual(["https://maika.ge/hoodie"]);
    expect(sitemapLocs(xml)).toEqual(["https://maika.ge/", "https://maika.ge/t-shirt", "https://maika.ge/hoodie"]);
    expect(xml.startsWith(XML.slice(0, XML.lastIndexOf("</urlset>")))).toBe(true);
    expect(xml).toContain("<loc>https://maika.ge/t-shirt</loc>\n    <priority>0.5</priority>");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("is a no-op when nothing is missing or there is no </urlset>", () => {
    expect(mergeSitemapEntries(XML, [{ loc: "https://maika.ge/", priority: "1", changefreq: "daily" }]).xml).toBe(XML);
    expect(mergeSitemapEntries("<urlset>", [{ loc: "https://maika.ge/x", priority: "1", changefreq: "daily" }])).toEqual({
      xml: "<urlset>",
      added: [],
    });
  });

  it("the committed sitemap gains every landing route (products 0.8, brands 0.7)", () => {
    const entries = landingSitemapEntries(landingRoutes(app));
    const { xml } = mergeSitemapEntries(source("public/sitemap.xml"), entries);
    const locs = sitemapLocs(xml);
    for (const e of entries) expect(locs).toContain(e.loc);
    expect(new Set(locs).size).toBe(locs.length);
    expect(entries.find((e) => e.loc === "https://maika.ge/t-shirt")?.priority).toBe("0.8");
    expect(entries.find((e) => e.loc === "https://maika.ge/t-shirt/gildan")?.priority).toBe("0.7");
  });
});

describe("FAQ — static page and its JSON-LD carry no prices", () => {
  const { groups, dropped } = priceFreeFaq(FAQ_GROUPS);

  it("containsPrice", () => {
    expect(containsPrice("GILDAN 35₾")).toBe(true);
    expect(containsPrice("20 ლარი")).toBe(true);
    expect(containsPrice("10 ცალიდან ზემოთ ვრცელდება ფასდაკლება")).toBe(false);
    expect(containsPrice("ორშ–პარ 11:00–19:00")).toBe(false);
  });

  it("drops every priced Q&A, keeps the rest verbatim and in order", () => {
    const all = FAQ_GROUPS.flatMap((g) => g.items);
    const kept = groups.flatMap((g) => g.items);
    expect(dropped.length).toBeGreaterThan(0);
    expect(kept.length + dropped.length).toBe(all.length);
    for (const item of kept) {
      expect(all).toContain(item); // same object — text untouched
      expect(containsPrice(item.q) || containsPrice(item.a)).toBe(false);
    }
    expect(kept).toEqual(all.filter((i) => !dropped.includes(i.q)));
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
  });

  it("the FAQPage schema lists exactly the kept Q&As", () => {
    const schema = faqPageSchema(groups);
    expect(schema["@type"]).toBe("FAQPage");
    expect(schema.mainEntity.map((q: { name: string }) => q.name)).toEqual(groups.flatMap((g) => g.items.map((i) => i.q)));
    expect(JSON.stringify(schema)).not.toContain("₾");
  });

  it("jsonLdText cannot close its <script>", () => {
    expect(jsonLdText({ a: "</script><b>&" })).toBe('{"a":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026"}');
    expect(JSON.parse(jsonLdText({ a: "</script>" }))).toEqual({ a: "</script>" });
  });
});

describe("public/llms.txt", () => {
  const expected = buildLlmsTxt({
    routes: landingRoutes(app),
    productKa: productTypeKa,
    landingSeo,
    servicesKa: LANDING_TAIL_KA,
    faqPage: FAQ_PAGE,
  });

  it("matches its builder (run `node scripts/generate-llms-txt.mjs` after changing a source)", () => {
    expect(source("public/llms.txt")).toBe(expected);
  });

  it("has the contacts and key URLs, and no prices", () => {
    for (const s of [CONTACT.address, CONTACT.email, ...CONTACT.hours, ...CONTACT.phones.map((p) => p.display)]) {
      expect(expected).toContain(s);
    }
    for (const url of ["https://maika.ge/t-shirt", "https://maika.ge/contact", "https://maika.ge/faq", "https://maika.ge/corporate"]) {
      expect(expected).toContain(`(${url})`);
    }
    expect(containsPrice(expected)).toBe(false);
  });
});
