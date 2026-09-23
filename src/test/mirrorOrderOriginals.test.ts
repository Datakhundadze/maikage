// @vitest-environment node
//
// Pins the source→destination mapping of the mirror-order-originals edge
// function (supabase/functions/mirror-order-originals/derive.ts) to the
// browser-side copy it replaces (CartPage.mirrorCartItemOriginals before
// 2026-09-24): destination paths must stay byte-identical because
// AdminOrders lists order-originals/<orderId>/ and filters on the file name.

import { describe, it, expect } from "vitest";
import {
  deriveCopyJobs,
  isDuplicateError,
  jobForPhotoUrl,
  parseOrderIds,
  MAX_ORDER_IDS,
} from "../../supabase/functions/mirror-order-originals/derive";

const ORDER = "0f3c2a4e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const CART = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PUB = "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/designs";

describe("jobForPhotoUrl", () => {
  it("maps a cart original url to the old browser copy's destination exactly", () => {
    expect(jobForPhotoUrl(`${PUB}/cart-items/${CART}/front-original-0.png`, ORDER)).toEqual({
      from: `cart-items/${CART}/front-original-0.png`,
      to: `order-originals/${ORDER}/front-0.png`,
    });
    expect(jobForPhotoUrl(`${PUB}/cart-items/${CART}/back-original-3.JPG`, ORDER)).toEqual({
      from: `cart-items/${CART}/back-original-3.jpg`,
      to: `order-originals/${ORDER}/back-3.jpg`,
    });
  });

  it("ignores everything that is not a cart original", () => {
    for (const url of [
      null,
      undefined,
      42,
      "",
      `${PUB}/order-originals/${ORDER}/front-0.png`,      // OrderDialog order: already in place
      `${PUB}/cart-items/${CART}/front-mockup.png`,       // mockup, not an original
      `${PUB}/cart-items/${CART}/front-transparent.png`,  // print file, not an original
      `${PUB}/cart-items/not-a-uuid/front-original-0.png`,
      `${PUB}/cart-items/${CART}/front-original-0.gif`,
      `${PUB}/cart-items/${CART}/../order-originals/x/front-original-0.png`,
      `${PUB}/generations/${CART}-front-original-0.png`,
      "data:image/png;base64,AAAA",
    ]) {
      expect(jobForPhotoUrl(url, ORDER)).toBeNull();
    }
  });

  it("accepts a query string or fragment after the file (transform urls) but keeps the bare path", () => {
    expect(jobForPhotoUrl(`${PUB}/cart-items/${CART}/front-original-1.webp?width=800`, ORDER)?.from)
      .toBe(`cart-items/${CART}/front-original-1.webp`);
  });
});

describe("deriveCopyJobs", () => {
  const ds = (front: unknown[], back: unknown[] | null = null) => ({
    version: 1,
    front: { side: "front", photos: front, zone: {} },
    back: back ? { side: "back", photos: back, zone: {} } : null,
  });

  it("walks both sides, keeps order, dedupes on destination", () => {
    const out = deriveCopyJobs(
      ds(
        [{ url: `${PUB}/cart-items/${CART}/front-original-0.png` }, { url: null }, { url: `${PUB}/cart-items/${CART}/front-original-0.png` }],
        [{ url: `${PUB}/cart-items/${CART}/back-original-0.jpeg` }],
      ),
      ORDER,
    );
    expect(out).toEqual({
      status: "ok",
      jobs: [
        { from: `cart-items/${CART}/front-original-0.png`, to: `order-originals/${ORDER}/front-0.png` },
        { from: `cart-items/${CART}/back-original-0.jpeg`, to: `order-originals/${ORDER}/back-0.jpeg` },
      ],
    });
  });

  it("reports nothing_to_copy for an OrderDialog order or a text-only design", () => {
    expect(deriveCopyJobs(ds([{ url: `${PUB}/order-originals/${ORDER}/front-0.png` }]), ORDER)).toEqual({ status: "nothing_to_copy" });
    expect(deriveCopyJobs(ds([]), ORDER)).toEqual({ status: "nothing_to_copy" });
  });

  it("reports no_design_state for null or garbage, never throws", () => {
    expect(deriveCopyJobs(null, ORDER)).toEqual({ status: "no_design_state" });
    expect(deriveCopyJobs("x", ORDER)).toEqual({ status: "no_design_state" });
    expect(deriveCopyJobs({ front: "nope", back: 7 }, ORDER)).toEqual({ status: "nothing_to_copy" });
    expect(deriveCopyJobs({ front: { photos: "nope" } }, ORDER)).toEqual({ status: "nothing_to_copy" });
  });

  it("a caller cannot steer the source: only the row's own urls are used", () => {
    // Whatever the caller sends, derive only ever sees design_state from the
    // database. Here: a design_state that points at ANOTHER cart item still
    // only copies into THIS order's folder — and that is the same thing the
    // old browser copy did for a legitimately shared cart item.
    const out = deriveCopyJobs(ds([{ url: `${PUB}/cart-items/${CART}/front-original-0.png` }]), ORDER);
    expect(out.status === "ok" && out.jobs.every((j) => j.to.startsWith(`order-originals/${ORDER}/`))).toBe(true);
  });
});

describe("parseOrderIds", () => {
  it("accepts 1..50 uuids, lowercases and dedupes", () => {
    expect(parseOrderIds({ orderIds: [ORDER.toUpperCase(), ORDER] })).toEqual([ORDER]);
    expect(parseOrderIds({ orderIds: Array.from({ length: MAX_ORDER_IDS }, (_, i) => ORDER.slice(0, -2) + String(i).padStart(2, "0")) })?.length).toBe(MAX_ORDER_IDS);
  });
  it("rejects everything else", () => {
    for (const body of [null, {}, { orderIds: [] }, { orderIds: "x" }, { orderIds: [ORDER, "cart-items/*"] }, { orderIds: Array(MAX_ORDER_IDS + 1).fill(ORDER) }, { orderIds: [123] }]) {
      expect(parseOrderIds(body)).toBeNull();
    }
  });
});

describe("isDuplicateError", () => {
  it("recognises storage's wording for an existing destination", () => {
    expect(isDuplicateError("The resource already exists")).toBe(true);
    expect(isDuplicateError("Duplicate")).toBe(true);
    expect(isDuplicateError("Object not found")).toBe(false);
    expect(isDuplicateError(undefined)).toBe(false);
  });
});
