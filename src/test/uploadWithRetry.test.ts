// @vitest-environment node
//
// uploadBlobWithRetry: the upsert default and the duplicate-on-retry rule.
// The Supabase client is mocked; nothing here touches storage.

import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/designs/${path}` } }),
      }),
    },
  },
}));

import { uploadBlobWithRetry } from "@/lib/uploadWithRetry";

const blob = new Blob(["png"], { type: "image/png" });
const DUP = { message: "The resource already exists", statusCode: "409" };
const NET = { message: "fetch failed" };

beforeEach(() => { uploadMock.mockReset(); });

describe("uploadBlobWithRetry", () => {
  it("defaults to upsert: false (a plain INSERT at the storage layer)", async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    await uploadBlobWithRetry("designs", "order-mockups/o-front-uuid.png", blob);
    expect(uploadMock).toHaveBeenCalledWith("order-mockups/o-front-uuid.png", blob, { contentType: "image/png", upsert: false });
  });

  it("passes upsert: true through when a caller asks for it (admin regenerate)", async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    await uploadBlobWithRetry("designs", "order-mockups/o-transparent.png", blob, { upsert: true });
    expect(uploadMock.mock.calls[0][2]).toMatchObject({ upsert: true });
  });

  it("retry after a lost response: 'already exists' on attempt 2 is our own file → success", async () => {
    vi.useFakeTimers();
    uploadMock.mockResolvedValueOnce({ error: NET }).mockResolvedValueOnce({ error: DUP });
    const p = uploadBlobWithRetry("designs", "order-mockups/o-front-uuid.png", blob);
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.publicUrl).toContain("order-mockups/o-front-uuid.png");
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("'already exists' on attempt 1 means someone else pre-created the path → refused, no retry", async () => {
    uploadMock.mockResolvedValue({ error: DUP });
    const r = await uploadBlobWithRetry("designs", "order-mockups/o-front-uuid.png", blob).catch((e: Error) => e);
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toContain("already exists");
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("two real failures still throw, as before", async () => {
    vi.useFakeTimers();
    uploadMock.mockResolvedValue({ error: NET });
    const p = uploadBlobWithRetry("designs", "cart-items/c/front-mockup.png", blob).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r).toBeInstanceOf(Error);
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });
});
