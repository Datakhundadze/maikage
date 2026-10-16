// Pure helpers and copied page text shared by the build scripts
// (generate-sitemap.mjs, prerender.mjs, generate-llms-txt.mjs). No I/O, no
// network — everything here is unit-tested (src/test/seoStatic.test.ts).
//
// Text rule: every string a static page shows is text the live React page
// shows too. Where the text lives in a src/ module the scripts load that
// module (scripts/lib/appModules.mjs); the few strings that exist only inside
// a page component are copied below with their source, and
// src/test/seoStatic.test.ts fails if a source stops containing them.

export const SITE_URL = "https://maika.ge";

// ── Shared business facts ───────────────────────────────────────────────────

// /contact — every string below is copied VERBATIM from the codebase; the
// source of each is noted. Nothing is reworded, inferred or added: no prices,
// no production times. Change the source, then change it here.
// Used by the /contact and home prerender and by public/llms.txt.
export const CONTACT = {
  h1: "კონტაქტი და შოურუმი",                                   // ContactPage.tsx:112
  // SeoHead.tsx:25-26 (Organization schema description)
  about: "Maika.ge — საქართველოს ცნობილი ბრენდი 15 წლის გამოცდილებით კერვაში, ბეჭდვაში და კასტომ აპარელის წარმოებაში.",
  addressLabel: "მისამართი",                                    // ContactPage.tsx:120
  address: "ა. წერეთლის #2, დინამოს სტადიონი, კარი #10, თბილისი", // ContactPage.tsx:127
  hoursLabel: "სამუშაო საათები",                                // ContactPage.tsx:136
  hours: ["ორშ–პარ 11:00–19:00", "შაბ 11:00–18:00", "კვირა დაკეტილი"], // ContactPage.tsx:138-140
  phoneLabel: "ტელეფონი",                                       // ContactPage.tsx:149
  phones: [                                                     // ContactPage.tsx:21-22
    { display: "+(995 32) 2 05 06 20", tel: "+995322050620" },
    { display: "+995 599 05 08 07", tel: "+995599050807" },
  ],
  emailLabel: "ელფოსტა",                                        // ContactPage.tsx:167
  email: "maika@maika.ge",                                      // ContactPage.tsx:168-169
  mapLabel: "მდებარეობა",                                       // ContactPage.tsx:177
  mapLinkText: "გახსენი Google Maps-ში",                        // ContactPage.tsx:195
  // ContactPage.tsx:14 (MAPS_PLACE_URL)
  mapUrl: "https://www.google.com/maps/place/Maika.ge/@41.7231446,44.7910174,17z/data=!3m1!4b1!4m6!3m5!1s0x404473c7faeeac33:0x51850ad0fd75a99b!8m2!3d41.7231446!4d44.7910174!16s%2Fg%2F11h6g3tpzr",
  socials: [                                                    // labels: ContactBar.tsx aria-labels
    { label: "Facebook", url: "https://www.facebook.com/maika.ge" },       // SeoHead.tsx:36
    { label: "Instagram", url: "https://www.instagram.com/maika.ge_/" },   // SeoHead.tsx:37
    { label: "TikTok", url: "https://www.tiktok.com/@maika.ge" },          // SeoHead.tsx:38
    { label: "WhatsApp", url: "https://wa.me/995599050807" },              // ContactBar.tsx:21,63
  ],
  homeLinkText: "მთავარი გვერდი",                               // ContactPage.tsx:109
};

// ── Page copy that exists only inside a component ───────────────────────────
// Verbatim; seoStatic.test.ts checks each string against its source file.

/**
 * src/pages/CorporatePage.tsx. Its <title> / description and the SEO text
 * section are NOT copied here: they live in src/lib/corporateCopy.ts
 * (CORPORATE_SEO, CORPORATE_COPY), which prerender.mjs loads through
 * appModules.mjs.
 */
export const CORPORATE = {
  backLabel: "მთავარი გვერდი",
  h1: "კორპორატიული განყოფილება",
  intro:
    "გთავაზობთ კორპორატიულ მომსახურებას — ბრენდირებული ტანსაცმელი, აქსესუარები და სარეკლამო პროდუქცია თქვენი კომპანიისთვის. ინდივიდუალური მიდგომა ყველა პროექტისთვის.",
  features: ["ხარისხი", "სისწრაფე", "ინდივიდუალური მიდგომა", "კონკურენტული ფასები"],
  cta: "დაგვიკავშირდი",
};

/** src/pages/PortfolioPage.tsx */
export const PORTFOLIO = {
  title: "პორტფოლიო — ჩვენი ნამუშევრები | Maika.ge",
  description:
    "Maika.ge-ის ნამუშევრების გალერეა — დაბეჭდილი მაისურები, ჰუდები, ჩანთები და კასტომ აპარელი. ნახე რას ვქმნით და შეუკვეთე შენი დიზაინი.",
  backLabel: "მთავარი გვერდი",
  h1: "პორტფოლიო",
  intro: "ჩვენი ნამუშევრები — დაბეჭდილი მაისურები, ჰუდები და კასტომ აპარელი.",
  allLabel: "ყველა",
  altFallback: "Maika.ge პორტფოლიო",
  catalogCta: "ნახე კატალოგი",
};

/** src/pages/ShowroomPage.tsx */
export const SHOWROOM = {
  title: "ვირტუალური შოურუმი — Maika.ge",
  description: "გაიარეთ Maika.ge-ს შოურუმში 3D-ში, პირდაპირ ბრაუზერიდან.",
  h1: "ვირტუალური შოურუმი",
};

/** src/components/landing/LandingHero.tsx (h1 suffix, lead-time prefix, CTAs) */
export const LANDING_HERO = {
  h1Suffix: " — შენი დიზაინით",
  leadTimePrefix: "მზადდება ",
  uploadCta: "ატვირთე ფოტო",
  chatCta: "იდეა არ გაქვს? მოგვწერე",
  chatHref: "/chat",
};

/** Breadcrumb and brand-list labels on the static landing pages. */
export const LANDING_LABELS = {
  home: "მთავარი",      // the breadcrumb label every prerendered page uses (prerender.mjs)
  brand: "ბრენდი",      // i18n.ts ge config.brand — ProductConfigPanel's brand picker heading
};

/** CatalogGrid / BlogPage heading + subtitle — the same strings the /designs and /blog prerender use. */
export const LIST_PAGES = {
  catalog: { h1: "კატალოგი", intro: "მზა დიზაინები — აირჩიე და დაიბეჭდე ნებისმიერ პროდუქტზე" },
  blog: { h1: "ბლოგი", intro: "სიახლეები, ივენთები და კოლაბორაციები" },
};

// ── Landing routes ──────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every product landing route App.tsx registers, plus the brand sub-routes
 * that ProductLandingPage accepts as canonical — resolved with the page's own
 * resolveProductSlug / resolveBrandSlug, so a product hidden or a brand removed
 * in catalog.ts drops out here exactly as it 404s / redirects there.
 *
 * @param app  the subset of loadAppModules() this needs
 * @returns {{ path: string, product: string, productSlug: string, brandSlug: string | null, brand: string | null }[]}
 *          products first (LANDING_PRODUCT_SLUGS order), each followed by its brands (BRAND_SLUGS order)
 */
export function landingRoutes({ LANDING_PRODUCT_SLUGS, BRAND_SLUGS, resolveProductSlug, resolveBrandSlug }) {
  const routes = [];
  for (const productSlug of LANDING_PRODUCT_SLUGS) {
    if (!SLUG.test(productSlug)) continue;
    const product = resolveProductSlug(productSlug);
    if (!product) continue;
    routes.push({ path: `/${productSlug}`, product, productSlug, brandSlug: null, brand: null });
    for (const brandSlug of Object.keys(BRAND_SLUGS[product] ?? {})) {
      if (!SLUG.test(brandSlug)) continue;
      const brand = resolveBrandSlug(product, brandSlug);
      if (!brand) continue;
      routes.push({ path: `/${productSlug}/${brandSlug}`, product, productSlug, brandSlug, brand });
    }
  }
  return routes;
}

/**
 * LandingCopySection (src/components/landing/LandingCopySection.tsx) as static
 * HTML: the same h2 / intro / h3 / body / link structure from
 * lib/landingCopy.ts. A section's `priceLead` (the "from" price sentence) is
 * never written — prices exist at runtime only — so the ფასი section starts
 * at its second sentence, as the live page does when no price is available.
 *
 * A section's `bullets` (CORPORATE_COPY) become a <ul> of
 * "<strong>term</strong> — text", as on the live page. Sections without
 * bullets (all of /t-shirt's) produce exactly the markup they always did.
 *
 * @param copy  landingCopyFor(...) result, or CORPORATE_COPY
 * @param h     prerender.mjs's own helpers: esc, link, style (its STYLE)
 */
export function landingCopyHtml(copy, { esc, link, style }) {
  return [
    `<section>`,
    `<h2 style="${style.h2}">${esc(copy.h2)}</h2>`,
    `<p style="${style.p}">${esc(copy.intro)}</p>`,
    ...copy.sections.map((s) =>
      [
        `<h3 style="${style.h3}">${esc(s.h3)}</h3>`,
        s.body !== undefined ? `<p style="${style.p}">${esc(s.body)}</p>` : "",
        s.bullets?.length
          ? `<ul style="${style.ul}">${s.bullets
              .map((b) => `<li style="${style.li}"><strong>${esc(b.term)}</strong> — ${esc(b.text)}</li>`)
              .join("")}</ul>`
          : "",
        s.link ? `<p style="${style.p}">${link(s.link.href, s.link.label)}</p>` : "",
      ].filter(Boolean).join("\n"),
    ),
    `</section>`,
  ].join("\n");
}

/**
 * /corporate as static HTML: <title> / description from CORPORATE_SEO and a
 * #root that follows CorporatePage's order — back link, h1, intro, the four
 * feature labels, the SEO text section (CORPORATE_COPY), then the CTA. The
 * CTA opens an inquiry form on the live page; here it links to /contact.
 *
 * @param app   { CORPORATE_SEO, CORPORATE_COPY } from src/lib/corporateCopy.ts
 * @param h     prerender.mjs's own helpers: esc, link, style (its STYLE)
 * @returns {{ title: string, description: string, rootHtml: string }}
 */
export function corporatePage({ CORPORATE_SEO, CORPORATE_COPY }, { esc, link, style }) {
  const c = CORPORATE;
  return {
    title: CORPORATE_SEO.title,
    description: CORPORATE_SEO.description,
    rootHtml: [
      `<main style="${style.main}">`,
      `<nav style="${style.nav}">${link("/", c.backLabel)}</nav>`,
      `<h1 style="${style.h1}">${esc(c.h1)}</h1>`,
      `<p style="${style.p}">${esc(c.intro)}</p>`,
      `<ul style="${style.ul}">${c.features.map((f) => `<li style="${style.li}">${esc(f)}</li>`).join("")}</ul>`,
      landingCopyHtml(CORPORATE_COPY, { esc, link, style }),
      `<p style="${style.footer}">${link("/contact", c.cta)}</p>`,
      `</main>`,
    ].join("\n"),
  };
}

// ── Sitemap ─────────────────────────────────────────────────────────────────

/** Same priorities / changefreq as the sitemap edge function's product-routes block. */
export function landingSitemapEntries(routes) {
  return routes.map((r) => ({
    loc: `${SITE_URL}${r.path}`,
    priority: r.brandSlug ? "0.7" : "0.8",
    changefreq: "monthly",
  }));
}

const XML_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => XML_ESCAPE[c]);
const xmlUnesc = (s) =>
  String(s).replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n]);

/** Every <loc> in a sitemap, unescaped, in document order. */
export function sitemapLocs(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => xmlUnesc(m[1]));
}

/**
 * Appends the entries whose loc the sitemap does not already list, just before
 * </urlset>. Existing entries are left byte-for-byte as they are (the edge
 * function stays the source of truth for them); duplicates among `entries`
 * are added once. Returns the xml unchanged when nothing is missing or when
 * there is no </urlset> to append before.
 *
 * @returns {{ xml: string, added: string[] }}
 */
export function mergeSitemapEntries(xml, entries) {
  const have = new Set(sitemapLocs(xml));
  const added = [];
  const blocks = [];
  for (const e of entries) {
    if (have.has(e.loc)) continue;
    have.add(e.loc);
    added.push(e.loc);
    blocks.push(
      `  <url>\n    <loc>${xmlEsc(e.loc)}</loc>\n    <changefreq>${xmlEsc(e.changefreq)}</changefreq>\n    <priority>${xmlEsc(e.priority)}</priority>\n  </url>\n`,
    );
  }
  const end = String(xml).lastIndexOf("</urlset>");
  if (blocks.length === 0 || end === -1) return { xml, added: end === -1 ? [] : added };
  return { xml: xml.slice(0, end) + blocks.join("") + xml.slice(end), added };
}

// ── FAQ ─────────────────────────────────────────────────────────────────────

/**
 * A money amount: the lari sign, or a number followed by "ლარ…" / "GEL".
 * Prices are computed by pricing.ts at runtime only, so no static file may
 * carry one.
 */
export function containsPrice(text) {
  return /₾|\d\s*(?:ლარ|GEL\b)/i.test(String(text ?? ""));
}

/**
 * FAQ groups with every Q&A that mentions a price removed (question OR
 * answer), and groups left empty dropped. Order and wording are untouched.
 *
 * @returns {{ groups: { heading: string, items: { q: string, a: string }[] }[], dropped: string[] }}
 */
export function priceFreeFaq(groups) {
  const dropped = [];
  const kept = [];
  for (const g of groups) {
    const items = g.items.filter((item) => {
      const priced = containsPrice(item.q) || containsPrice(item.a);
      if (priced) dropped.push(item.q);
      return !priced;
    });
    if (items.length > 0) kept.push({ heading: g.heading, items });
  }
  return { groups: kept, dropped };
}

/** schema.org FAQPage — the same shape FaqPage.tsx builds (FAQ_SCHEMA). */
export function faqPageSchema(groups) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups
      .flatMap((g) => g.items)
      .map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
  };
}

/** JSON for an inline <script type="application/ld+json">: no "</script>" breakout. */
export function jsonLdText(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

// ── llms.txt ────────────────────────────────────────────────────────────────

/**
 * public/llms.txt (https://llmstxt.org): what Maika.ge is, what it makes,
 * where and when, how to reach it, and the main URLs. Every fact is a string
 * the site already shows — CONTACT (the /contact page), the landing titles and
 * description tail (lib/landingSeo.ts), the corporate / portfolio / FAQ copy.
 * No prices.
 *
 * @param input.routes       landingRoutes(...) — products only are listed
 * @param input.productKa    (product) => Georgian product label
 * @param input.landingSeo   lib/landingSeo.ts
 * @param input.servicesKa   LANDING_TAIL_KA — photo / text / AI design, DTF, lead time, showroom, delivery
 * @param input.faqPage      FAQ_PAGE
 */
export function buildLlmsTxt({ routes, productKa, landingSeo, servicesKa, faqPage }) {
  const c = CONTACT;
  const brandSuffix = " | maika.ge";
  const products = routes.filter((r) => !r.brandSlug);
  const lines = [
    "# Maika.ge",
    "",
    `> ${c.about}`,
    "",
    "## ბეჭდვა შენი დიზაინით",
    "",
    servicesKa,
    "",
    ...products.map((r) => {
      const title = landingSeo(r.product, productKa(r.product), null).title;
      return `- [${title.endsWith(brandSuffix) ? title.slice(0, -brandSuffix.length) : title}](${SITE_URL}${r.path})`;
    }),
    "",
    `## ${CORPORATE.h1}`,
    "",
    CORPORATE.intro,
    "",
    `- [${CORPORATE.h1}](${SITE_URL}/corporate)`,
    "",
    `## ${c.addressLabel}`,
    "",
    c.address,
    "",
    `- [${c.mapLinkText}](${c.mapUrl})`,
    "",
    `## ${c.hoursLabel}`,
    "",
    ...c.hours.map((h) => `- ${h}`),
    "",
    `## ${c.phoneLabel}`,
    "",
    ...c.phones.map((p) => `- ${p.display}`),
    "",
    `## ${c.emailLabel}`,
    "",
    `- ${c.email}`,
    "",
    "## ბმულები",
    "",
    `- [${c.h1}](${SITE_URL}/contact)`,
    `- [${faqPage.h1}](${SITE_URL}/faq): ${faqPage.intro}`,
    `- [${PORTFOLIO.h1}](${SITE_URL}/portfolio): ${PORTFOLIO.intro}`,
    `- [${LIST_PAGES.catalog.h1}](${SITE_URL}/designs): ${LIST_PAGES.catalog.intro}`,
    `- [${LIST_PAGES.blog.h1}](${SITE_URL}/blog): ${LIST_PAGES.blog.intro}`,
    ...c.socials.map((s) => `- [${s.label}](${s.url})`),
    "",
  ];
  return lines.join("\n");
}
