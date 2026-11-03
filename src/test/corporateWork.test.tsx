import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  CORPORATE_PARTNERS,
  CORPORATE_PARTNERS_HEADING,
  CORPORATE_WORK_COPY,
  CORPORATE_WORK_LIMIT,
  CORPORATE_WORK_PATHS,
  CORPORATE_WORK_SIZES,
  CORPORATE_WORK_TILE,
  corporateBrand,
  corporateBrandKey,
  corporateWorkImage,
  isCorporateWork,
  selectCorporateWork,
  type CorporateWorkRow,
} from "@/lib/corporateWork";
import { CORPORATE_COPY, CORPORATE_SCHEMAS, CORPORATE_SEO } from "@/lib/corporateCopy";
import { CORPORATE_GIFTS_PAGE } from "@/lib/serviceCopy";
import { corporatePage, corporateWorkHtml, containsPrice, servicePageHtml } from "../../scripts/lib/seo.mjs";

// Supabase rows for the live component (hoisted for vi.mock).
const mockRows = vi.hoisted(() => ({ data: [] as unknown[] | null, error: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: async () => ({ data: mockRows.data, error: mockRows.error }) }) }),
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (p: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${p}` },
        }),
      }),
    },
  },
}));

import CorporateWorkGallery from "@/components/CorporateWorkGallery";

const source = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

let seq = 0;
function row(alt: string, extra: Partial<CorporateWorkRow> = {}): CorporateWorkRow {
  seq++;
  return {
    id: `id-${String(seq).padStart(3, "0")}`,
    title: null,
    image_path: `p/${seq}.webp`,
    category: "კორპორატიული",
    alt_text: alt,
    sort_order: null,
    created_at: `2026-07-03T10:00:${String(seq % 60).padStart(2, "0")}Z`,
    active: true,
    ...extra,
  };
}

// A realistic mix: brands with many photos, unbranded ones, non-corporate ones.
function fixture(): CorporateWorkRow[] {
  seq = 0;
  return [
    row("შავი და ნაცრისფერი პოლოები Lexus Tbilisi ლოგოთი — კორპორატიული ფორმა", { sort_order: 1 }),
    row("შავი ჟილეტი Lexus ლოგოთი — კორპორატიული ფორმა", { sort_order: 2 }),
    row("შავი ქურთუკი Lexus ლოგოთი — კორპორატიული ფორმა", { sort_order: 3 }),
    ...Array.from({ length: 6 }, (_, i) => row(`თეთრი ჰუდები Citycom ლოგოთი და ილუსტრაციით ${i} — კორპორატიული შეკვეთა`)),
    row("შავი წინსაფარი CAVAVIN ღვინის ბრენდის ლოგოთი — კორპორატიული ფორმა"),
    row("მუქი ლურჯი ტილოს ჩანთა EPAM ლოგოთი — კორპორატიული შეკვეთა"),
    row("შავი კეპი EPAM ლოგოთი — კორპორატიული შეკვეთა"),
    row("თეთრი და ნარინჯისფერი მაისურები FRIXX ლოგოებით — კორპორატიული შეკვეთა"),
    row("მწვანე პოლო Nutrimax ლოგოთი — კორპორატიული შეკვეთა"),
    row("წითელი პოლოები Black Coral ლოგოთი — კორპორატიული ფორმა"),
    row("მწვანე პოლოები კომპანიის ლოგოთი — კორპორატიული ფორმა"),
    row("შავი მაისურები მცირე ლოგოთი — კორპორატიული შეკვეთა"),
    row("წითელი მაისურები Dinamo კლუბის ემბლემით — კორპორატიული შეკვეთა"),
    row("ქართული წარწერის მაისური"),
    row("შავი მაისურები MEGA SPORT ლოგოთი — კორპორატიული შეკვეთა", { active: false }),
    row("შავი მაისურები Weller ლოგოთი — ბრენდირებული შეკვეთა", { image_path: "" }),
  ];
}

describe("lib/corporateWork.ts selection", () => {
  it("extracts the brand: Latin words before ლოგოთი / ლოგოებით, else null", () => {
    expect(corporateBrand("შავი და ნაცრისფერი პოლოები Lexus Tbilisi ლოგოთი — კორპორატიული ფორმა")).toBe("Lexus Tbilisi");
    expect(corporateBrand("შავი წინსაფარი CAVAVIN ღვინის ბრენდის ლოგოთი — კორპორატიული ფორმა")).toBe("CAVAVIN");
    expect(corporateBrand("მაისურები FRIXX ლოგოებით — კორპორატიული შეკვეთა")).toBe("FRIXX");
    expect(corporateBrand("შავი მაისურები Aspria Fitness Team ლოგოთი — ფიტნეს კლუბის ფორმა")).toBe("Aspria Fitness Team");
    expect(corporateBrand("მწვანე პოლოები კომპანიის ლოგოთი — კორპორატიული ფორმა")).toBeNull();
    expect(corporateBrand("PSP — მაისური ლოგოთი")).toBeNull();
    expect(corporateBrand("RITM ფიტნეს კლუბის მაისურები — კორპორატიული შეკვეთა")).toBeNull();
    // "Lexus" and "Lexus Tbilisi" are one brand; no brand → its own id.
    expect(corporateBrandKey({ id: "a", alt_text: "Lexus Tbilisi ლოგოთი" })).toBe(corporateBrandKey({ id: "b", alt_text: "Lexus ლოგოთი" }));
    expect(corporateBrandKey({ id: "a", alt_text: "კომპანიის ლოგოთი" })).toBe("id:a");
  });

  it("keeps active corporate rows with an image and excludes club emblems", () => {
    const rows = fixture();
    const kept = rows.filter(isCorporateWork).map((r) => r.alt_text);
    expect(kept.some((a) => a?.includes("კლუბის ემბლემით"))).toBe(false);
    expect(kept).not.toContain("ქართული წარწერის მაისური");
    expect(kept.some((a) => a?.includes("MEGA SPORT"))).toBe(false); // inactive
    expect(kept.some((a) => a?.includes("Weller"))).toBe(false); // no image
    const picked = selectCorporateWork(rows);
    expect(picked.some((r) => r.alt_text?.includes("კლუბის ემბლემით"))).toBe(false);
    expect(picked.every(isCorporateWork)).toBe(true);
  });

  it("caps at 12, max 2 per brand, variety first, in sort_order then newest order", () => {
    const picked = selectCorporateWork(fixture());
    expect(picked).toHaveLength(CORPORATE_WORK_LIMIT);
    const counts = new Map<string, number>();
    for (const r of picked) counts.set(corporateBrandKey(r), (counts.get(corporateBrandKey(r)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    // Every distinct brand / unbranded photo (9 groups) is shown before any brand gets a 2nd.
    expect(counts.size).toBe(9);
    // Pinned (sort_order) first.
    expect(picked[0].sort_order).toBe(1);
    expect(picked[1].sort_order).toBe(2);
    expect(picked.filter((r) => r.alt_text?.includes("Lexus"))).toHaveLength(2);
    expect(picked.filter((r) => r.alt_text?.includes("Citycom"))).toHaveLength(2);
  });

  it("is deterministic: same result for any input order", () => {
    const rows = fixture();
    const ids = selectCorporateWork(rows).map((r) => r.id);
    expect(selectCorporateWork([...rows].reverse()).map((r) => r.id)).toEqual(ids);
    const shuffled = [...rows].sort((a, b) => (a.alt_text ?? "").localeCompare(b.alt_text ?? ""));
    expect(selectCorporateWork(shuffled).map((r) => r.id)).toEqual(ids);
    expect(selectCorporateWork(rows).map((r) => r.id)).toEqual(ids);
  });

  it("builds downscaled square-box renders and uses alt_text", () => {
    const r = fixture()[0];
    const img = corporateWorkImage(r, "https://x.supabase.co/storage/v1/object/public/portfolio/p/1.webp");
    expect(img.src).toBe("https://x.supabase.co/storage/v1/render/image/public/portfolio/p/1.webp?width=400&height=400&resize=contain&quality=65");
    expect(img.srcSet).toContain(" 400w, ");
    expect(img.srcSet).toContain("width=800&height=800");
    expect(img.alt).toBe(r.alt_text);
  });

  it("partner list: Dinamo Tbilisi and Nike first, then the owner-approved partners (no duplicates)", () => {
    expect(CORPORATE_PARTNERS.slice(0, 2)).toEqual(["Dinamo Tbilisi", "Nike"]);
    expect(CORPORATE_PARTNERS).toEqual(expect.arrayContaining(["Lexus Tbilisi", "iStyle", "World Class", "British School", "EPAM", "elf"]));
    expect(new Set(CORPORATE_PARTNERS).size).toBe(CORPORATE_PARTNERS.length);
    expect(CORPORATE_WORK_PATHS).toEqual(["/corporate", "/korporatiuli-sachukrebi"]);
    expect(`${CORPORATE_WORK_COPY.heading} ${CORPORATE_WORK_COPY.intro}`).not.toMatch(/₾|[а-яё]/i);
  });
});

describe("prerendered gallery (seo.mjs corporateWorkHtml)", () => {
  const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
  const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const style = { main: "", nav: "", h1: "", h2: "", h3: "", p: "", ul: "", li: "", footer: "" };
  const w = { CORPORATE_WORK_COPY, CORPORATE_PARTNERS, CORPORATE_PARTNERS_HEADING, CORPORATE_WORK_TILE, CORPORATE_WORK_SIZES };
  const images = selectCorporateWork(fixture()).map((r) =>
    corporateWorkImage(r, `https://x.supabase.co/storage/v1/object/public/portfolio/${r.image_path}`),
  );
  const block = corporateWorkHtml(w, images, { esc, link, style });

  it("/corporate: 12 lazy square images with alt, the /portfolio link, after the sections and before the FAQ", () => {
    const page = corporatePage({ CORPORATE_SEO, CORPORATE_COPY, CORPORATE_SCHEMAS }, { esc, link, style }, "", block);
    const html = page.rootHtml;
    const gallery = html.slice(html.indexOf("<section data-corporate-work"), html.indexOf("</section>", html.indexOf("<section data-corporate-work")));
    expect(gallery.match(/<img\b/g)).toHaveLength(12);
    for (const img of images) {
      expect(html).toContain(`alt="${esc(img.alt)}" width="400" height="400" loading="lazy"`);
    }
    expect(html).toContain(`<h2 style="">${CORPORATE_WORK_COPY.heading}</h2>`);
    expect(html).toContain('<a href="/portfolio">ნახე ყველა ნამუშევარი</a>');
    for (const name of CORPORATE_PARTNERS) expect(html).toContain(`<li style="">${esc(name)}</li>`);
    const lastSection = html.indexOf(CORPORATE_COPY.sections[CORPORATE_COPY.sections.length - 1].h3);
    const galleryAt = html.indexOf(CORPORATE_WORK_COPY.heading);
    const faqAt = html.indexOf(CORPORATE_COPY.faqHeading as string);
    expect(galleryAt).toBeGreaterThan(lastSection);
    expect(faqAt).toBeGreaterThan(galleryAt);
    expect(containsPrice(block)).toBe(false);
  });

  it("/korporatiuli-sachukrebi: before the FAQ; no images → partner names only", () => {
    const html = servicePageHtml(CORPORATE_GIFTS_PAGE, { esc, link, style }, "", block);
    expect(html.indexOf(CORPORATE_WORK_COPY.heading)).toBeGreaterThan(-1);
    expect(html.indexOf(CORPORATE_GIFTS_PAGE.faqHeading)).toBeGreaterThan(html.indexOf(CORPORATE_WORK_COPY.heading));
    const empty = corporateWorkHtml(w, [], { esc, link, style });
    expect(empty).not.toContain("<img");
    expect(empty).not.toContain(CORPORATE_WORK_COPY.heading);
    expect(empty).toContain("Dinamo Tbilisi");
  });

  it("prerender.mjs passes the block to /corporate and the corporate service page only", () => {
    const pre = source("scripts/prerender.mjs");
    expect(pre).toContain('corporatePage(app, { esc, link, style: STYLE }, servicesBlock(app, "/corporate"), corporateWork)');
    expect(pre).toContain('app.CORPORATE_WORK_PATHS?.includes(sp.path) ? corporateWork : ""');
    expect(source("scripts/lib/appModules.mjs")).toContain('corporateWork: "/src/lib/corporateWork.ts"');
  });
});

describe("CorporateWorkGallery (live)", () => {
  it("renders 12 lazy images, the heading, partner names and the /portfolio link", async () => {
    mockRows.data = fixture();
    mockRows.error = null;
    render(
      <MemoryRouter>
        <CorporateWorkGallery />
      </MemoryRouter>,
    );
    expect(screen.getByRole("list", { name: CORPORATE_PARTNERS_HEADING })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(12));
    for (const img of screen.getAllByRole("img")) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("width", "400");
      expect(img).toHaveAttribute("height", "400");
    }
    expect(screen.getByRole("heading", { name: CORPORATE_WORK_COPY.heading })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ნახე ყველა ნამუშევარი/ })).toHaveAttribute("href", "/portfolio");
  });

  it("a failed fetch hides the gallery and keeps the partner names", async () => {
    mockRows.data = null;
    mockRows.error = { message: "boom" };
    render(
      <MemoryRouter>
        <CorporateWorkGallery />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: CORPORATE_WORK_COPY.heading })).toBeNull());
    expect(screen.getByText("Dinamo Tbilisi")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("is placed on /corporate and the service page only", () => {
    expect(source("src/pages/CorporatePage.tsx")).toContain('beforeFaq={<CorporateWorkGallery tone="copy" />}');
    expect(source("src/pages/ServicePage.tsx")).toContain("{CORPORATE_WORK_PATHS.includes(page.path) && <CorporateWorkGallery />}");
  });
});
