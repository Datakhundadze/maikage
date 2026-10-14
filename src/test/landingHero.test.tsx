import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductType } from "@/lib/catalog";
import { calculatePrice } from "@/lib/pricing";
import { BRAND_SLUGS, LANDING_PRODUCT_SLUGS, PRODUCT_SLUGS, defaultBrandFor } from "@/lib/productSlugs";
import { fromPrice } from "@/lib/landingPrice";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import { heroTitle } from "@/lib/heroTitle";
import { createDesignStartTracker } from "@/lib/designStart";
import { metaEventFor } from "@/lib/metaPixel";
import PriceDisplay from "@/components/PriceDisplay";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import LandingHero from "@/components/landing/LandingHero";
import { LANDING_PHOTO_LIMIT } from "@/hooks/useLandingPhotos";

vi.mock("@/hooks/useAppState", () => ({ useAppState: () => ({ lang: "ge" }) }));

const gtag = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/gtag", () => gtag);

// Records the portfolio_items query and resolves with `rows`.
const db = vi.hoisted(() => ({
  rows: [] as { title: string | null; image_path: string; alt_text: string | null }[],
  calls: [] as [string, ...unknown[]][],
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    chain[m] = (...a: unknown[]) => { db.calls.push([m, ...a]); return chain; };
  }
  chain.limit = (...a: unknown[]) => { db.calls.push(["limit", ...a]); return Promise.resolve({ data: db.rows }); };
  return {
    supabase: {
      from: (table: string) => { db.calls.push(["from", table]); return chain; },
      storage: {
        from: (bucket: string) => ({
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` },
          }),
        }),
      },
    },
  };
});

beforeEach(() => {
  db.rows = [];
  db.calls = [];
  gtag.trackEvent.mockClear();
});

/** The total the constructor's price card shows before any design is added. */
function priceCardNoDesignTotal(product: ProductType, brand: string): number {
  const { container } = render(<PriceDisplay breakdown={calculatePrice(product, brand, false, false, false)} />);
  const text = container.querySelector(".text-lg")?.textContent ?? "";
  container.remove();
  return Number(text.replace(/[^\d.]/g, ""));
}

describe("fromPrice", () => {
  it("equals the price card's no-design total for every BRAND_SLUGS entry", () => {
    for (const [product, map] of Object.entries(BRAND_SLUGS)) {
      for (const brand of Object.values(map ?? {})) {
        const card = priceCardNoDesignTotal(product as ProductType, brand);
        expect(card, `${product} / ${brand}`).toBeGreaterThan(0);
        expect(fromPrice(product as ProductType, brand), `${product} / ${brand}`).toBe(card);
      }
    }
  });

  it("uses the default brand when the URL names none (every routed product)", () => {
    for (const slug of LANDING_PRODUCT_SLUGS) {
      const product = PRODUCT_SLUGS[slug];
      const card = priceCardNoDesignTotal(product, defaultBrandFor(product));
      expect(card, slug).toBeGreaterThan(0);
      expect(fromPrice(product, null), slug).toBe(card);
    }
  });
});

const renderHero = (product: ProductType = "Hoodie", brand: string | null = "Premium Washed Hoodie") => {
  const onUploadClick = vi.fn();
  render(
    <MemoryRouter>
      <LandingHero product={product} brand={brand} title={heroTitle("ჰუდი", brand)} onUploadClick={onUploadClick} />
    </MemoryRouter>,
  );
  return { onUploadClick };
};

describe("heroTitle", () => {
  it("is the brand alone when the URL names one, the product label otherwise", () => {
    expect(heroTitle("ჰუდი", "Premium Washed Hoodie")).toBe("Premium Washed Hoodie");
    expect(heroTitle("ჰუდი", null)).toBe("ჰუდი");
    expect(heroTitle("ჭიქა", null)).toBe("ჭიქა");
  });
});

describe("LandingHero", () => {
  it("shows the H1, the from-price + lead-time line, the CTA and the chat link", async () => {
    const { onUploadClick } = renderHero();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Premium Washed Hoodie — შენი დიზაინით");
    expect(screen.getByText(`${fromPrice("Hoodie", "Premium Washed Hoodie")} ₾-დან`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`მზადდება ${LEAD_TIME_KA}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ატვირთე ფოტო/ }));
    expect(onUploadClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "იდეა არ გაქვს? მოგვწერე" })).toHaveAttribute("href", "/chat");
    // No rows → no strip, and no error text.
    await waitFor(() => expect(db.calls.some(([m]) => m === "limit")).toBe(true));
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("queries active photos of the product's category, gallery order, limit 4, and builds 400w URLs", async () => {
    db.rows = [
      { title: "ა", image_path: "a.jpg", alt_text: "ჰუდი ფოტო" },
      { title: "ბ", image_path: "b.jpg", alt_text: null },
    ];
    renderHero();
    const strip = await screen.findByRole("list");
    // Same row as the price.
    expect(strip.parentElement).toContainElement(screen.getByText(`${fromPrice("Hoodie", "Premium Washed Hoodie")} ₾-დან`));
    const imgs = within(strip).getAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute(
      "src",
      "https://x.supabase.co/storage/v1/render/image/public/portfolio/a.jpg?width=400&height=400&resize=contain&quality=65",
    );
    expect(imgs[0].getAttribute("srcset")).toContain("width=800");
    expect(imgs[0]).toHaveAttribute("alt", "ჰუდი ფოტო");
    expect(imgs[1]).toHaveAttribute("alt", "ბ");
    expect(imgs[0]).toHaveAttribute("loading", "lazy");
    expect(db.calls).toEqual([
      ["from", "portfolio_items"],
      ["select", "title, image_path, alt_text"],
      ["eq", "active", true],
      ["eq", "category", "ჰუდი"],
      ["order", "sort_order", { ascending: true, nullsFirst: false }],
      ["order", "created_at", { ascending: false }],
      ["limit", LANDING_PHOTO_LIMIT],
    ]);
    expect(LANDING_PHOTO_LIMIT).toBe(4);
  });

  it("does not query photos for a product without a label", () => {
    renderHero("Mug", null);
    expect(db.calls).toEqual([]);
    expect(screen.getByRole("button", { name: /ატვირთე ფოტო/ })).toBeInTheDocument();
  });
});

describe("ProductConfigPanel productInitiallyOpen", () => {
  const props = {
    config: { product: "Hoodie", subProduct: "Premium Washed Hoodie", color: "Black", view: "front" } as never,
    locked: false,
    onProductChange: () => {},
    onSubProductChange: () => {},
    onColorChange: () => {},
    onViewChange: () => {},
  };
  // The product tiles are only in the DOM while the picker is expanded.
  const tileCount = () => screen.queryAllByRole("button").filter((b) => b.textContent?.includes("მაისური")).length;

  it("defaults to open (unchanged behaviour at /)", () => {
    render(<ProductConfigPanel {...props} />);
    expect(tileCount()).toBeGreaterThan(0);
  });

  it("an explicit undefined is the default too (what SimplePage passes at /)", () => {
    render(<ProductConfigPanel {...props} productInitiallyOpen={undefined} />);
    expect(tileCount()).toBeGreaterThan(0);
  });

  it("starts collapsed with false, and still opens on tap", () => {
    render(<ProductConfigPanel {...props} productInitiallyOpen={false} />);
    expect(tileCount()).toBe(0);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(tileCount()).toBeGreaterThan(0);
  });
});

describe("design_start", () => {
  it("fires once per tracker (= once per page view), with the first method", () => {
    const start = createDesignStartTracker();
    start("text");
    start("upload");
    start("ai");
    expect(gtag.trackEvent).toHaveBeenCalledTimes(1);
    expect(gtag.trackEvent).toHaveBeenCalledWith("design_start", { method: "text" });
    createDesignStartTracker()("ai");
    expect(gtag.trackEvent).toHaveBeenLastCalledWith("design_start", { method: "ai" });
  });

  it("is mirrored to Meta as CustomizeProduct", () => {
    expect(metaEventFor("design_start", { method: "upload" })).toEqual({ event: "CustomizeProduct", params: {} });
  });
});
