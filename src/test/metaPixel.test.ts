import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { META_PIXEL_ID, metaEventFor } from "@/lib/metaPixel";

type W = Window & { fbq?: unknown; _fbq?: unknown; gtag?: unknown };

describe("metaEventFor (GA4 → Meta mapping)", () => {
  it("add_to_cart → AddToCart with value + GEL", () => {
    expect(metaEventFor("add_to_cart", { value: 80, currency: "GEL", items: [] })).toEqual({
      event: "AddToCart",
      params: { value: 80, currency: "GEL" },
    });
  });
  it("begin_checkout → InitiateCheckout with value + GEL", () => {
    expect(metaEventFor("begin_checkout", { value: 116, currency: "GEL" })).toEqual({
      event: "InitiateCheckout",
      params: { value: 116, currency: "GEL" },
    });
  });
  it("purchase with value → Purchase { value, currency } and eventID = transaction_id", () => {
    expect(metaEventFor("purchase", { transaction_id: "ord-1", value: 96, currency: "GEL", shipping: 0, items: [] })).toEqual({
      event: "Purchase",
      params: { value: 96, currency: "GEL" },
      options: { eventID: "ord-1" },
    });
  });
  it("purchase without value → Purchase with eventID only", () => {
    expect(metaEventFor("purchase", { transaction_id: "ord-2", items: [] })).toEqual({
      event: "Purchase",
      params: {},
      options: { eventID: "ord-2" },
    });
  });
  it("other events are not mirrored", () => {
    expect(metaEventFor("page_view", {})).toBeNull();
    expect(metaEventFor("design_generated", { value: 3 })).toBeNull();
  });
});

describe("trackMeta / trackEvent", () => {
  beforeEach(() => {
    vi.resetModules();
    const w = window as W;
    delete w.fbq;
    delete w._fbq;
    delete w.gtag;
    document.querySelectorAll('script[src*="fbevents"]').forEach((s) => s.remove());
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads the script once, inits the pixel, then queues events", async () => {
    const { trackMeta } = await import("@/lib/metaPixel");
    trackMeta("PageView");
    trackMeta("AddToCart", { value: 1, currency: "GEL" });
    const fbq = (window as W).fbq as { queue: unknown[][] };
    expect(fbq.queue).toEqual([
      ["init", META_PIXEL_ID],
      ["track", "PageView", {}],
      ["track", "AddToCart", { value: 1, currency: "GEL" }],
    ]);
    expect(document.querySelectorAll('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toHaveLength(1);
  });

  it("a blocked script turns every later call into a no-op", async () => {
    const { trackMeta } = await import("@/lib/metaPixel");
    trackMeta("PageView");
    const script = document.querySelector('script[src*="fbevents"]') as HTMLScriptElement;
    script.onerror?.(new Event("error"));
    trackMeta("Purchase", {}, { eventID: "x" });
    expect(((window as W).fbq as { queue: unknown[] }).queue).toHaveLength(2); // init + PageView only
  });

  it("never throws, even if fbq does", async () => {
    (window as W).fbq = () => {
      throw new Error("boom");
    };
    const { trackMeta } = await import("@/lib/metaPixel");
    expect(() => trackMeta("PageView")).not.toThrow();
  });

  it("trackEvent mirrors to Meta even when gtag is absent, and GA gets the unchanged hit", async () => {
    const { trackEvent } = await import("@/lib/gtag");
    trackEvent("purchase", { transaction_id: "ord-3", value: 50, currency: "GEL" });
    const fbq = (window as W).fbq as { queue: unknown[][] };
    expect(fbq.queue.at(-1)).toEqual(["track", "Purchase", { value: 50, currency: "GEL" }, { eventID: "ord-3" }]);

    const gtag = vi.fn();
    (window as W).gtag = gtag;
    trackEvent("add_to_cart", { currency: "GEL", value: 80, items: [{ item_name: "Hoodie" }] });
    expect(gtag).toHaveBeenCalledWith("event", "add_to_cart", { currency: "GEL", value: 80, items: [{ item_name: "Hoodie" }] });
    expect(fbq.queue.at(-1)).toEqual(["track", "AddToCart", { value: 80, currency: "GEL" }]);
  });
});
