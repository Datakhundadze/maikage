import { describe, expect, it } from "vitest";
import { isNewSketch, sketchCustomerLabel, sketchFileName } from "@/lib/botSketches";
import { contactFromGraph, contactLookup } from "../../supabase/functions/meta-webhook/contactName";

describe("contactLookup", () => {
  it("Messenger and Instagram keys ask Graph for the profile name", () => {
    expect(contactLookup("messenger:159657880717306:29163447010004103")).toEqual({
      channel: "messenger",
      customerId: "29163447010004103",
      fields: "first_name,last_name",
    });
    expect(contactLookup("instagram:17841405981370722:123456789012")?.fields).toBe("name,username");
  });
  it("WhatsApp and malformed keys are skipped", () => {
    expect(contactLookup("whatsapp:123:995599000000")).toBeNull();
    expect(contactLookup("messenger:1:abc")).toBeNull();
    expect(contactLookup("messenger:1:2:3")).toBeNull();
    expect(contactLookup("messenger:1:1/../me")).toBeNull();
  });
});

describe("contactFromGraph", () => {
  it("Messenger joins first and last name", () => {
    expect(contactFromGraph("messenger", { first_name: " ნინო ", last_name: "ბერიძე", id: "1" })).toEqual({ name: "ნინო ბერიძე", username: null });
    expect(contactFromGraph("messenger", { first_name: "Nino" })).toEqual({ name: "Nino", username: null });
  });
  it("Instagram keeps name and username", () => {
    expect(contactFromGraph("instagram", { name: "Nino B", username: "nino.b" })).toEqual({ name: "Nino B", username: "nino.b" });
    expect(contactFromGraph("instagram", { username: "nino.b" })).toEqual({ name: null, username: "nino.b" });
  });
  it("errors and empty profiles give null", () => {
    expect(contactFromGraph("messenger", { error: { message: "x" } })).toBeNull();
    expect(contactFromGraph("instagram", null)).toBeNull();
  });
});

describe("sketchCustomerLabel", () => {
  const row = { conversation_key: "messenger:159657880717306:29163447010004103", channel: "messenger" };
  it("prefers the stored name, with @username on Instagram", () => {
    expect(sketchCustomerLabel(row, { conversation_key: row.conversation_key, name: "ნინო ბერიძე", username: null })).toBe("ნინო ბერიძე");
    expect(sketchCustomerLabel({ ...row, channel: "instagram" }, { conversation_key: "k", name: "Nino", username: "nino.b" })).toBe("Nino (@nino.b)");
    expect(sketchCustomerLabel({ ...row, channel: "instagram" }, { conversation_key: "k", name: null, username: "nino.b" })).toBe("@nino.b");
  });
  it("falls back to the id tail, or the phone on WhatsApp", () => {
    expect(sketchCustomerLabel(row)).toBe("კლიენტი …004103");
    expect(sketchCustomerLabel({ conversation_key: "whatsapp:1:995599123456", channel: "whatsapp" })).toBe("+995599123456");
  });
});

describe("sketchFileName / isNewSketch", () => {
  it("builds a safe file name", () => {
    const name = sketchFileName("Nino (@nino.b)", "2026-11-25T15:04:00.000Z");
    expect(name).toMatch(/^Nino-nino\.b-25\.11-\d{4}\.png$/);
    expect(sketchFileName("კლიენტი …004103", "bad")).toBe("კლიენტი-004103-sketch.png");
    expect(sketchFileName("a/b", "2026-11-25T15:04:00.000Z", "jpg")).toMatch(/^ab-25\.11-\d{4}\.jpg$/);
  });
  it("new until downloaded", () => {
    expect(isNewSketch({ downloaded_at: null })).toBe(true);
    expect(isNewSketch({ downloaded_at: "2026-11-26T10:00:00Z" })).toBe(false);
  });
});

import { BOT_LABEL_NAME, conversationLookupPath, labelIdFrom, nameFromConversations } from "../../supabase/functions/meta-webhook/contactName";

describe("fallback name + bot label (owner 2026-11-27)", () => {
  it("builds the conversations lookup per channel", () => {
    expect(conversationLookupPath("159657880717306", { channel: "messenger", customerId: "123456", fields: "x" }))
      .toBe("159657880717306/conversations?platform=messenger&user_id=123456&fields=participants");
    expect(conversationLookupPath("1", { channel: "instagram", customerId: "987654", fields: "x" })).toContain("platform=instagram");
  });
  it("picks the customer among the participants, never the page", () => {
    const data = { data: [{ participants: { data: [{ id: "159657880717306", name: "Maika.GE" }, { id: "123456", name: " Gega  B " }] } }] };
    expect(nameFromConversations(data, "123456")).toEqual({ name: "Gega B", username: null });
    expect(nameFromConversations({ data: [{ participants: { data: [{ id: "77777", username: "tayyiba" }] } }] }, "77777")).toEqual({ name: null, username: "tayyiba" });
    expect(nameFromConversations(data, "999999")).toBeNull();
    expect(nameFromConversations({ error: {} }, "123456")).toBeNull();
  });
  it("finds the bot label by its exact name", () => {
    const list = { data: [{ id: "1", page_label_name: "Intake" }, { id: "42", page_label_name: BOT_LABEL_NAME }] };
    expect(labelIdFrom(list, BOT_LABEL_NAME)).toBe("42");
    expect(labelIdFrom({ data: [] }, BOT_LABEL_NAME)).toBeNull();
    expect(labelIdFrom(null, BOT_LABEL_NAME)).toBeNull();
  });
});
