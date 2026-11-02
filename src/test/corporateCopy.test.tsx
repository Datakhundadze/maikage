import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LandingCopySection from "@/components/landing/LandingCopySection";
import { CORPORATE_COPY, CORPORATE_H1, CORPORATE_SCHEMAS, CORPORATE_SEO } from "@/lib/corporateCopy";
import { LANDING_COPY } from "@/lib/landingCopy";
import { CORPORATE, containsPrice, corporatePage, landingCopyHtml } from "../../scripts/lib/seo.mjs";

// The /corporate SEO section and title (lib/corporateCopy.ts) on the live page
// (CorporatePage → LandingCopySection tone="page") and in the static prerender
// (scripts/lib/seo.mjs corporatePage, used by scripts/prerender.mjs).

const SRC = readFileSync(path.resolve(__dirname, "../lib/corporateCopy.ts"), "utf8");
const PAGE_SRC = readFileSync(path.resolve(__dirname, "../pages/CorporatePage.tsx"), "utf8");

// Owner-approved text, verbatim.
const APPROVED = {
  title: "მაისურების ბრენდირება კომპანიის ლოგოთი — კორპორატიული შეკვეთები | Maika.ge",
  description:
    "ბრენდირებული მაისურები, ჰუდები, ჩანთები და კეპები კომპანიებისა და გუნდებისთვის. DTF ბეჭდვა, შოლკოგრაფია, ქარგვა და FLEX. 10 ცალიდან ფასდაკლება. თბილისი, დინამოს სტადიონი.",
  h1: "მაისურების ბრენდირება კომპანიის ლოგოთი",
  h2: "ბრენდირებული პროდუქცია კომპანიებისა და გუნდებისთვის",
  intro:
    "ვამზადებთ ბრენდირებულ მაისურებს, ჰუდებს, ჩანთებს, კეპებს და წინსაფრებს კომპანიებისთვის, ღონისძიებებისა და გუნდებისთვის. შენ ლოგოს გვიგზავნი, მაკეტს, ბეჭდვას და შეფუთვას ჩვენ ვაკეთებთ.",
  methodsH3: "ბრენდირების მეთოდები",
  methods: [
    "DTF ბეჭდვა — ფერადი ლოგო ან ფოტო ნებისმიერ რაოდენობაზე, ერთი ცალიდანაც.",
    "შოლკოგრაფია — დიდი ტირაჟისთვის. რაც მეტია რაოდენობა, მით იაფია ერთი ცალი.",
    "ქარგვა — დიდი რაოდენობისთვის. პრემიუმ იერი პოლოებზე, ჰუდებზე და კეპებზე.",
    "თერმული ბეჭდვა (FLEX) — გვარები, ნომრები და ერთფეროვანი ლოგოები, განსაკუთრებით სპორტული ფორმებისთვის.",
  ],
  // [h3, body] of every section without bullets, in order (the methods list is section 2).
  sections: [
    [
      "რას ვაბრენდირებთ",
      "მაისურებს (მათ შორის პოლოებს, oversize და საბავშვო მოდელებს), ჰუდებს, ელვიან ჰუდებს და ბომბერებს, კეპებს, ნაჭრის ჩანთებს, წინსაფრებს და ჭიქებს. მაისურების ბრენდირება კომპანიის ლოგოთი შეიძლება წინა მხარეს, ზურგზე ან ორივე მხარეს.",
    ],
    [
      "როგორ ვმუშაობთ",
      "გვიგზავნი ლოგოს და გვეუბნები, რა ნივთი, რა რაოდენობა და რა ზომები გჭირდება. ერთად ვათანხმებთ ბრენდირების მეთოდს და მაკეტს, შემდეგ ვბეჭდავთ და ვფუთავთ.",
    ],
    [
      "ლოგოს ფაილი",
      "საუკეთესო შედეგისთვის გამოგვიგზავნე ლოგო მაღალი გარჩევადობით, სასურველია გამჭვირვალე ფონით (PNG). თუ ლოგო მხოლოდ დაბალი ხარისხით გაქვს ან ფაილი არ გაქვს საერთოდ, მოგვწერე და მაკეტის მომზადებაში დაგეხმარებით.",
    ],
    ["სპორტული ფორმები გუნდებისთვის", "ფორმებს ვკერავთ ინდივიდუალურად, თითოეულ გუნდზე. ვბეჭდავთ გვარს და ნომერს."],
    [
      "ფასი და ვადა",
      "10 ცალიდან ფასდაკლებაა. ვადა დამოკიდებულია ბრენდირების მეთოდსა და რაოდენობაზე. ზუსტ ფასს და ვადას შეკვეთისას შეგითანხმებთ.",
    ],
    [
      "მიწოდება და შოურუმი",
      "კურიერით ვაწვდით მთელ საქართველოში. შეკვეთის აღება შოურუმშიც შეიძლება: დინამო არენა, მე-10 კარი.",
    ],
    [
      "ვისთვის ვამზადებთ",
      "ბრენდირებულ მაისურებს, ჰუდებს და კეპებს ვამზადებთ კომპანიის თანამშრომლებისთვის, ღონისძიებებისთვის და გუნდებისთვის. Maika.ge საქართველოს ცნობილი ბრენდია 15 წლის გამოცდილებით კერვაში, ბეჭდვაში და კასტომ აპარელის წარმოებაში.",
    ],
    [
      "ვისთან ვთანამშრომლობთ",
      "ვართ დინამო თბილისის ოფიციალური პარტნიორი, ვთანამშრომლობთ Nike-ის ოფიციალურ წარმომადგენლობასთან საქართველოში და ვამზადებთ ბრენდირებულ პროდუქციას საერთაშორისო და ქართული ბრენდებისთვის.",
    ],
  ],
};

describe("lib/corporateCopy.ts", () => {
  it("holds the approved title and description, verbatim", () => {
    expect(CORPORATE_SEO.title).toBe(APPROVED.title);
    expect(CORPORATE_SEO.description).toBe(APPROVED.description);
  });

  it("holds the approved section text, verbatim", () => {
    expect(CORPORATE_H1).toBe(APPROVED.h1);
    expect(CORPORATE.h1).toBe(CORPORATE_H1); // seo.mjs copy (llms.txt)
    expect(CORPORATE_COPY.h2).toBe(APPROVED.h2);
    expect(CORPORATE_COPY.h2).not.toBe(CORPORATE_H1);
    expect(CORPORATE_COPY.intro).toBe(APPROVED.intro);
    const methods = CORPORATE_COPY.sections[1];
    const rest = CORPORATE_COPY.sections.filter((s) => s !== methods);
    expect(methods.h3).toBe(APPROVED.methodsH3);
    expect(methods.body).toBeUndefined();
    expect(methods.bullets?.map((b) => `${b.term} — ${b.text}`)).toEqual(APPROVED.methods);
    expect(rest.map((s) => [s.h3, s.body])).toEqual(APPROVED.sections);
    expect(rest.every((s) => s.bullets === undefined)).toBe(true);
    // Cross-links to the service pages (lib/serviceCopy.ts).
    const linkOf = (h3: string) => CORPORATE_COPY.sections.find((s) => s.h3 === h3)?.link;
    expect(methods.link).toEqual({ href: "/maisurebze-bechdva", label: "მაისურებზე ბეჭდვა" });
    expect(linkOf("სპორტული ფორმები გუნდებისთვის")).toEqual({ href: "/sportuli-formebi", label: "სპორტული ფორმები გვარით და ნომრით" });
    expect(linkOf("ფასი და ვადა")).toBeUndefined();
    expect(linkOf("ვისთან ვთანამშრომლობთ")).toEqual({ href: "/portfolio", label: "პორტფოლიო" });
    expect(CORPORATE_COPY.sections.some((s) => s.priceLead)).toBe(false);
  });

  it("has a FAQ, photos with Georgian alt and explicit size, and ~350+ words", () => {
    expect(CORPORATE_COPY.faq?.length).toBeGreaterThanOrEqual(4);
    expect(CORPORATE_COPY.faqHeading).toBe("ხშირი კითხვები ბრენდირებაზე");
    for (const img of CORPORATE_COPY.images ?? []) {
      expect(img.src).toMatch(/^\/(showroom|products)\/.+\.webp$/);
      expect(img.alt).toMatch(/[ა-ჰ]/);
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
    }
    expect(CORPORATE_COPY.images?.length).toBeGreaterThanOrEqual(1);
    const words = [
      APPROVED.h1,
      CORPORATE_COPY.h2,
      CORPORATE_COPY.intro,
      ...CORPORATE_COPY.sections.flatMap((s) => [s.h3, s.body ?? "", ...(s.bullets ?? []).flatMap((b) => [b.term, b.text])]),
      ...(CORPORATE_COPY.faq ?? []).flatMap((f) => [f.q, f.a]),
    ]
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(350);
  });

  it("Service + FAQPage + BreadcrumbList JSON-LD", () => {
    const [service, faq, crumbs] = CORPORATE_SCHEMAS as Record<string, unknown>[];
    expect(service["@type"]).toBe("Service");
    expect(service.name).toBe(CORPORATE_H1);
    expect(service.url).toBe("https://maika.ge/corporate");
    expect(faq["@type"]).toBe("FAQPage");
    expect((faq.mainEntity as { name: string }[]).map((q) => q.name)).toEqual(CORPORATE_COPY.faq?.map((f) => f.q));
    expect(crumbs["@type"]).toBe("BreadcrumbList");
  });

  it("carries no price and no lead time: no ₾, no number + currency, no number of days", () => {
    expect(SRC).not.toContain("₾");
    expect(containsPrice(SRC)).toBe(false);
    expect(SRC).not.toMatch(/\d+\s*(?:ლარ|GEL|-დან)/);
    expect(SRC).not.toMatch(/\d+\s*(?:[–-]\s*\d+\s*)?(?:სამუშაო\s+)?(?:დღ|საათ|კვირ)/);
    expect(SRC).not.toContain("LEAD_TIME_KA");
  });
});

describe("CorporatePage wiring", () => {
  it("H1 and JSON-LD come from lib/corporateCopy.ts", () => {
    expect(PAGE_SRC).toContain("{CORPORATE_H1}</h1>");
    expect(PAGE_SRC).toContain("schemas={[LOCAL_BUSINESS_SCHEMA, ...CORPORATE_SCHEMAS]}");
  });

  it("renders the section after the feature cards and before the enquiry CTA", () => {
    const cards = PAGE_SRC.indexOf('label: "კონკურენტული ფასები"');
    const section = PAGE_SRC.indexOf('<LandingCopySection copy={CORPORATE_COPY} price={null} tone="page" />');
    const cta = PAGE_SRC.indexOf("<CorporateInquiryModal>");
    expect(cards).toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(cards);
    expect(cta).toBeGreaterThan(section);
  });
});

describe("LandingCopySection with CORPORATE_COPY", () => {
  const renderCorporate = () =>
    render(
      <MemoryRouter>
        <LandingCopySection copy={CORPORATE_COPY} price={null} tone="page" />
      </MemoryRouter>,
    );

  it("renders the h2, intro, every h3, the bold method list, bodies and the portfolio link", () => {
    const { container } = renderCorporate();
    expect(screen.getByRole("heading", { level: 2, name: APPROVED.h2 })).toBeInTheDocument();
    expect(screen.getByText(APPROVED.intro)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: APPROVED.methodsH3 })).toBeInTheDocument();
    const items = [...container.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual(APPROVED.methods);
    for (const f of CORPORATE_COPY.faq ?? []) {
      expect(screen.getByRole("heading", { level: 3, name: f.q })).toBeInTheDocument();
      expect(screen.getByText(f.a)).toBeInTheDocument();
    }
    for (const img of CORPORATE_COPY.images ?? []) {
      const el = screen.getByAltText(img.alt);
      expect(el).toHaveAttribute("loading", "lazy");
      expect(el).toHaveAttribute("width", String(img.width));
    }
    expect(items.map((li) => li.querySelector("strong")?.textContent)).toEqual(
      CORPORATE_COPY.sections[1].bullets?.map((b) => b.term),
    );
    for (const [h3, body] of APPROVED.sections) {
      expect(screen.getByRole("heading", { level: 3, name: h3 })).toBeInTheDocument();
      expect(screen.getByText(body)).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "პორტფოლიო" })).toHaveAttribute("href", "/portfolio");
    expect(container.textContent).not.toContain("₾");
  });

  it("the default tone keeps /t-shirt's classes exactly as before", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingCopySection copy={LANDING_COPY["t-shirt"]} price={null} />
      </MemoryRouter>,
    );
    expect(container.querySelector("section")?.className).toBe(
      "max-w-prose border-t border-sidebar-border pt-6 space-y-4 text-sm leading-relaxed text-muted-foreground",
    );
    expect(container.querySelector("h2")?.className).toBe("text-base font-bold leading-snug text-sidebar-foreground");
    expect(container.querySelector("h3")?.className).toBe("text-sm font-semibold text-sidebar-foreground");
    expect(container.querySelector("a")?.className).toBe(
      "font-medium text-sidebar-foreground underline underline-offset-2 hover:text-primary",
    );
    expect(container.querySelector("ul")).toBeNull();
  });
});

describe("prerendered /corporate (seo.mjs corporatePage)", () => {
  const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
  const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const style = { main: "", nav: "", h1: "", h2: "", h3: "", p: "", ul: "", li: "", footer: "" };
  const page = corporatePage({ CORPORATE_SEO, CORPORATE_COPY, CORPORATE_SCHEMAS }, { esc, link, style });
  const text = page.rootHtml.replace(/<[^>]+>/g, "");

  it("has the new title, description, H1 and JSON-LD", () => {
    expect(page.title).toBe(APPROVED.title);
    expect(page.description).toBe(APPROVED.description);
    expect(page.rootHtml).toContain(`<h1 style="">${APPROVED.h1}</h1>`);
    expect(page.jsonLd).toBe(CORPORATE_SCHEMAS);
    for (const f of CORPORATE_COPY.faq ?? []) expect(page.rootHtml).toContain(`>${f.q}</h3>`);
    for (const img of CORPORATE_COPY.images ?? []) expect(page.rootHtml).toContain(`src="${img.src}"`);
  });

  it("contains the H2 and every section, after the feature list and before the CTA, and no ₾", () => {
    expect(page.rootHtml).toContain(`>${APPROVED.h2}</h2>`);
    expect(text).toContain(APPROVED.intro);
    for (const m of APPROVED.methods) expect(text).toContain(m);
    for (const [h3, body] of APPROVED.sections) {
      expect(text).toContain(h3);
      expect(text).toContain(body);
    }
    expect(page.rootHtml).toContain("<strong>DTF ბეჭდვა</strong> — ");
    expect(page.rootHtml).toContain('<a href="/portfolio">პორტფოლიო</a>');
    const features = page.rootHtml.indexOf("კონკურენტული ფასები");
    const h2 = page.rootHtml.indexOf(APPROVED.h2);
    const cta = page.rootHtml.indexOf('<a href="/contact">დაგვიკავშირდი</a>');
    expect(features).toBeGreaterThan(-1);
    expect(h2).toBeGreaterThan(features);
    expect(cta).toBeGreaterThan(h2);
    expect(page.rootHtml).not.toContain("₾");
    expect(containsPrice(page.rootHtml)).toBe(false);
  });

  it("the /t-shirt section markup is unchanged (no bullets → no <ul>)", () => {
    const html = landingCopyHtml(LANDING_COPY["t-shirt"], { esc, link, style });
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<strong>");
    expect(html.split("\n")).toHaveLength(2 + 1 + LANDING_COPY["t-shirt"].sections.reduce((n, s) => n + 2 + (s.link ? 1 : 0), 0) + 1);
  });
});
