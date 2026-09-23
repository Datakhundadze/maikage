import { describe, it, expect } from "vitest";
import {
  attachmentTypes,
  groupConversations,
  messagePreview,
  shortCustomerId,
  sortThread,
  type SocialMessageRow,
} from "@/lib/socialInbox";

const row = (over: Partial<SocialMessageRow>): SocialMessageRow => ({
  id: Math.random().toString(36).slice(2),
  channel: "messenger",
  customer_id: "2222222222222222",
  direction: "in",
  text: "hi",
  attachments: [],
  unsupported: false,
  sent_at: "2026-09-20T10:00:00Z",
  ...over,
});

describe("groupConversations", () => {
  it("groups by (channel, customer_id), newest conversation first, with counts and last preview", () => {
    const rows = [
      row({ customer_id: "A", sent_at: "2026-09-20T10:00:00Z", text: "old A" }),
      row({ customer_id: "A", sent_at: "2026-09-20T12:00:00Z", text: "reply to A", direction: "out" }),
      row({ customer_id: "B", sent_at: "2026-09-21T09:00:00Z", text: "B says hi" }),
      // same customer id on the other channel is a different conversation
      row({ channel: "instagram", customer_id: "A", sent_at: "2026-09-19T08:00:00Z", text: "ig A" }),
    ];
    const convs = groupConversations(rows);
    expect(convs.map((c) => c.key)).toEqual(["messenger:B", "messenger:A", "instagram:A"]);
    expect(convs[1]).toMatchObject({ count: 2, lastPreview: "reply to A", lastDirection: "out", lastAt: "2026-09-20T12:00:00Z" });
  });

  it("does not depend on input order", () => {
    const a = row({ customer_id: "A", sent_at: "2026-09-20T12:00:00Z", text: "newest" });
    const b = row({ customer_id: "A", sent_at: "2026-09-20T10:00:00Z", text: "older" });
    expect(groupConversations([a, b])[0].lastPreview).toBe("newest");
    expect(groupConversations([b, a])[0].lastPreview).toBe("newest");
  });

  it("returns [] for no rows", () => {
    expect(groupConversations([])).toEqual([]);
  });
});

describe("messagePreview", () => {
  it("truncates to 60 characters and collapses whitespace", () => {
    const long = "ა".repeat(80);
    expect(messagePreview(row({ text: long }))).toBe("ა".repeat(60) + "…");
    expect(messagePreview(row({ text: "a\n\n  b" }))).toBe("a b");
  });
  it("falls back to attachment types, then the unsupported marker", () => {
    expect(messagePreview(row({ text: null, attachments: [{ type: "image", url: "x" }, { type: "video" }] }))).toBe("[image, video]");
    expect(messagePreview(row({ text: null, unsupported: true }))).toBe("[მხარდაუჭერელი შეტყობინება]");
    expect(messagePreview(row({ text: "" }))).toBe("—");
  });
  it("keeps markup as literal text (rendering is a React text node)", () => {
    expect(messagePreview(row({ text: "<img src=x onerror=alert(1)>" }))).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("small helpers", () => {
  it("shortCustomerId keeps the last six characters", () => {
    expect(shortCustomerId("2222222222229876")).toBe("…229876");
    expect(shortCustomerId("12345")).toBe("12345");
  });
  it("attachmentTypes ignores malformed entries", () => {
    expect(attachmentTypes([{ type: "image" }, null, { url: "x" }, "s", { type: "" }])).toEqual(["image"]);
    expect(attachmentTypes("nope")).toEqual([]);
  });
  it("sortThread orders oldest → newest and is stable on ties", () => {
    const t = [
      row({ id: "3", sent_at: "2026-09-20T12:00:00Z" }),
      row({ id: "1", sent_at: "2026-09-20T10:00:00Z" }),
      row({ id: "2a", sent_at: "2026-09-20T11:00:00Z" }),
      row({ id: "2b", sent_at: "2026-09-20T11:00:00Z" }),
    ];
    expect(sortThread(t).map((r) => r.id)).toEqual(["1", "2a", "2b", "3"]);
  });
});
