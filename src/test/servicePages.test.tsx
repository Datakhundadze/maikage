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
import { SERVICE_LINKS, SERVICE_PAGE_LINKS, SERVICE_PAGE_NAMES, SERVICE_PAGE_SLUGS } from "@/lib/serviceRouteSlugs";
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
  mergeSitemapEntries,
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
    expect(SERVICE_LINKS.map((l) => l.href)).toEqual([...SERVICE_PAGE_LIST.map((p) => p.path), "/corporate"]);
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
    for (const l of SERVICE_LINKS) expect(KNOWN_PATHS.has(l.href)).toBe(true);
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
    ...SERVICE_LINKS.map((l) => l.label),
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
    expect(pre).toContain("rootHtml: servicePageHtml(sp, { esc, link, style: STYLE }),");
    expect(source("scripts/lib/appModules.mjs")).toContain('serviceCopy: "/src/lib/serviceCopy.ts"');
  });

  it("the committed sitemap gains both service pages", () => {
    const entries = serviceSitemapEntries(SERVICE_PAGE_LIST);
    const locs = sitemapLocs(mergeSitemapEntries(source("public/sitemap.xml"), entries).xml);
    expect(locs).toContain("https://maika.ge/maisurebze-bechdva");
    expect(locs).toContain("https://maika.ge/sportuli-formebi");
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
    expect(source("src/pages/FaqPage.tsx")).toContain("SERVICE_LINKS.map((l) =>");
    expect(source("scripts/prerender.mjs")).toContain("app.SERVICE_LINKS.map((l) =>");
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
