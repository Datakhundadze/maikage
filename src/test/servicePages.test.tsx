import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import ServicePage from "@/pages/ServicePage";
import {
  PRINTING_PAGE,
  SERVICE_CONTACT,
  SERVICE_PAGE_LIST,
  SERVICE_PAGES,
  SPORT_KITS_PAGE,
  serviceSchemas,
  type ServicePageCopy,
} from "@/lib/serviceCopy";
import {
  ALL_SERVICE_LINKS,
  MORE_SERVICE_LINKS,
  PRINT_SERVICES_MAX,
  SERVICE_LINKS,
  SERVICE_PAGE_LINKS,
  SERVICE_PAGE_NAMES,
  SERVICE_PAGE_SLUGS,
  printServiceLinksFor,
} from "@/lib/serviceRouteSlugs";
import { CORPORATE_COPY } from "@/lib/corporateCopy";
import { CATALOG_SEO, HOME_SEO } from "@/lib/pageSeo";
import { DESIGN_TITLE_MAX, designFallbackDescription, designSeoTitle, isPlaceholderDesignName } from "@/lib/designSeo";
import { buildDesignMetaDescription } from "@/lib/designMetaDescription";
import { LANDING_SEO_OVERRIDES_KA, landingSeo } from "@/lib/landingSeo";
import { FAQ_DELIVERY_PRICES, FAQ_PAGE } from "@/lib/faqContent";
import { fromPrice } from "@/lib/landingPrice";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import { productTypeKa } from "@/lib/i18n";
import { BRAND_SLUGS, LANDING_PRODUCT_SLUGS, resolveBrandSlug, resolveProductSlug } from "@/lib/productSlugs";
import {
  CONTACT,
  PORTFOLIO,
  landingRoutes,
  containsPrice,
  corporatePage,
  mergeSitemapEntries,
  printServicesHtml,
  serviceSitemapEntries,
  servicePageHtml,
  sitemapLocs,
} from "../../scripts/lib/seo.mjs";

// Service pages (lib/serviceCopy.ts → pages/ServicePage.tsx and the static
// prerender via scripts/lib/seo.mjs servicePageHtml) and the rewritten
// titles of /, /designs, /design/:slug, /t-shirt, /hoodie, /portfolio, /faq.

const ROOT = path.resolve(__dirname, "../..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const style = { main: "", nav: "", h1: "", h2: "", h3: "", p: "", ul: "", li: "", footer: "" };
const unesc = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[n as string]!);

/** Every visible string of a page: intro, sections, FAQ, CTA, link labels (not hrefs). */
function pageTexts(p: ServicePageCopy): string[] {
  return [
    p.seo.title,
    p.seo.description,
    p.name,
    p.h1,
    p.intro,
    ...p.heroLinks.map((l) => l.label),
    ...p.sections.flatMap((s) => [
      s.h2,
      s.body ?? "",
      s.note ?? "",
      ...(s.bullets ?? []).flatMap((b) => [b.term, b.text]),
      ...(s.steps ?? []),
      ...(s.links ?? []).map((l) => l.label),
    ]),
    p.faqHeading,
    ...p.faq.flatMap((f) => [f.q, f.a]),
    p.cta.h2,
    p.cta.body,
    ...p.cta.links.map((l) => l.label),
  ].filter(Boolean);
}

const COPY_FILES = ["src/lib/serviceCopy.ts", "src/lib/serviceRouteSlugs.ts", "src/lib/pageSeo.ts", "src/lib/designSeo.ts"];

// Latin words the copy may contain: technical terms, file formats, the
// brand's own domain and the partner/social names. Anything else Latin in a
// Georgian text is most likely transliterated Georgian.
const LATIN_ALLOWED = new Set([
  "DTF", "FLEX", "AI", "A3", "A4", "PNG", "maika", "Maika", "ge", "Nike", "oversize", "WhatsApp", "Facebook",
  // phone-case models (owner's list for /korporatiuli-sachukrebi)
  "iPhone", "Xiaomi", "Samsung",
]);
const FORBIDDEN_BRANDS = /adidas|under\s*armou?r|chanel|armani/i;

const app = { LANDING_PRODUCT_SLUGS, BRAND_SLUGS, resolveProductSlug, resolveBrandSlug };
const KNOWN_PATHS = new Set([
  "/",
  "/corporate",
  "/faq",
  "/contact",
  "/portfolio",
  "/designs",
  ...landingRoutes(app).map((r) => r.path),
  ...SERVICE_PAGE_LIST.map((p) => p.path),
  // Design pages that exist (listed in the committed sitemap).
  ...sitemapLocs(source("public/sitemap.xml"))
    .filter((l) => l.startsWith("https://maika.ge/design/"))
    .map((l) => l.slice("https://maika.ge".length)),
]);

describe("service pages — data", () => {
  it("SERVICE_PAGE_SLUGS, SERVICE_PAGES and the names agree", () => {
    expect(Object.keys(SERVICE_PAGES)).toEqual([...SERVICE_PAGE_SLUGS]);
    expect(SERVICE_PAGE_LIST.map((p) => p.slug)).toEqual([...SERVICE_PAGE_SLUGS]);
    for (const p of SERVICE_PAGE_LIST) {
      expect(p.path).toBe(`/${p.slug}`);
      expect(p.name).toBe(SERVICE_PAGE_NAMES[p.slug]);
    }
    expect(SERVICE_PAGE_LINKS.map((l) => l.href)).toEqual(SERVICE_PAGE_LIST.map((p) => p.path));
    // The four service links, exact-match anchors (home, header, /faq, design + landing pages).
    expect(SERVICE_LINKS.map((l) => [l.href, l.label])).toEqual([
      ["/maisurebze-bechdva", "მაისურებზე ბეჭდვა"],
      ["/hoodie", "ჰუდებზე ბეჭდვა"],
      ["/corporate", "მაისურების ბრენდირება კომპანიის ლოგოთი"],
      ["/sportuli-formebi", "სპორტული ფორმები გვარით და ნომრით"],
    ]);
    // The phase-2 pages: one link each, the page's name as exact-match anchor.
    expect(MORE_SERVICE_LINKS.map((l) => l.href)).toEqual(SERVICE_PAGE_LIST.slice(2).map((p) => p.path));
    for (const l of MORE_SERVICE_LINKS) expect(l.label).toBe(SERVICE_PAGE_NAMES[l.href.slice(1) as keyof typeof SERVICE_PAGE_NAMES]);
    expect(ALL_SERVICE_LINKS).toEqual([...SERVICE_LINKS, ...MORE_SERVICE_LINKS]);
    expect(new Set(ALL_SERVICE_LINKS.map((l) => l.href)).size).toBe(ALL_SERVICE_LINKS.length);
    for (const l of ALL_SERVICE_LINKS) {
      expect(l.description.length).toBeGreaterThan(20);
      expect(l.description).not.toContain("₾");
    }
  });

  it("App.tsx registers every slug, lazily, before the 404 route", () => {
    const appSrc = source("src/App.tsx");
    expect(appSrc).toContain('import { SERVICE_PAGE_SLUGS } from "@/lib/serviceRouteSlugs"');
    expect(appSrc).toContain('const ServicePage = lazyWithRetry(() => import("./pages/ServicePage"));');
    expect(appSrc).toContain("<Route key={slug} path={`/${slug}`} element={<ServicePage slug={slug} />} />");
    expect(appSrc.indexOf("SERVICE_PAGE_SLUGS.map")).toBeLessThan(appSrc.indexOf('<Route path="*"'));
  });

  it("slugs: Latin, no clash with a product landing route", () => {
    const landing = new Set(LANDING_PRODUCT_SLUGS);
    for (const slug of SERVICE_PAGE_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(landing.has(slug)).toBe(false);
    }
  });

  it("H1s and title / description lengths", () => {
    expect(PRINTING_PAGE.h1).toBe("მაისურებზე ბეჭდვა თბილისში");
    expect(SPORT_KITS_PAGE.h1).toBe("სპორტული ფორმები გვარით და ნომრით");
    for (const p of SERVICE_PAGE_LIST) {
      expect(p.seo.title.length, p.seo.title).toBeLessThanOrEqual(60);
      expect(p.seo.description.length, p.seo.description).toBeLessThanOrEqual(155);
      expect(p.seo.title.endsWith(" | maika.ge")).toBe(true);
    }
    // keyword first
    expect(PRINTING_PAGE.seo.title.startsWith("მაისურებზე ბეჭდვა")).toBe(true);
    expect(SPORT_KITS_PAGE.seo.title.startsWith("სპორტული ფორმები")).toBe(true);
    // The title's day range is LEAD_TIME_KA's.
    expect(PRINTING_PAGE.seo.title).toContain(LEAD_TIME_KA.split(" ")[0]);
  });

  it("FAQ sizes: 5–7 on printing, 5–6 on team kits", () => {
    expect(PRINTING_PAGE.faq.length).toBeGreaterThanOrEqual(5);
    expect(PRINTING_PAGE.faq.length).toBeLessThanOrEqual(7);
    expect(SPORT_KITS_PAGE.faq.length).toBeGreaterThanOrEqual(5);
    expect(SPORT_KITS_PAGE.faq.length).toBeLessThanOrEqual(6);
  });

  it("printing copy is 500–700 words", () => {
    const words = pageTexts(PRINTING_PAGE).slice(4).join(" ").split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(500);
    expect(words).toBeLessThanOrEqual(700);
  });

  it("every internal link is a route the app serves", () => {
    for (const p of SERVICE_PAGE_LIST) {
      const links = [...p.heroLinks, ...p.sections.flatMap((s) => s.links ?? []), ...p.cta.links];
      for (const l of links) {
        if (l.href.startsWith("/")) expect(KNOWN_PATHS.has(l.href), `${p.path} → ${l.href}`).toBe(true);
        else expect(l.href).toMatch(/^(tel:\+\d+|https:\/\/)/);
      }
    }
    for (const l of ALL_SERVICE_LINKS) expect(KNOWN_PATHS.has(l.href)).toBe(true);
  });

  it("contact links are the /contact page's", () => {
    expect(CONTACT.phones.map((p) => p.tel)).toContain(SERVICE_CONTACT.phone.tel);
    expect(CONTACT.phones.map((p) => p.display)).toContain(SERVICE_CONTACT.phone.display);
    expect(CONTACT.socials.map((s) => s.url)).toContain(SERVICE_CONTACT.whatsapp);
    expect(CONTACT.socials.map((s) => s.url)).toContain(SERVICE_CONTACT.facebook);
  });
});

describe("service pages — prices come from pricing.ts only", () => {
  it("no digit typed next to ₾ in the copy modules", () => {
    for (const f of COPY_FILES) {
      const src = source(f);
      expect(src, f).not.toMatch(/\d\s*₾|₾\s*\d/);
      expect(src, f).not.toMatch(/\d\s*(?:ლარ|GEL\b)/);
    }
  });

  it("the printing price list is fromPrice per product (the landing hero's number)", () => {
    const prices = PRINTING_PAGE.sections.find((s) => s.h2 === "ფასები")!.bullets!;
    const expected: [string, Parameters<typeof fromPrice>[0], boolean][] = [
      ["მაისური ბეჭდვით", "T-Shirt", true],
      ["ჰუდი ბეჭდვით", "Hoodie", true],
      ["ნაჭრის ჩანთა", "Tote Bag", false],
      ["კეპი", "Cap", false],
      ["წინსაფარი", "Apron", false],
      ["ჭიქა", "Mug", false],
      ["ტელეფონის ქეისი", "Phone Case", false],
    ];
    expect(prices).toEqual(
      expected.map(([term, product, from]) => ({ term, text: `${fromPrice(product, null)} ₾${from ? "-დან" : ""}` })),
    );
  });

  it("every ₾ amount on the printing page is a pricing.ts or courier number", () => {
    const allowed = new Set<number>([
      ...(["T-Shirt", "Hoodie", "Tote Bag", "Cap", "Apron", "Mug", "Phone Case"] as const).map((p) => fromPrice(p, null)),
      FAQ_DELIVERY_PRICES.courier_tbilisi,
      FAQ_DELIVERY_PRICES.courier_outside,
    ]);
    const text = pageTexts(PRINTING_PAGE).join("\n");
    const amounts = [...text.matchAll(/(\d+)\s*₾/g)].map((m) => Number(m[1]));
    expect(amounts.length).toBeGreaterThan(0);
    for (const a of amounts) expect(allowed.has(a), String(a)).toBe(true);
    expect(text).toContain(`მაისური ბეჭდვით ${fromPrice("T-Shirt", null)} ₾-დან`);
    expect(text).toContain(`თბილისში — ${FAQ_DELIVERY_PRICES.courier_tbilisi} ₾`);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
  });

  it("team kits carry no price at all — the owner's sentence instead", () => {
    const text = pageTexts(SPORT_KITS_PAGE).join("\n");
    expect(text).not.toContain("₾");
    expect(text).toContain("ფასი დამოკიდებულია დიზაინსა და რაოდენობაზე — მოგვწერეთ");
    expect(text).toContain("10–12 კომპლექტიდან");
  });
});

describe("service pages — language and brands", () => {
  const texts = [
    ...SERVICE_PAGE_LIST.flatMap(pageTexts),
    ...SERVICE_LINKS.flatMap((l) => [l.label, l.description]),
    HOME_SEO.title,
    HOME_SEO.description,
    CATALOG_SEO.title,
    CATALOG_SEO.description,
    FAQ_PAGE.title,
    FAQ_PAGE.description,
    PORTFOLIO.title,
    PORTFOLIO.description,
    ...Object.values(LANDING_SEO_OVERRIDES_KA).flatMap((o) => [o!.title, o!.description]),
    designSeoTitle("ლატე", "წყვილები"),
    designFallbackDescription("ლატე", "წყვილები", null),
  ];

  it("no transliterated Georgian: every Latin word is an allowed term", () => {
    for (const t of texts) {
      for (const w of t.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
        expect(LATIN_ALLOWED.has(w), `"${w}" in: ${t}`).toBe(true);
      }
    }
  });

  it("no Russian (Cyrillic) anywhere in the copy", () => {
    for (const t of texts) expect(t).not.toMatch(/[Ѐ-ӿ]/);
  });

  it("no forbidden brand names; no club / national-team names", () => {
    for (const f of COPY_FILES) expect(source(f), f).not.toMatch(FORBIDDEN_BRANDS);
    for (const t of texts) {
      expect(t).not.toMatch(FORBIDDEN_BRANDS);
      expect(t).not.toMatch(/PSG|Barça|Barca|Real Madrid|Barcelona|ბარსა|რეალი/i);
    }
  });

  it("partners named: Dinamo and Nike only", () => {
    const text = pageTexts(PRINTING_PAGE).join("\n");
    expect(text).toContain("დინამო თბილისის ოფიციალური პარტნიორი");
    expect(text).toContain("Nike-ის ოფიციალურ წარმომადგენლობასთან");
    expect(text).toContain("ცნობილი ბრენდების ადგილობრივ წარმომადგენლობებთან");
  });
});

describe("service pages — static HTML and JSON-LD", () => {
  for (const p of SERVICE_PAGE_LIST) {
    it(`${p.path}: h1, every section, every Q&A and the CTA in the static #root`, () => {
      const html = servicePageHtml(p, { esc, link, style });
      const text = unesc(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      expect(html).toContain(`<h1 style="">${esc(p.h1)}</h1>`);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      for (const s of p.sections) {
        expect(html).toContain(`<h2 style="">${esc(s.h2)}</h2>`);
        if (s.body) expect(text).toContain(s.body);
        for (const b of s.bullets ?? []) expect(html).toContain(`<strong>${esc(b.term)}</strong> — ${esc(b.text)}`);
        for (const step of s.steps ?? []) expect(text).toContain(step);
        for (const l of s.links ?? []) expect(html).toContain(link(l.href, l.label));
      }
      for (const f of p.faq) {
        expect(html).toContain(`<h3 style="">${esc(f.q)}</h3>\n<p style="">${esc(f.a)}</p>`);
      }
      expect(text).toContain(p.intro);
      expect(text).toContain(p.cta.body);
      // Vests / raincoats: no photo exists — no image rather than a wrong one.
      if (p.slug === "zhiletebi-da-satsvimrebi") expect(p.images ?? []).toHaveLength(0);
      else expect(p.images?.length).toBeGreaterThanOrEqual(1);
      for (const img of p.images ?? []) {
        expect(img.src).toMatch(/^\/(showroom|products)\/.+\.webp$/);
        expect(html).toContain(`src="${img.src}" alt="${esc(img.alt)}" width="${img.width}" height="${img.height}" loading="lazy"`);
      }
    });

    it(`${p.path}: Service + FAQPage + BreadcrumbList`, () => {
      type Node = { "@type": string; name: string; url: string; provider: { "@type": string; name: string }; areaServed: unknown };
      type Faq = { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
      type Crumbs = { "@type": string; itemListElement: { name: string }[] };
      const [service, faq, crumbs] = serviceSchemas(p) as [Node, Faq, Crumbs];
      expect(service["@type"]).toBe("Service");
      expect(service.name).toBe(p.h1);
      expect(service.url).toBe(`https://maika.ge${p.path}`);
      expect(service.provider["@type"]).toBe("LocalBusiness");
      expect(service.provider.name).toBe("Maika.ge");
      expect(service.areaServed).toEqual([
        { "@type": "Country", name: "Georgia" },
        { "@type": "City", name: "Tbilisi" },
      ]);
      expect(faq["@type"]).toBe("FAQPage");
      expect(faq.mainEntity.map((q) => q.name)).toEqual(p.faq.map((f) => f.q));
      expect(faq.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(p.faq.map((f) => f.a));
      expect(crumbs["@type"]).toBe("BreadcrumbList");
      expect(crumbs.itemListElement.map((i) => i.name)).toEqual(["მთავარი", p.name]);
    });
  }

  it("prerender.mjs writes them with the shared builders and the same title", () => {
    const pre = source("scripts/prerender.mjs");
    expect(pre).toContain("for (const sp of app.SERVICE_PAGE_LIST ?? [])");
    expect(pre).toContain("title: sp.seo.title,");
    expect(pre).toContain("description: sp.seo.description,");
    expect(pre).toContain("jsonLd: app.serviceSchemas(sp),");
    expect(pre).toContain("rootHtml: servicePageHtml(sp, { esc, link, style: STYLE }, servicesBlock(app, sp.path)),");
    expect(source("scripts/lib/appModules.mjs")).toContain('serviceCopy: "/src/lib/serviceCopy.ts"');
  });

  it("the committed sitemap gains every service page", () => {
    const entries = serviceSitemapEntries(SERVICE_PAGE_LIST);
    const locs = sitemapLocs(mergeSitemapEntries(source("public/sitemap.xml"), entries).xml);
    for (const p of SERVICE_PAGE_LIST) expect(locs).toContain(`https://maika.ge${p.path}`);
    expect(new Set(locs).size).toBe(locs.length);
    expect(source("scripts/generate-sitemap.mjs")).toContain("serviceSitemapEntries(app.SERVICE_PAGE_LIST ?? [])");
  });
});

describe("ServicePage (live)", () => {
  for (const p of SERVICE_PAGE_LIST) {
    it(`${p.path}: renders the h1, sections, FAQ and sets the same <title>`, async () => {
      render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[p.path]}>
            <ServicePage slug={p.slug} />
          </MemoryRouter>
        </HelmetProvider>,
      );
      expect(screen.getByRole("heading", { level: 1, name: p.h1 })).toBeInTheDocument();
      for (const s of p.sections) expect(screen.getByRole("heading", { level: 2, name: s.h2 })).toBeInTheDocument();
      for (const f of p.faq) {
        expect(screen.getByRole("heading", { level: 3, name: f.q })).toBeInTheDocument();
        expect(screen.getByText(f.a)).toBeInTheDocument();
      }
      await waitFor(() => expect(document.title).toBe(p.seo.title));
    });
  }
});

describe("rewritten titles — Helmet and static agree, ≤60 chars", () => {
  it("lengths", () => {
    const titles = [
      HOME_SEO.title,
      CATALOG_SEO.title,
      FAQ_PAGE.title,
      PORTFOLIO.title,
      landingSeo("T-Shirt", productTypeKa("T-Shirt"), null).title,
      landingSeo("Hoodie", productTypeKa("Hoodie"), null).title,
    ];
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(60);
    for (const d of [HOME_SEO.description, CATALOG_SEO.description, FAQ_PAGE.description, PORTFOLIO.description]) {
      expect(d.length, d).toBeLessThanOrEqual(155);
    }
  });

  it("keywords the Search Console data asked for", () => {
    expect(landingSeo("T-Shirt", productTypeKa("T-Shirt"), null).title.startsWith("მაისური")).toBe(true);
    expect(landingSeo("T-Shirt", productTypeKa("T-Shirt"), null).title).toContain("მაისურების დამზადება და ბეჭდვა");
    expect(landingSeo("Hoodie", productTypeKa("Hoodie"), null).title.startsWith("ჰუდი")).toBe(true);
    expect(CATALOG_SEO.title).toContain("მაისურები ქართული წარწერით");
    expect(CATALOG_SEO.description).toContain("ქართული მაისურები");
    expect(FAQ_PAGE.title).toContain("მაისურების ბეჭდვა — ხშირი კითხვები");
    expect(PORTFOLIO.description).toContain("ჩვენი ნამუშევრები");
    expect(HOME_SEO.title.startsWith("Maika.ge")).toBe(true);
    // No cannibalisation: the exact phrase belongs to /maisurebze-bechdva.
    expect(HOME_SEO.title).not.toContain("მაისურებზე ბეჭდვა");
    expect(HOME_SEO.title).toContain("ტანსაცმელზე ბეჭდვა");
    expect(`${HOME_SEO.title} ${HOME_SEO.description}`).toMatch(/მაისურებზე ბეჭდვა|მაისურების ბეჭდვა/);
    expect(HOME_SEO.description).toContain("საქართველოს ცნობილი მაისურების ბრენდი");
  });

  it("home: index.html carries LandingPage's exact title and description", () => {
    const html = source("index.html");
    expect(html).toContain(`<title>${HOME_SEO.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${HOME_SEO.description}" />`);
    const page = source("src/pages/LandingPage.tsx");
    expect(page).toContain("title={HOME_SEO.title}");
    expect(page).toContain("description={HOME_SEO.description}");
  });

  it("/designs and /design/:slug: one source for page and prerender", () => {
    const catalog = source("src/pages/CatalogPage.tsx");
    expect(catalog).toContain("title={CATALOG_SEO.title}");
    expect(catalog).toContain("description={CATALOG_SEO.description}");
    const detail = source("src/pages/DesignDetailPage.tsx");
    expect(detail).toContain("title={designSeoTitle(design.title_ka, categoryLabel)}");
    const pre = source("scripts/prerender.mjs");
    expect(pre).toContain("app.CATALOG_SEO.title");
    expect(pre).toContain("app.designSeoTitle(d.title_ka, label)");
    expect(pre).toContain("app.designFallbackDescription(d.title_ka, label, null)");
  });

  it("the services links are on the home page, its footer and /faq", () => {
    const home = source("src/pages/LandingPage.tsx");
    expect(home).toContain("SERVICE_LINKS.map((l) =>");
    expect(home).toContain("SERVICE_PAGE_LINKS.map((l) =>");
    expect(home).toContain('to="/sportuli-formebi"');
    expect(home).not.toContain('setMode("sport")');
    expect(home).toContain('"ტანსაცმელზე ბეჭდვა "');
    expect(home).toContain('"შენი დიზაინით"');
    expect(home).not.toContain('"Create your unique design easily"');
    expect(source("src/components/AppHeader.tsx")).toContain("ALL_SERVICE_LINKS.map((l) =>");
    expect(source("src/components/AppHeader.tsx")).toContain("links: ALL_SERVICE_LINKS }}");
    // Home top bar: a <details> "სერვისები" menu with every service page; the
    // other pages also as a compact list under the four cards.
    expect(home).toContain("<details ref={servicesMenuRef}");
    expect(home).toContain("{ALL_SERVICE_LINKS.map((l) => (");
    expect(home).toContain("{MORE_SERVICE_LINKS.map((l) => (");
    expect(source("src/components/MobileNav.tsx")).toContain("services.links.map((l) =>");
    expect(source("src/pages/DesignDetailPage.tsx")).toContain("<PrintServicesLinks />");
    expect(source("src/pages/ProductLandingPage.tsx")).toContain("<PrintServicesLinks tone=\"sidebar\" excludeHref={canonicalPath} />");
    expect(source("src/pages/FaqPage.tsx")).toContain("ALL_SERVICE_LINKS.map((l) =>");
    expect(source("scripts/prerender.mjs")).toContain("app.SERVICE_LINKS.map((l) =>");
    expect(source("scripts/prerender.mjs")).toContain("app.MORE_SERVICE_LINKS.map((l) =>");
    expect(source("src/pages/ServicePage.tsx")).toContain("<PrintServicesLinks excludeHref={page.path} />");
    expect(source("src/pages/CorporatePage.tsx")).toContain('<PrintServicesLinks excludeHref="/corporate" />');
    expect(source("src/components/PrintServicesLinks.tsx")).toContain("printServiceLinksFor(excludeHref)");
    expect(source("scripts/prerender.mjs")).toContain("servicesBlock(app)");
    expect(source("scripts/prerender.mjs")).toContain("services: servicesBlock(app, r.path)");
  });
});

describe("design titles (lib/designSeo.ts)", () => {
  it("placeholders: file-name style names only", () => {
    for (const n of ["დიზაინი 1 (11)", "1 (3)", "Design 12 (2)", "დიზაინი~10", "დიზაინი | 0.4", "დიზაინი–2.1", "დიზაინი", ""]) {
      expect(isPlaceholderDesignName(n), n).toBe(true);
    }
    for (const n of ["ლატე", "ფოო", "ჩოხა 1", "ანანასი1", "არქტიკ მანქი 1.1", "tired 1.1", "trandy designs #3"]) {
      expect(isPlaceholderDesignName(n), n).toBe(false);
    }
  });

  it("{name} — მაისური ქართული დიზაინით | maika.ge, within 60 when possible", () => {
    expect(designSeoTitle("ლატე", "წყვილები")).toBe("ლატე — მაისური ქართული დიზაინით | maika.ge");
    const long = "ძალიან გრძელი სახელი რომელიც ბევრ ადგილს იკავებს";
    expect(designSeoTitle(long, null)).toBe(`${long} — მაისური | maika.ge`);
    for (const n of ["ლატე", "ფოო", "ქართული", "არქტიკ მანქი 1.1"]) {
      expect(designSeoTitle(n, null).length).toBeLessThanOrEqual(DESIGN_TITLE_MAX);
    }
  });

  it("a placeholder never reaches the title or the description", () => {
    expect(designSeoTitle("დიზაინი 1 (11)", "სხვადასხვა")).toBe("მაისური ქართული დიზაინით — სხვადასხვა | maika.ge");
    expect(designSeoTitle("1 (3)", null)).toBe("მაისური ქართული დიზაინით | maika.ge");
    expect(designFallbackDescription("დიზაინი 1 (11)", "სხვადასხვა", 35)).not.toContain("დიზაინი 1");
    expect(
      buildDesignMetaDescription({ title_ka: "დიზაინი 1 (11)", meta_description_ka: null, description_ka: null }, 35, null),
    ).not.toContain("(11)");
  });

  it("description: the design's name, category, lead time; price only on the live page", () => {
    const live = buildDesignMetaDescription({ title_ka: "ლატე", meta_description_ka: null, description_ka: null }, 35, "წყვილები");
    expect(live).toBe(designFallbackDescription("ლატე", "წყვილები", 35));
    expect(live).toContain("„ლატე“");
    expect(live).toContain("„წყვილები“");
    expect(live).toContain(`${LEAD_TIME_KA}ში`);
    expect(live).toContain("ფასი ₾35-დან");
    expect(designFallbackDescription("ლატე", "წყვილები", null)).not.toContain("₾");
    // An admin-written description still wins.
    expect(buildDesignMetaDescription({ title_ka: "x", meta_description_ka: "ჩემი ტექსტი", description_ka: null }, 35, null)).toBe(
      "ჩემი ტექსტი",
    );
  });
});

// ── Phase 2: the eight new service pages ────────────────────────────────────

const PHASE2: Record<string, { phrase: string; extra?: string[] }> = {
  "/fekhburtis-formebi": { phrase: "ფეხბურთის ფორმები", extra: ["ფეხბურთის ფორმების შეკერვა", "გვარი და ნომერი ფორმაზე"] },
  "/kalatburtis-formebi": { phrase: "კალათბურთის ფორმები" },
  "/dtf-bechdva": { phrase: "DTF ბეჭდვა" },
  "/shelkografia": { phrase: "შოლკოგრაფია" },
  "/logos-kargva": { phrase: "ლოგოს ქარგვა", extra: ["ქარგვა ტანსაცმელზე"] },
  "/chiqaze-bechdva": { phrase: "ჭიქაზე ბეჭდვა" },
  "/korporatiuli-sachukrebi": { phrase: "კორპორატიული საჩუქრები" },
  "/maisurebi-kartuli-tsartserebit": { phrase: "მაისურები ქართული წარწერით" },
};

/** The body copy a reader sees under the H1 (no title / description / H1 / link labels). */
function bodyText(p: ServicePageCopy): string {
  return [
    p.intro,
    ...p.sections.flatMap((s) => [
      s.h2,
      s.body ?? "",
      s.note ?? "",
      ...(s.bullets ?? []).flatMap((b) => [b.term, b.text]),
      ...(s.steps ?? []),
    ]),
    p.faqHeading,
    ...p.faq.flatMap((f) => [f.q, f.a]),
  ].join(" ");
}

const allLinks = (p: ServicePageCopy) => [...p.heroLinks, ...p.sections.flatMap((s) => s.links ?? []), ...p.cta.links];

describe("phase 2 service pages", () => {
  const pages = SERVICE_PAGE_LIST.filter((p) => p.path in PHASE2);

  it("all eight are registered, in order", () => {
    expect(pages.map((p) => p.path)).toEqual(Object.keys(PHASE2));
  });

  for (const p of pages) {
    const { phrase, extra = [] } = PHASE2[p.path];

    it(`${p.path}: target phrase in title, H1, an H2, and 2–4 times in the body`, () => {
      expect(p.seo.title.startsWith(phrase) || p.seo.title.includes(phrase), p.seo.title).toBe(true);
      expect(p.seo.title.length, p.seo.title).toBeLessThanOrEqual(60);
      expect(p.h1).toContain(phrase);
      expect(p.sections.some((s) => s.h2.includes(phrase))).toBe(true);
      expect(p.seo.description).toContain(phrase.split(" ")[0]);
      const n = bodyText(p).split(phrase).length - 1;
      expect(n, `${phrase} × ${n}`).toBeGreaterThanOrEqual(2);
      expect(n, `${phrase} × ${n}`).toBeLessThanOrEqual(4);
      for (const x of extra) expect(`${p.h1} ${bodyText(p)}`).toContain(x);
    });

    it(`${p.path}: ~450–650 words, 5–7 FAQ, images, no price, owner's wording`, () => {
      const words = pageTexts(p).slice(4).join(" ").split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(450);
      expect(words).toBeLessThanOrEqual(700);
      expect(p.faq.length).toBeGreaterThanOrEqual(5);
      expect(p.faq.length).toBeLessThanOrEqual(7);
      expect(p.images?.length).toBeGreaterThanOrEqual(1);
      for (const img of p.images ?? []) {
        expect(img.alt).toMatch(/[ა-ჰ]/);
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
      }
      const text = pageTexts(p).join("\n");
      expect(text).not.toContain("₾");
      expect(text).not.toMatch(/ლარ/);
      expect(containsPrice(text)).toBe(false);
      // No published quantity for corporate / discount thresholds.
      expect(text).not.toMatch(/(?:[02-9]|\d{2,})\s*ცალიდან/);
      // Day counts only as the owner's lead time.
      for (const m of text.matchAll(/[\d–-]+\s*(?:სამუშაო\s*)?დღე/g)) expect(m[0]).toBe(LEAD_TIME_KA);
      // Showroom wording, where a showroom address is given.
      if (text.includes("შოურუმშიც შეიძლება")) expect(text).toContain("დინამო არენა, მე-10 კარი");
    });
  }

  it("kit pages: 10–12 sets, sketch, kids, no stripes / gradients, no club kits", () => {
    for (const path of ["/fekhburtis-formebi", "/kalatburtis-formebi"]) {
      const text = pageTexts(SERVICE_PAGES[path.slice(1) as keyof typeof SERVICE_PAGES]).join("\n");
      expect(text).toContain("10–12 კომპლექტიდან");
      expect(text).toContain("ესკიზი");
      expect(text).toContain("ბავშვებისთვის");
      expect(text).toContain("ზოლიან");
      expect(text).toContain("გრადიენტ");
      expect(text).toContain("ცნობილი კლუბებისა");
    }
  });

  it("corporate gifts: paperwork, procurement, phone-case models", () => {
    const text = pageTexts(SERVICE_PAGES["korporatiuli-sachukrebi"]).join("\n");
    for (const w of ["ინვოისს ყოველთვის ვწერთ", "ხელშეკრულებას", "მიღება-ჩაბარების აქტს", "ზედნადებს", "ანგარიშ-ფაქტურას", "ელექტრონული ხელმოწერით", "სახელმწიფო შესყიდვებში", "ფასების კვლევაში", "iPhone, Xiaomi და Samsung"]) {
      expect(text).toContain(w);
    }
  });

  it("cross-links: sport ↔ football / basketball, printing → DTF / screen / embroidery, corporate → gifts / embroidery, mug → /mug, Georgian → catalog", () => {
    const hrefs = (slug: keyof typeof SERVICE_PAGES) => new Set(allLinks(SERVICE_PAGES[slug]).map((l) => l.href));
    for (const h of ["/fekhburtis-formebi", "/kalatburtis-formebi"]) expect(hrefs("sportuli-formebi").has(h), h).toBe(true);
    for (const s of ["fekhburtis-formebi", "kalatburtis-formebi"] as const) expect(hrefs(s).has("/sportuli-formebi"), s).toBe(true);
    for (const h of ["/dtf-bechdva", "/shelkografia", "/logos-kargva"]) expect(hrefs("maisurebze-bechdva").has(h), h).toBe(true);
    const corp = new Set(CORPORATE_COPY.sections.flatMap((s) => (s.link ? [s.link.href] : [])));
    for (const h of ["/korporatiuli-sachukrebi", "/logos-kargva"]) expect(corp.has(h), h).toBe(true);
    expect(hrefs("chiqaze-bechdva").has("/mug")).toBe(true);
    expect(hrefs("korporatiuli-sachukrebi").has("/corporate")).toBe(true);
    for (const h of ["/designs", "/design/kartuli"]) expect(hrefs("maisurebi-kartuli-tsartserebit").has(h), h).toBe(true);
  });
});

describe("ბეჭდვის სერვისები block — printServiceLinksFor", () => {
  const paths = [undefined, "/design/kartuli", "/t-shirt", "/hoodie", "/corporate", ...SERVICE_PAGE_LIST.map((p) => p.path)];

  it("compact, no self-link, only real service pages", () => {
    const known = new Set(ALL_SERVICE_LINKS.map((l) => l.href));
    for (const path of paths) {
      const links = printServiceLinksFor(path);
      expect(links.length, String(path)).toBeGreaterThanOrEqual(4);
      expect(links.length, String(path)).toBeLessThanOrEqual(PRINT_SERVICES_MAX);
      expect(links.map((l) => l.href)).not.toContain(path);
      for (const l of links) expect(known.has(l.href)).toBe(true);
      expect(new Set(links.map((l) => l.href)).size).toBe(links.length);
    }
  });

  it("the most relevant services per page", () => {
    const hrefs = (p: string) => printServiceLinksFor(p).map((l) => l.href);
    expect(hrefs("/sportuli-formebi").slice(0, 2)).toEqual(["/fekhburtis-formebi", "/kalatburtis-formebi"]);
    expect(hrefs("/maisurebze-bechdva").slice(0, 3)).toEqual(["/dtf-bechdva", "/shelkografia", "/logos-kargva"]);
    expect(hrefs("/corporate").slice(0, 2)).toEqual(["/korporatiuli-sachukrebi", "/logos-kargva"]);
    expect(hrefs("/hoodie")).toContain("/maisurebze-bechdva");
    expect(hrefs("/design/kartuli")).toContain("/maisurebi-kartuli-tsartserebit");
  });

  it("static: service pages and /corporate end with the block", () => {
    for (const p of SERVICE_PAGE_LIST) {
      const block = printServicesHtml({ heading: "ბეჭდვის სერვისები", links: printServiceLinksFor(p.path) }, { esc, link, style }, p.path);
      const html = servicePageHtml(p, { esc, link, style }, block);
      expect(html).toContain(block);
      expect(html.endsWith(`${block}\n</main>`)).toBe(true);
      expect(html).not.toContain(link(p.path, p.name));
    }
    const block = printServicesHtml({ heading: "ბეჭდვის სერვისები", links: printServiceLinksFor("/corporate") }, { esc, link, style }, "/corporate");
    const corp = corporatePage({ CORPORATE_SEO: { title: "", description: "" }, CORPORATE_COPY, CORPORATE_SCHEMAS: [] }, { esc, link, style }, block);
    expect(corp.rootHtml).toContain(link("/korporatiuli-sachukrebi", "კორპორატიული საჩუქრები"));
    expect(corp.rootHtml).toContain(link("/logos-kargva", "ლოგოს ქარგვა"));
  });
});

// ── Phase 3: phone cases, tote bags, vests / raincoats ──────────────────────

const PHASE3: Record<string, { h1: string; stem: string; order: string }> = {
  "/telefonis-qeisebi": { h1: "ტელეფონის ქეისები შენი დიზაინით", stem: "ტელეფონის ქეის", order: "/phone-case" },
  "/natsris-chantebi": { h1: "ნაჭრის ჩანთები ლოგოთი და დიზაინით", stem: "ნაჭრის ჩანთ", order: "/tote-bag" },
  "/zhiletebi-da-satsvimrebi": { h1: "ჟილეტები და საწვიმრები ლოგოთი", stem: "ჟილეტ", order: "/corporate" },
};

describe("phase 3 service pages", () => {
  const pages = SERVICE_PAGE_LIST.filter((p) => p.path in PHASE3);

  it("all three are registered last, in order, with a menu link each", () => {
    expect(pages.map((p) => p.path)).toEqual(Object.keys(PHASE3));
    expect(SERVICE_PAGE_LIST.slice(-3).map((p) => p.path)).toEqual(Object.keys(PHASE3));
    for (const path of Object.keys(PHASE3)) expect(ALL_SERVICE_LINKS.some((l) => l.href === path), path).toBe(true);
  });

  for (const p of pages) {
    const { h1, stem, order } = PHASE3[p.path];

    it(`${p.path}: H1, ~350–500 words, 4–6 FAQ, no price, owner's wording, links`, () => {
      expect(p.h1).toBe(h1);
      expect(p.seo.title.startsWith(h1.split(" ").slice(0, 2).join(" "))).toBe(true);
      expect(bodyText(p).split(stem).length - 1).toBeGreaterThanOrEqual(2);
      const words = pageTexts(p).slice(4).join(" ").split(/\s+/).filter(Boolean).length;
      expect(words, `${p.path}: ${words} words`).toBeGreaterThanOrEqual(350);
      expect(words, `${p.path}: ${words} words`).toBeLessThanOrEqual(520);
      expect(p.faq.length).toBeGreaterThanOrEqual(4);
      expect(p.faq.length).toBeLessThanOrEqual(6);
      const text = pageTexts(p).join("\n");
      expect(text).not.toContain("₾");
      expect(text).not.toMatch(/ლარ/);
      expect(containsPrice(text)).toBe(false);
      expect(text).not.toMatch(/\d+\s*ცალ/);
      for (const m of text.matchAll(/[\d–-]+\s*(?:სამუშაო\s*)?დღე/g)) expect(m[0]).toBe(LEAD_TIME_KA);
      if (text.includes("შოურუმშიც შეიძლება")) expect(text).toContain("დინამო არენა, მე-10 კარი");
      expect(allLinks(p).map((l) => l.href)).toContain(order);
      for (const img of p.images ?? []) {
        expect(img.alt).toMatch(/[ა-ჰ]/);
        expect(img.src).toMatch(/^\/products\/.+\.webp$/);
        expect(readFileSync(path.join(ROOT, "public", img.src)).length).toBeGreaterThan(0);
      }
      // Related-links mesh: the page has its own list, and other pages link to it.
      expect(printServiceLinksFor(p.path).length).toBeGreaterThanOrEqual(4);
      const linkedFrom = [...SERVICE_PAGE_LIST.map((x) => x.path), "/corporate"].filter((x) =>
        printServiceLinksFor(x).some((l) => l.href === p.path),
      );
      expect(linkedFrom.length, p.path).toBeGreaterThanOrEqual(2);
    });
  }

  it("phone cases: iPhone, Xiaomi and Samsung; ordering route /phone-case", () => {
    const text = pageTexts(SERVICE_PAGES["telefonis-qeisebi"]).join("\n");
    expect(text).toContain("iPhone, Xiaomi და Samsung");
    expect(SERVICE_PAGES["telefonis-qeisebi"].heroLinks[0].href).toBe("/phone-case");
  });

  it("tote bags: personal and corporate / event use; ordering route /tote-bag", () => {
    const p = SERVICE_PAGES["natsris-chantebi"];
    const text = pageTexts(p).join("\n");
    expect(p.heroLinks[0].href).toBe("/tote-bag");
    for (const w of ["კომპანი", "ღონისძიებ", "შენი დიზაინით"]) expect(text).toContain(w);
  });

  it("vests / raincoats: made to order, not sold online, logo methods, paperwork, corporate CTA, no image, no invented specs", () => {
    const p = SERVICE_PAGES["zhiletebi-da-satsvimrebi"];
    const text = pageTexts(p).join("\n");
    expect(p.images ?? []).toHaveLength(0);
    expect(p.heroLinks[0].href).toBe("/corporate");
    expect(p.cta.links[0].href).toBe("/corporate");
    for (const w of ["ვკერავთ შეკვეთით", "საიტზე არ ვყიდით", "DTF", "შოლკოგრაფია", "ქარგვ", "ინვოისს ყოველთვის ვწერთ"]) {
      expect(text).toContain(w);
    }
    // No materials, colours, sizes or the lead time of the online orders.
    expect(text).not.toMatch(/ნეილონ|პოლიესტერ|ბამბ|წყალგაუმტარ|ამრეკლ|ფერებ|ზომებ|XL|\bS\b|\bM\b/);
    expect(text).not.toContain(LEAD_TIME_KA);
  });
});

describe("spelling: შოლკოგრაფია (the owner's term)", () => {
  const OLD = "შელკოგრაფ";
  const NEW = "შოლკოგრაფ";

  it("the old spelling is gone from every copy module, menu, llms.txt and JSON-LD", () => {
    for (const f of ["src/lib/serviceRouteSlugs.ts", "src/lib/corporateCopy.ts", "src/lib/landingCopy.ts", "src/lib/faqContent.ts", "public/llms.txt"]) {
      expect(source(f), f).not.toContain(OLD);
    }
    for (const l of ALL_SERVICE_LINKS) expect(`${l.label} ${l.description}`).not.toContain(OLD);
    for (const p of SERVICE_PAGE_LIST) {
      const visible = pageTexts(p).filter((t) => t !== p.intro).join("\n");
      expect(visible, p.path).not.toContain(OLD);
      expect(JSON.stringify(serviceSchemas(p)), p.path).not.toContain(OLD);
    }
  });

  it("/shelkografia: the owner's term in title, H1, menu, JSON-LD; the old spelling once, in the intro", () => {
    const p = SERVICE_PAGES.shelkografia;
    expect(p.path).toBe("/shelkografia");
    expect(p.name).toBe("შოლკოგრაფია");
    expect(p.h1).toBe("შოლკოგრაფია მაისურებზე");
    expect(p.seo.title.startsWith("შოლკოგრაფია")).toBe(true);
    expect(p.serviceType).toBe("შოლკოგრაფია");
    expect(MORE_SERVICE_LINKS.find((l) => l.href === "/shelkografia")!.label).toBe("შოლკოგრაფია");
    const all = pageTexts(p).join("\n");
    expect(all.split(OLD).length - 1).toBe(1);
    expect(p.intro).toContain("შოლკოგრაფია (ასევე ცნობილია როგორც შელკოგრაფია ან ტრაფარეტული ბეჭდვა)");
    expect(all.split(NEW).length - 1).toBeGreaterThan(5);
    // Every other page: zero.
    for (const q of SERVICE_PAGE_LIST.filter((x) => x.slug !== "shelkografia")) {
      expect(pageTexts(q).join("\n"), q.path).not.toContain(OLD);
    }
  });
});
