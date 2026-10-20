import { describe, expect, it } from "vitest";
import {
  computeFunnelCounts,
  costPerPaid,
  isPaymentConfirmation,
  isRequisitesMessage,
  normalizeFunnelRows,
  parsePriceGel,
  pickReferralAd,
  summarizeFunnel,
  type MessageLike,
  type ReferralLike,
} from "@/lib/adFunnel";
import { monthBounds } from "@/lib/spend";

// Real staff message (IBAN already redacted in stored text), incl. the typo „რეკვიზირებს".
const REQ_REAL =
  "გიგზავნით რეკვიზირებს, ჩარიცხვის შემდეგ გამოგვიგზავნეთ ჩარიცხვის ქვითარი🥳\nმაისურის ღირებულება 85ლარია\nსაკურიერო მომსახურებისას 8ლარი ემატება";
const CONFIRM_REAL = "გიდასტურებთ ჩარიცხვას <3";

describe("staff message parsing", () => {
  it("detects requisites incl. the typo'd real text", () => {
    expect(isRequisitesMessage(REQ_REAL)).toBe(true);
    expect(isRequisitesMessage("გიგზავნით რეკვიზიტებს")).toBe(true);
    expect(isRequisitesMessage("გამარჯობა")).toBe(false);
    expect(isRequisitesMessage(null)).toBe(false);
  });

  it("parses the item price, not the courier fee", () => {
    expect(parsePriceGel(REQ_REAL)).toBe(85);
    expect(parsePriceGel("ჰუდის ღირებულება 120 ლარი")).toBe(120);
    expect(parsePriceGel("ღირებულება: 120,50 ლარი")).toBe(120.5);
    expect(parsePriceGel("ღირებულება 99.9ლარი")).toBe(99.9);
    expect(parsePriceGel("საკურიერო მომსახურებისას 8ლარი ემატება")).toBeNull();
    expect(parsePriceGel("ფასი 85 ლარი")).toBeNull();
    expect(parsePriceGel(null)).toBeNull();
    // first match wins
    expect(parsePriceGel("მაისურის ღირებულება 85ლარია, ჰუდის ღირებულება 120ლარი")).toBe(85);
  });

  it("detects payment confirmations", () => {
    expect(isPaymentConfirmation(CONFIRM_REAL)).toBe(true);
    expect(isPaymentConfirmation("ვადასტურებთ ჩარიცხვას")).toBe(true);
    expect(isPaymentConfirmation("ჩარიცხვა დადასტურებულია")).toBe(true);
    expect(isPaymentConfirmation("მივიღეთ ჩარიცხვა, მადლობა")).toBe(true);
    expect(isPaymentConfirmation(REQ_REAL)).toBe(false);
    expect(isPaymentConfirmation("ჩარიცხვის შემდეგ გამოგვიგზავნეთ ქვითარი")).toBe(false);
    expect(isPaymentConfirmation(undefined)).toBe(false);
  });
});

describe("pickReferralAd", () => {
  const refs: ReferralLike[] = [
    { conversation_key: "c1", ad_id: "A", occurred_at: "2026-10-20T10:00:00Z" },
    { conversation_key: "c1", ad_id: "B", occurred_at: "2026-10-22T10:00:00Z" },
    { conversation_key: "c1", ad_id: null, occurred_at: "2026-10-25T10:00:00Z" },
    { conversation_key: "c2", ad_id: "Z", occurred_at: "2026-10-01T10:00:00Z" },
  ];
  it("picks the latest referral at or before the message", () => {
    expect(pickReferralAd(refs, "c1", "2026-10-19T10:00:00Z")).toBeNull();
    expect(pickReferralAd(refs, "c1", "2026-10-20T10:00:00Z")).toBe("A"); // same instant counts
    expect(pickReferralAd(refs, "c1", "2026-10-21T10:00:00Z")).toBe("A");
    expect(pickReferralAd(refs, "c1", "2026-10-23T10:00:00Z")).toBe("B");
    expect(pickReferralAd(refs, "c1", "2026-10-26T10:00:00Z")).toBeNull(); // ref-only link → unknown
    expect(pickReferralAd(refs, "c3", "2026-10-26T10:00:00Z")).toBeNull();
  });
});

describe("computeFunnelCounts (mirror of admin_ad_funnel)", () => {
  const oct = monthBounds(2026, 10);
  const refs: ReferralLike[] = [
    { conversation_key: "cA", ad_id: "HOODIE", occurred_at: "2026-10-21T10:00:00+04:00" },
    { conversation_key: "cB", ad_id: "SHOW_KA", occurred_at: "2026-10-21T09:00:00+04:00" },
    { conversation_key: "cD", ad_id: "SHOW_EN", occurred_at: "2026-10-23T12:00:00+04:00" },
    { conversation_key: "cE", ad_id: "X", occurred_at: "2026-10-31T23:30:00+04:00" },
    { conversation_key: "cF", ad_id: "X", occurred_at: "2026-11-01T00:30:00+04:00" },
  ];
  const m = (ck: string, direction: "in" | "out", text: string, sent_at: string): MessageLike => ({ conversation_key: ck, direction, text, sent_at });
  const msgs: MessageLike[] = [
    m("cA", "in", "გამარჯობა", "2026-10-21T10:00:00+04:00"),
    m("cA", "out", REQ_REAL, "2026-10-21T10:05:00+04:00"),
    m("cA", "out", CONFIRM_REAL, "2026-10-21T11:00:00+04:00"),
    m("cA", "out", "ღირებულება 999ლარი", "2026-10-21T12:00:00+04:00"), // after confirmation → ignored
    m("cA", "out", "გიდასტურებთ კიდევ ერთხელ", "2026-10-21T13:00:00+04:00"), // once per stage
    m("cB", "in", "ფასი?", "2026-10-21T09:00:00+04:00"),
    m("cB", "out", "გიგზავნით რეკვიზიტებს", "2026-10-21T09:10:00+04:00"),
    m("cB", "out", "ვადასტურებთ ჩარიცხვას", "2026-10-21T09:30:00+04:00"),
    m("cC", "in", "hi", "2026-10-22T09:00:00+04:00"),
    m("cC", "in", "რეკვიზიტები მომწერეთ", "2026-10-22T09:01:00+04:00"), // customer text never counts
    m("cD", "in", "ძველი", "2026-09-15T09:00:00+04:00"),
    m("cD", "out", "ღირებულება 50 ლარი", "2026-09-15T09:05:00+04:00"),
    m("cD", "in", "ისევ მე", "2026-10-23T12:00:00+04:00"),
    m("cD", "out", "ღირებულება: 120,50 ლარი", "2026-10-23T12:10:00+04:00"),
    m("cD", "out", "მივიღეთ ჩარიცხვა, მადლობა", "2026-10-23T13:00:00+04:00"),
    m("cE", "in", "x", "2026-10-31T23:30:00+04:00"), // last minutes of Oct (Tbilisi)
    m("cF", "in", "x", "2026-11-01T00:30:00+04:00"), // already November in Tbilisi
    m("cG", "out", "only staff", "2026-10-10T10:00:00+04:00"), // no inbound → not a conversation
  ];

  it("matches the SQL fixture result for October", () => {
    const rows = computeFunnelCounts(msgs, refs, oct.fromIso, oct.toIso);
    expect(rows).toEqual([
      { ad_id: "HOODIE", conversations: 1, requisites: 1, paid: 1, revenue_gel: 85, paid_without_price: 0 },
      { ad_id: "SHOW_EN", conversations: 1, requisites: 0, paid: 1, revenue_gel: 120.5, paid_without_price: 0 },
      { ad_id: "SHOW_KA", conversations: 1, requisites: 1, paid: 1, revenue_gel: null, paid_without_price: 1 },
      { ad_id: "X", conversations: 1, requisites: 0, paid: 0, revenue_gel: null, paid_without_price: 0 },
      { ad_id: null, conversations: 1, requisites: 0, paid: 0, revenue_gel: null, paid_without_price: 0 },
    ]);
  });

  it("keeps a returning customer's old messages organic in their own month", () => {
    const sep = monthBounds(2026, 9);
    expect(computeFunnelCounts(msgs, refs, sep.fromIso, sep.toIso)).toEqual([
      { ad_id: null, conversations: 1, requisites: 0, paid: 0, revenue_gel: null, paid_without_price: 0 },
    ]);
  });
});

describe("RPC rows → totals", () => {
  it("normalises strings and puts organic last", () => {
    const rows = normalizeFunnelRows([
      { ad_id: null, ad_name: null, spend_usd: "5", conversations: "5", requisites: "2", paid: "1", revenue_gel: "85", paid_without_price: "0" },
      { ad_id: "A", ad_name: "ა", spend_usd: "20.00", conversations: "10", requisites: "4", paid: "2", revenue_gel: null, paid_without_price: "2" },
    ]);
    expect(rows.map((r) => r.ad_id)).toEqual(["A", null]);
    expect(rows[1].spend_usd).toBeNull(); // organic never has spend
    expect(rows[0]).toMatchObject({ spend_usd: 20, conversations: 10, paid: 2, revenue_gel: null, paid_without_price: 2 });
    expect(normalizeFunnelRows(null)).toEqual([]);

    const t = summarizeFunnel(rows);
    expect(t).toMatchObject({ spendUsd: 20, conversations: 15, requisites: 6, paid: 3, revenueGel: 85, paidWithoutPrice: 2, adPaid: 2 });
    expect(t.costPerPaidUsd).toBe(10);
  });

  it("costPerPaid", () => {
    expect(costPerPaid(20, 2)).toBe(10);
    expect(costPerPaid(20, 0)).toBeNull();
    expect(costPerPaid(null, 2)).toBeNull();
    expect(costPerPaid(0, 2)).toBeNull();
  });
});
