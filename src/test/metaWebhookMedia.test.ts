import { describe, it, expect } from "vitest";
import {
  MAX_IMAGE_BYTES,
  RETENTION_DAYS,
  extForContentType,
  mirrorRowImages,
  mirrorTargets,
  objectPath,
  purgeExpired,
  purgedAttachments,
  safeKey,
  type MediaDeps,
  type PurgeDeps,
} from "../../supabase/functions/meta-webhook/media";
import type { SocialAttachment } from "../../supabase/functions/meta-webhook/handler";
import { parseAttachments, storedPhotoPaths } from "@/lib/socialInbox";

const quiet = () => {};

function fakeMedia(over: Partial<MediaDeps> = {}) {
  const uploads: string[] = [];
  const patches: { mid: string; attachments: SocialAttachment[] }[] = [];
  const deps: MediaDeps = {
    fetchImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }),
    upload: async (path) => { uploads.push(path); return "ok"; },
    patchAttachments: async (mid, attachments) => { patches.push({ mid, attachments }); return true; },
    log: quiet,
    ...over,
  };
  return { deps, uploads, patches };
}

const row = (attachments: SocialAttachment[]) => ({
  channel: "messenger" as const,
  meta_message_id: "m_AbC+/=",
  sent_at: "2026-10-19T13:45:00.000Z",
  attachments,
});

describe("paths and types", () => {
  it("builds a storage-safe path per channel and month", () => {
    expect(safeKey("m_AbC+/=")).toBe("m_AbC___");
    expect(objectPath("instagram", "m_AbC+/=", "2026-10-19T13:45:00Z", 2, "png")).toBe("instagram/2026-10/m_AbC___-2.png");
  });
  it("keeps only picture content types", () => {
    expect(extForContentType("image/jpeg; charset=binary")).toBe("jpg");
    expect(extForContentType("image/png")).toBe("png");
    expect(extForContentType("video/mp4")).toBeNull();
    expect(extForContentType(null)).toBeNull();
  });
  it("targets images with a live https url that are not stored yet", () => {
    expect(
      mirrorTargets([
        { type: "image", url: "https://cdn/x" },
        { type: "video", url: "https://cdn/v" },
        { type: "image", url: null },
        { type: "image", url: "https://cdn/y", stored: true, path: "p" },
        { type: "image", url: "http://cdn/z" },
      ]),
    ).toEqual([0]);
  });
});

describe("mirrorRowImages", () => {
  it("stores each image and records path + stored on the attachment", async () => {
    const { deps, uploads, patches } = fakeMedia();
    const n = await mirrorRowImages(row([{ type: "image", url: "https://cdn/a" }, { type: "audio", url: "https://cdn/b" }]), deps);
    expect(n).toBe(1);
    expect(uploads).toEqual(["messenger/2026-10/m_AbC___-0.jpg"]);
    expect(patches[0].attachments).toEqual([
      { type: "image", url: "https://cdn/a", path: "messenger/2026-10/m_AbC___-0.jpg", stored: true },
      { type: "audio", url: "https://cdn/b" },
    ]);
  });
  it("counts an already-uploaded file (retry) as stored", async () => {
    const { deps, patches } = fakeMedia({ upload: async () => "exists" });
    expect(await mirrorRowImages(row([{ type: "image", url: "https://cdn/a" }]), deps)).toBe(1);
    expect(patches).toHaveLength(1);
  });
  it("leaves the row untouched when download, type, size or upload fails", async () => {
    for (const over of [
      { fetchImage: async () => null },
      { fetchImage: async () => ({ bytes: new Uint8Array([1]), contentType: "text/html" }) },
      { fetchImage: async () => ({ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), contentType: "image/png" }) },
      { upload: async () => "error" as const },
    ] as Partial<MediaDeps>[]) {
      const { deps, patches } = fakeMedia(over);
      expect(await mirrorRowImages(row([{ type: "image", url: "https://cdn/a" }]), deps)).toBe(0);
      expect(patches).toHaveLength(0);
    }
  });
});

describe("purgeExpired", () => {
  it(`deletes stored photos older than ${RETENTION_DAYS} days and marks them purged`, async () => {
    const removed: string[][] = [];
    const patched: Record<string, SocialAttachment[]> = {};
    let cutoff = "";
    const deps: PurgeDeps = {
      listExpired: async (c) => {
        cutoff = c;
        return [{ meta_message_id: "old", attachments: [{ type: "image", url: "https://x", path: "p/1.jpg", stored: true }, { type: "file", url: "https://f" }] }];
      },
      remove: async (paths) => { removed.push(paths); return true; },
      patchAttachments: async (mid, a) => { patched[mid] = a; return true; },
      log: quiet,
    };
    const n = await purgeExpired(new Date("2026-10-19T00:00:00Z"), deps);
    expect(n).toBe(1);
    expect(cutoff).toBe("2026-07-21T00:00:00.000Z");
    expect(removed).toEqual([["p/1.jpg"]]);
    expect(patched.old).toEqual([{ type: "image", url: null, purged: true }, { type: "file", url: "https://f" }]);
  });
  it("does not mark a row purged when the files could not be deleted", async () => {
    const patched: string[] = [];
    const deps: PurgeDeps = {
      listExpired: async () => [{ meta_message_id: "old", attachments: [{ type: "image", url: null, path: "p", stored: true }] }],
      remove: async () => false,
      patchAttachments: async (mid) => { patched.push(mid); return true; },
      log: quiet,
    };
    expect(await purgeExpired(new Date(), deps)).toBe(0);
    expect(patched).toEqual([]);
  });
  it("purgedAttachments only rewrites stored entries", () => {
    expect(purgedAttachments([{ type: "image", url: "u" }])).toEqual([{ type: "image", url: "u" }]);
  });
});

describe("admin tab parsing", () => {
  it("exposes the path only for stored photos and flags purged ones", () => {
    expect(
      parseAttachments([
        { type: "image", url: "u", path: "a.jpg", stored: true },
        { type: "image", url: "u", path: "b.jpg" },
        { type: "image", url: null, purged: true },
        null,
        { url: "no type" },
      ]),
    ).toEqual([
      { type: "image", path: "a.jpg", purged: false },
      { type: "image", path: null, purged: false },
      { type: "image", path: null, purged: true },
    ]);
    expect(parseAttachments("nope")).toEqual([]);
  });
  it("collects stored paths across a thread", () => {
    expect(
      storedPhotoPaths([
        { attachments: [{ type: "image", path: "a", stored: true }] },
        { attachments: [] },
        { attachments: [{ type: "image", path: "b", stored: true }, { type: "image", url: "x" }] },
      ]),
    ).toEqual(["a", "b"]);
  });
});
