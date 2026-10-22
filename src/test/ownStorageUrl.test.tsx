// isOwnStorageUrl guard + its use in useCart.addItem: a print already on our
// own public storage is kept as-is (no download / re-upload); data: URLs and
// any other URL keep the old upload path. Supabase/storage are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

const uploadMock = vi.fn();
vi.mock("@/lib/uploadWithRetry", () => ({
  uploadBlobWithRetry: (...args: unknown[]) => uploadMock(...args),
  dataUrlToBlob: async () => new Blob(["png"], { type: "image/png" }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { isOwnStorageUrl, OWN_STORAGE_HOST } from "@/lib/ownStorageUrl";
import { CartProvider, useCart } from "@/hooks/useCart";

const CATALOG_PRINT = `https://${OWN_STORAGE_HOST}/storage/v1/object/public/catalog-designs/prints/abc-123.png`;

describe("isOwnStorageUrl", () => {
  it.each([
    CATALOG_PRINT,
    `https://${OWN_STORAGE_HOST}/storage/v1/object/public/designs/order-mockups/x-transparent.png`,
    `https://${OWN_STORAGE_HOST}/storage/v1/object/public/catalog-designs/a%20b.webp?v=2`,
    `http://${OWN_STORAGE_HOST}/storage/v1/object/public/catalog-designs/p.png`,
  ])("accepts our public object URL %s", (url) => {
    expect(isOwnStorageUrl(url)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["data URL", "data:image/png;base64,iVBORw0KGgo="],
    ["blob URL", "blob:https://maika.ge/7f1c"],
    ["relative path", "/storage/v1/object/public/catalog-designs/p.png"],
    ["other Supabase project", "https://otherproject.supabase.co/storage/v1/object/public/catalog-designs/p.png"],
    ["look-alike host", `https://${OWN_STORAGE_HOST}.evil.com/storage/v1/object/public/catalog-designs/p.png`],
    ["userinfo trick", `https://${OWN_STORAGE_HOST}@evil.com/storage/v1/object/public/catalog-designs/p.png`],
    ["credentials on our host", `https://user:pw@${OWN_STORAGE_HOST}/storage/v1/object/public/catalog-designs/p.png`],
    ["explicit port", `https://${OWN_STORAGE_HOST}:8443/storage/v1/object/public/catalog-designs/p.png`],
    ["800px render (downscaled)", `https://${OWN_STORAGE_HOST}/storage/v1/render/image/public/catalog-designs/p.png?width=800&height=800&resize=contain&quality=65`],
    ["signed URL", `https://${OWN_STORAGE_HOST}/storage/v1/object/sign/catalog-designs/p.png?token=abc`],
    ["bucket only, no object", `https://${OWN_STORAGE_HOST}/storage/v1/object/public/catalog-designs/`],
    ["non-http scheme", `ftp://${OWN_STORAGE_HOST}/storage/v1/object/public/catalog-designs/p.png`],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(isOwnStorageUrl(url as string | null | undefined)).toBe(false);
  });
});

describe("useCart.addItem — transparent print", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    uploadMock.mockImplementation(async (_bucket: string, path: string) => ({
      publicUrl: `https://${OWN_STORAGE_HOST}/storage/v1/object/public/designs/${path}`,
    }));
    localStorage.clear();
  });

  const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;
  const base = {
    product: "T-Shirt",
    subProduct: "Sol's",
    color: "White",
    size: "M",
    isStudio: false,
    frontMockupDataUrl: "data:image/png;base64,AAAA",
    backMockupDataUrl: null,
    backTransparentImageDataUrl: null,
    frontOriginalPhotos: [],
    backOriginalPhotos: [],
    prompt: "x",
    productPrice: 45,
    quantity: 1,
    designState: null,
  };

  it("keeps an own-storage print URL as-is (only the mockup is uploaded)", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => {
      await result.current.addItem({ ...base, transparentImageDataUrl: CATALOG_PRINT });
    });
    expect(result.current.items[0].transparentImageUrl).toBe(CATALOG_PRINT);
    const paths = uploadMock.mock.calls.map((c) => c[1] as string);
    expect(paths.some((p) => p.endsWith("/front-transparent.png"))).toBe(false);
    expect(paths.some((p) => p.endsWith("/front-mockup.png"))).toBe(true);
  });

  it("still uploads a data: URL print (unchanged behaviour)", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => {
      await result.current.addItem({ ...base, transparentImageDataUrl: "data:image/png;base64,BBBB" });
    });
    const paths = uploadMock.mock.calls.map((c) => c[1] as string);
    expect(paths.some((p) => p.endsWith("/front-transparent.png"))).toBe(true);
    expect(result.current.items[0].transparentImageUrl).toMatch(/\/front-transparent\.png$/);
  });

  it("still uploads a foreign http URL (unchanged behaviour)", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => {
      await result.current.addItem({ ...base, transparentImageDataUrl: "https://example.com/p.png" });
    });
    const paths = uploadMock.mock.calls.map((c) => c[1] as string);
    expect(paths.some((p) => p.endsWith("/front-transparent.png"))).toBe(true);
  });
});
