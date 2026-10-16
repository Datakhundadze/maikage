import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LandingCopySection from "@/components/landing/LandingCopySection";
import { LANDING_COPY, landingCopyFor } from "@/lib/landingCopy";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import { fromPrice } from "@/lib/landingPrice";
import { containsPrice, landingCopyHtml } from "../../scripts/lib/seo.mjs";

// The /t-shirt text section (lib/landingCopy.ts) on the live page
// (LandingCopySection) and in the static prerender (scripts/lib/seo.mjs
// landingCopyHtml, used by scripts/prerender.mjs).

const COPY = LANDING_COPY["t-shirt"];
const SRC = readFileSync(path.resolve(__dirname, "../lib/landingCopy.ts"), "utf8");

// Owner-approved text, verbatim.
const APPROVED = {
  h2: "მაისურების დამზადება და ბეჭდვა თბილისში",
  intro:
    "maika.ge-ზე შენი დიზაინით მაისურს რამდენიმე წუთში შეუკვეთავ. ატვირთე ფოტო ან ლოგო, დაწერე ტექსტი, ან აღწერე იდეა და AI დიზაინს უფასოდ შეგიქმნის. შეკვეთა მზადდება 1–2 სამუშაო დღეში.",
  sections: [
    ["მაისურები ქართული წარწერით", "კატალოგში ასობით მზა დიზაინია: ქართული წარწერები, საქართველოს დროშა და სიმბოლიკა, იუმორი, სპორტი. აირჩიე და დაბეჭდე ნებისმიერ მაისურზე."],
    ["ბრენდები და მოდელები", "GILDAN, Sol's, TH, JEL, GIORDANO, NIKE, Polo, Oversize და საბავშვო ზომები."],
    ["ფასი", "ზუსტი ფასი კონსტრუქტორში ჩანს, ბრენდისა და პრინტის ზომის მიხედვით. 10 ცალიდან ფასდაკლებაა."],
    ["ხარისხი", "ვბეჭდავთ DTF ტექნოლოგიით. ფერი ნათელია, პრინტი რეცხვას უძლებს."],
    ["მიწოდება და შოურუმი", "ვაწვდით მთელ საქართველოში. შეგიძლია შოურუმშიც მოხვიდე: ა. წერეთლის #2, დინამოს სტადიონი, მე-10 კარი."],
    ["კომპანიებისა და გუნდებისთვის", "მაისურები კომპანიის ლოგოთი, ფორმები ღონისძიებებისა და გუნდებისთვის."],
  ],
};

const renderSection = (price: number | null) =>
  render(
    <MemoryRouter>
      <LandingCopySection copy={COPY} price={price} />
    </MemoryRouter>,
  );

describe("lib/landingCopy.ts", () => {
  it("holds the approved text, verbatim", () => {
    expect(COPY.h2).toBe(APPROVED.h2);
    expect(COPY.intro).toBe(APPROVED.intro);
    expect(COPY.sections.map((s) => [s.h3, s.body])).toEqual(APPROVED.sections);
    expect(COPY.sections[0].link).toEqual({ href: "/designs?category=georgian", label: "კატალოგი" });
    expect(COPY.sections[5].link).toEqual({ href: "/corporate", label: "კორპორატიული შეკვეთა" });
    expect(COPY.sections[2].priceLead?.("35 ₾")).toBe("მაისური ბეჭდვით 35 ₾-დან.");
  });

  it("takes the lead time from LEAD_TIME_KA — no literal in the file", () => {
    expect(SRC).toContain('import { LEAD_TIME_KA } from "@/lib/leadTime"');
    expect(SRC).toContain("${LEAD_TIME_KA}ში");
    expect(SRC).not.toContain("1–2");
    expect(COPY.intro).toContain(`${LEAD_TIME_KA}ში`);
  });

  it("carries no price: no ₾, no number followed by a currency", () => {
    expect(SRC).not.toContain("₾");
    expect(containsPrice(SRC)).toBe(false);
    expect(SRC).not.toMatch(/\d+\s*(?:ლარ|GEL|-დან)/);
  });

  it("only the bare /t-shirt route gets copy", () => {
    expect(landingCopyFor("t-shirt", null)).toBe(COPY);
    expect(landingCopyFor("t-shirt", "gildan")).toBeNull();
    expect(landingCopyFor("hoodie", null)).toBeNull();
    expect(landingCopyFor("constructor", null)).toBeNull();
  });
});

describe("LandingCopySection", () => {
  it("renders the h2, intro, every h3 and body, and both links", () => {
    renderSection(35);
    expect(screen.getByRole("heading", { level: 2, name: APPROVED.h2 })).toBeInTheDocument();
    expect(screen.getByText(APPROVED.intro)).toBeInTheDocument();
    for (const [h3] of APPROVED.sections) expect(screen.getByRole("heading", { level: 3, name: h3 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "კატალოგი" })).toHaveAttribute("href", "/designs?category=georgian");
    expect(screen.getByRole("link", { name: "კორპორატიული შეკვეთა" })).toHaveAttribute("href", "/corporate");
  });

  it("with a price, the ფასი section opens with it", () => {
    renderSection(35);
    expect(screen.getByText(`მაისური ბეჭდვით 35 ₾-დან. ${APPROVED.sections[2][1]}`)).toBeInTheDocument();
  });

  it("without a price, the price sentence is left out — no placeholder", () => {
    for (const price of [null, Number.NaN, 0]) {
      const { container, unmount } = renderSection(price);
      expect(container.textContent).not.toContain("მაისური ბეჭდვით");
      expect(container.textContent).not.toContain("₾");
      expect(screen.getByText(APPROVED.sections[2][1])).toBeInTheDocument();
      unmount();
    }
  });

  it("the live price is the hero's own fromPrice for T-Shirt", () => {
    const price = fromPrice("T-Shirt", null);
    expect(Number.isFinite(price) && price > 0).toBe(true);
    renderSection(price);
    expect(screen.getByText(new RegExp(`^მაისური ბეჭდვით ${price} ₾-დან\\.`))).toBeInTheDocument();
  });
});

describe("prerendered section (landingCopyHtml)", () => {
  const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
  const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const style = { h2: "", h3: "", p: "" };
  const html = landingCopyHtml(COPY, { esc, link, style });
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'");

  it("contains the H2 and every section, and no ₾ / price sentence", () => {
    expect(html).toContain(`>${APPROVED.h2}</h2>`);
    expect(text).toContain(APPROVED.intro);
    for (const [h3, body] of APPROVED.sections) {
      expect(text).toContain(h3);
      expect(text).toContain(body);
    }
    expect(html).not.toContain("₾");
    expect(html).not.toContain("მაისური ბეჭდვით");
    expect(containsPrice(html)).toBe(false);
    expect(html).toContain('<a href="/designs?category=georgian">კატალოგი</a>');
    expect(html).toContain('<a href="/corporate">კორპორატიული შეკვეთა</a>');
  });
});
