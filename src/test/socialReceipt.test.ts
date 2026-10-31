// @vitest-environment node
//
// DM orders — the bank-transfer RECEIPT step (meta-webhook receiptCheck /
// receiptFlow, gemini-proxy receiptRead + the read-receipt branch, the admin
// view): IBAN / name normalisation, the amount and date rules, every verdict,
// the texts, persistence (copy path outside the purge, draft status, comment
// note idempotent), caps, receipt-vs-design routing through runAutoReply, and
// the gemini-proxy branch being add-only and trusted-only.
// All data is synthetic. Our own two IBANs are the public payment accounts
// already quoted by the bot (bankAccounts.ts).

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ALLOWED_IBANS,
  amountMatches,
  checkAmount,
  checkCurrency,
  checkDate,
  checkIban,
  checkName,
  coerceReceiptFields,
  evaluateReceipt,
  nextReceiptState,
  normaliseIban,
  normaliseName,
  parseAmount,
  parseReceiptState,
  receiptCopyPath,
  receiptNote,
  receiptReplyText,
  receiptSourcePaths,
  withReceiptNote,
  RECEIPT_MATCH_TEXT,
  RECEIPT_UNREADABLE_TEXT,
  type ReceiptFields,
} from "../../supabase/functions/meta-webhook/receiptCheck";
import {
  MAX_RECEIPT_READS,
  imageDataUrl,
  receiptCandidates,
  runReceiptStep,
  type ReceiptDeps,
  type ReceiptInput,
} from "../../supabase/functions/meta-webhook/receiptFlow";
import { BANK_LINES, type OrderDeps } from "../../supabase/functions/meta-webhook/orderFlow";
import type { OrderDraft } from "../../supabase/functions/meta-webhook/orderDraft";
import { MAIKA_BOG_IBAN, MAIKA_TBC_IBAN } from "../../supabase/functions/meta-webhook/bankAccountsCopy";
import { operatorBack, type ThreadRow } from "../../supabase/functions/meta-webhook/botReply";
import { purgeExpired } from "../../supabase/functions/meta-webhook/media";
import type { SocialAttachment } from "../../supabase/functions/meta-webhook/handler";
import { _resetTokenWarning, runAutoReply, type AutoReplyDeps, type TriggerRow } from "../../supabase/functions/meta-webhook/autoReply";
import {
  RECEIPT_MODEL,
  isReceiptImage,
  parseReceiptResponse,
  receiptRequestBody,
  resolveTrustedSocialReceipt,
} from "../../supabase/functions/gemini-proxy/receiptRead";
import { parseReceiptView, verdictTone } from "@/lib/receiptView";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SUNDAY_NOON = new Date("2026-11-01T12:00:00+04:00");
const KEY = "messenger:159657880717306:psid1";
const CART = "11111111-2222-4333-8444-555555555555";
const ORDER_CREATED = "2026-11-01T07:00:00.000Z"; // 11:00 Tbilisi, the same Sunday
const TBC_SPACED = "GE13 TB70 9923 6020 1000 12";
const OTHER_IBAN = "GE11TB0000000000000001"; // synthetic, not ours

const fields = (o: Partial<ReceiptFields> = {}): ReceiptFields => ({
  is_receipt: true, amount: 95, currency: "GEL", recipient_name: "შპს „მაიკა ჯი\"", recipient_iban: TBC_SPACED,
  date: "2026-11-01", sender_name: "ტესტ მომხმარებელი", purpose: "შეკვეთა #11111111", bank: "TBC", confidence: 0.95, ...o,
});

// ── normalisation ──────────────────────────────────────────────────────────

describe("IBAN normalisation", () => {
  it("spaces, case, dashes, currency suffix → our IBAN", () => {
    expect(normaliseIban(TBC_SPACED)).toBe(MAIKA_TBC_IBAN);
    expect(checkIban(TBC_SPACED)).toBe("ok");
    expect(checkIban(MAIKA_BOG_IBAN.toLowerCase())).toBe("ok");
    expect(checkIban(`${MAIKA_BOG_IBAN}GEL`)).toBe("ok");
    expect(checkIban("GE89-BG00-0000-0536-1483-75 GEL")).toBe("ok");
    expect(ALLOWED_IBANS).toEqual([MAIKA_TBC_IBAN, MAIKA_BOG_IBAN]);
  });

  it("masked IBAN fitting one of ours → partial; another account → mismatch; none → missing", () => {
    expect(checkIban("GE13TB********0100012")).toBe("partial");
    expect(checkIban("GE89 BG•••• •••• 8375")).toBe("partial");
    expect(checkIban("GE13TB…0012")).toBe("partial");
    expect(checkIban("GE13TB****9999")).toBe("mismatch");
    expect(checkIban("****0012")).toBe("mismatch"); // too little visible
    expect(checkIban(OTHER_IBAN)).toBe("mismatch");
    expect(checkIban(`${MAIKA_TBC_IBAN}1`)).toBe("mismatch");
    expect(checkIban(null)).toBe("missing");
    expect(checkIban("  ")).toBe("missing");
  });
});

describe("recipient name normalisation", () => {
  it("every way a receipt writes „მაიკა ჯი\" matches", () => {
    for (const n of ["მაიკა ჯი", "შპს „მაიკა ჯი\"", "შ.პ.ს. მაიკა ჯი", "ᲛᲐᲘᲙᲐ ᲯᲘ", "Maika G", "MAIKA JI", "Maika-G LLC", "LLC \"Maika Gi\"", "მაიკაჯი 404430175", "MAIKA G, ს/ნ 404430175"]) {
      expect(checkName(n), n).toBe("ok");
    }
  });
  it("other names do not; empty → missing", () => {
    for (const n of ["Maika", "გიორგი ბერიძე", "Maika Print LLC", "მაიკო ჯი"]) expect(checkName(n), n).toBe("mismatch");
    expect(checkName(null)).toBe("missing");
    expect(checkName("შპს")).toBe("missing");
    expect(normaliseName("შპს „მაიკა ჯი\"")).toBe("maikaji");
  });
});

describe("currency and amount", () => {
  it("GEL / ₾ / ლარი; none written = assumed; USD = mismatch", () => {
    expect(["GEL", "gel", "₾", "ლარი"].map(checkCurrency)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(checkCurrency(null)).toBe("assumed");
    expect(checkCurrency("USD")).toBe("mismatch");
  });

  it("amount strings as banks write them", () => {
    expect(parseAmount("95,00 ₾")).toBe(95);
    expect(parseAmount("1 234,50")).toBe(1234.5);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount(95.004)).toBe(95);
    expect(parseAmount("95 GEL")).toBe(95);
    expect(parseAmount("ninety")).toBeNull();
    expect(parseAmount(-5)).toBeNull();
  });

  it("the payment rule: |amount − total| < 1 matches, >= 1 does not (incl. rounding)", () => {
    expect(amountMatches(95, 95)).toBe(true);
    expect(amountMatches(94.01, 95)).toBe(true);
    expect(amountMatches(95.99, 95)).toBe(true);
    expect(amountMatches(94, 95)).toBe(false);
    expect(amountMatches(96, 95)).toBe(false);
    expect(amountMatches(94.004, 95)).toBe(false); // rounds to 94.00 → exactly 1 off
    expect(amountMatches(94.006, 95)).toBe(true); // rounds to 94.01
    expect(checkAmount(null, 95)).toBe("missing");
    expect(checkAmount(95, null)).toBe("no_total");
  });
});

describe("date rule (Tbilisi days)", () => {
  it("same day / later ok; before the order / in the future not; none = missing", () => {
    expect(checkDate("2026-11-01", ORDER_CREATED, SUNDAY_NOON)).toBe("ok");
    expect(checkDate("01.11.2026", ORDER_CREATED, SUNDAY_NOON)).toBe("ok");
    expect(checkDate("2026-10-31", ORDER_CREATED, SUNDAY_NOON)).toBe("before_order");
    expect(checkDate("2026-11-03", ORDER_CREATED, SUNDAY_NOON)).toBe("future");
    expect(checkDate(null, ORDER_CREATED, SUNDAY_NOON)).toBe("missing");
    expect(checkDate("yesterday", ORDER_CREATED, SUNDAY_NOON)).toBe("missing");
  });
  it("the order's day is its Tbilisi day; a day/month swap that fits is accepted", () => {
    // 21:30 UTC on Oct 31 = 01:30 on Nov 1 in Tbilisi
    expect(checkDate("2026-10-31", "2026-10-31T21:30:00Z", SUNDAY_NOON)).toBe("before_order");
    expect(checkDate("2026-11-01", "2026-10-31T21:30:00Z", SUNDAY_NOON)).toBe("ok");
    const later = new Date("2026-11-05T12:00:00+04:00");
    expect(checkDate("2026-05-11", "2026-11-04T08:00:00Z", later)).toBe("ok"); // 05.11 misread as May 11
  });
});

// ── verdicts ───────────────────────────────────────────────────────────────

describe("evaluateReceipt — the code decides, never the model", () => {
  const ev = (o: Partial<ReceiptFields>, total: number | null = 95) => evaluateReceipt(fields(o), total, ORDER_CREATED, SUNDAY_NOON);

  it("match", () => {
    const e = ev({});
    expect(e.verdict).toBe("match");
    expect(e.checks).toEqual({ iban: "ok", name: "ok", recipient: true, currency: "ok", amount: "ok", date: "ok" });
    expect(ev({ currency: null }).verdict).toBe("match"); // assumed GEL
    expect(ev({ recipient_name: "Somebody Else" }).verdict).toBe("match"); // the IBAN is the strong signal
    expect(ev({ recipient_iban: null, recipient_name: "Maika G" }).verdict).toBe("match");
    expect(ev({ recipient_iban: "GE13TB****0012", recipient_name: null }).verdict).toBe("match");
  });

  it("amount_mismatch (amount or currency)", () => {
    expect(ev({ amount: 90 }).verdict).toBe("amount_mismatch");
    expect(ev({ amount: 190 }).verdict).toBe("amount_mismatch");
    expect(ev({ currency: "USD" }).verdict).toBe("amount_mismatch");
    expect(ev({}, null).verdict).toBe("amount_mismatch"); // no total to compare with
  });

  it("wrong_recipient", () => {
    expect(ev({ recipient_iban: OTHER_IBAN }).verdict).toBe("wrong_recipient");
    expect(ev({ recipient_iban: OTHER_IBAN, recipient_name: "Maika G" }).verdict).toBe("wrong_recipient");
    expect(ev({ recipient_iban: null, recipient_name: "გიორგი" }).verdict).toBe("wrong_recipient");
    expect(ev({ recipient_iban: "GE13TB****0012", recipient_name: "გიორგი" }).verdict).toBe("wrong_recipient");
  });

  it("date_mismatch", () => {
    expect(ev({ date: "2026-10-20" }).verdict).toBe("date_mismatch");
    expect(ev({ date: "2026-12-20" }).verdict).toBe("date_mismatch");
    expect(ev({ date: null }).verdict).toBe("match");
  });

  it("unreadable: no amount, no recipient at all, or low confidence — before anything else", () => {
    expect(ev({ amount: null }).verdict).toBe("unreadable");
    expect(ev({ recipient_iban: null, recipient_name: null }).verdict).toBe("unreadable");
    expect(ev({ confidence: 0.2, recipient_iban: OTHER_IBAN }).verdict).toBe("unreadable");
  });

  it("the model's fields are re-validated", () => {
    const f = coerceReceiptFields({ is_receipt: "yes", amount: "95,00", confidence: 7, recipient_iban: "x".repeat(200), date: 5 });
    expect(f).toMatchObject({ is_receipt: false, amount: 95, confidence: 1, date: "5" });
    expect(f?.recipient_iban).toHaveLength(64);
    expect(coerceReceiptFields(null)).toBeNull();
    expect(coerceReceiptFields([1])).toBeNull();
  });
});

describe("texts (code-written, no PII)", () => {
  const back = operatorBack("sunday");
  it("match: the fixed text + when the operator is back", () => {
    const t = receiptReplyText("match", { amount: 95, currency: "GEL", expected: 95, back });
    expect(t.startsWith(RECEIPT_MATCH_TEXT)).toBe(true);
    expect(t).toContain(back);
    expect(receiptReplyText("match", { amount: 95, currency: "GEL", expected: 95, back: null })).toBe(RECEIPT_MATCH_TEXT);
    expect(RECEIPT_MATCH_TEXT).toBe("ქვითარი მივიღეთ, მადლობა! ოპერატორი გადაამოწმებს ჩარიცხვას და შეკვეთას წარმოებაში გავუშვებთ.");
  });
  it("amount_mismatch states both numbers", () => {
    const t = receiptReplyText("amount_mismatch", { amount: 90, currency: "GEL", expected: 95.5, back });
    expect(t).toContain("90 ₾");
    expect(t).toContain("95.50 ₾");
    expect(t).toContain("ოპერატორი");
    expect(receiptReplyText("amount_mismatch", { amount: 95, currency: "USD", expected: 95, back: null })).toContain("95 USD");
  });
  it("wrong_recipient repeats OUR account lines; unreadable asks for a clearer screenshot; date says so", () => {
    const t = receiptReplyText("wrong_recipient", { amount: 95, currency: "GEL", expected: 95, back });
    for (const l of BANK_LINES) expect(t).toContain(l);
    expect(t).not.toContain(OTHER_IBAN);
    expect(receiptReplyText("unreadable", { amount: null, currency: null, expected: 95, back })).toBe(RECEIPT_UNREADABLE_TEXT);
    expect(RECEIPT_UNREADABLE_TEXT).toContain("მკაფიო სქრინშოტი");
    expect(receiptReplyText("date_mismatch", { amount: 95, currency: "GEL", expected: 95, back })).toContain("თარიღი");
  });
});

describe("the admin note on the orders rows", () => {
  const rec = (o: Partial<ReceiptFields> = {}, total = 95) => {
    const e = evaluateReceipt(fields(o), total, ORDER_CREATED, SUNDAY_NOON);
    return { fields: fields(o), checks: e.checks, verdict: e.verdict, expected_total: total };
  };
  it("note per verdict", () => {
    expect(receiptNote(rec())).toBe("ქვითარი: 95₾ ✓ IBAN ✓ — ოპერატორმა დაადასტუროს");
    expect(receiptNote(rec({ amount: 90 }))).toBe("ქვითარი: 90₾ ✗ (შეკვეთა 95₾) IBAN ✓ — ოპერატორმა გადაამოწმოს");
    expect(receiptNote(rec({ recipient_iban: OTHER_IBAN, recipient_name: "X" }))).toBe("ქვითარი: 95₾ ✓ IBAN ✗ მიმღები ✗ — ოპერატორმა გადაამოწმოს");
    expect(receiptNote(rec({ amount: null }))).toBe("ქვითარი: ვერ წავიკითხე — ოპერატორმა ნახოს");
    expect(receiptNote(rec({ date: "2026-10-01" }))).toContain("თარიღი ✗");
  });
  it("append is idempotent and replaces the previous receipt line", () => {
    const base = "DM ბოტი · Messenger · შეკვეთა #11111111 · საბანკო გადარიცხვა\nესკიზი 1";
    const once = withReceiptNote(base, "ქვითარი: 95₾ ✓ IBAN ✓ — ოპერატორმა დაადასტუროს");
    expect(once).toBe(`${base}\nქვითარი: 95₾ ✓ IBAN ✓ — ოპერატორმა დაადასტუროს`);
    expect(withReceiptNote(once, "ქვითარი: 95₾ ✓ IBAN ✓ — ოპერატორმა დაადასტუროს")).toBe(once);
    const second = withReceiptNote(once, "ქვითარი: 90₾ ✗ IBAN ✓ — ოპერატორმა გადაამოწმოს");
    expect(second.match(/ქვითარი:/g)).toHaveLength(1);
    expect(second.endsWith("90₾ ✗ IBAN ✓ — ოპერატორმა გადაამოწმოს")).toBe(true);
    expect(withReceiptNote(null, "ქვითარი: x")).toBe("ქვითარი: x");
  });
});

// ── persistence: the copy is outside the 90-day purge ──────────────────────

describe("receipt copy vs the 90-day purge", () => {
  it("receipts/<cart_id>/<file>, never the source path", () => {
    const src = "messenger/2026-11/m_abc-0.jpg";
    expect(receiptCopyPath(CART, src)).toBe(`receipts/${CART}/m_abc-0.jpg`);
    expect(receiptCopyPath("../x", "a/b/../c.png")).toBe("receipts/x/c.png");
  });

  it("purgeExpired deletes only the paths on social_messages.attachments — the receipts/ copy is not one", async () => {
    const removed: string[] = [];
    const att: SocialAttachment[] = [{ type: "image", url: "https://x", path: "messenger/2026-07/m1-0.jpg", stored: true }];
    await purgeExpired(new Date("2026-11-01T00:00:00Z"), {
      listExpired: async () => [{ meta_message_id: "m1", attachments: att }],
      remove: async (p: string[]) => { removed.push(...p); return true; },
      patchAttachments: async () => true,
      log: () => {},
    });
    expect(removed).toEqual(["messenger/2026-07/m1-0.jpg"]);
    expect(removed.some((p) => p.startsWith("receipts/"))).toBe(false);
    expect(read("supabase/functions/meta-webhook/media.ts")).not.toContain("receipts/");
  });
});

// ── the step, with fakes ───────────────────────────────────────────────────

const img = (mid: string, p: string, sent_at = "2026-11-01T07:59:00.000Z"): ThreadRow => ({
  meta_message_id: mid, direction: "in", text: null, unsupported: false, sent_at,
  attachments: [{ type: "image", url: "https://cdn/x", path: p, stored: true }],
});

function draftOf(o: Partial<OrderDraft> = {}): OrderDraft {
  return {
    id: "d1", conversation_key: KEY, channel: "messenger", status: "awaiting_payment", items: [], lines: [],
    delivery_type: "pickup", delivery_price: 0, total: 95, customer: {}, receipt: null, cart_id: CART,
    created_at: "2026-10-31T09:00:00.000Z", updated_at: ORDER_CREATED, ...o,
  };
}

function world(opts: { reads?: (ReceiptFields | null)[]; total?: number } = {}) {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const drafts: OrderDraft[] = [draftOf()];
  const orders = [
    { id: "o1", cart_id: CART, total_price: 55, comment: "DM ბოტი · შეკვეთა #11111111\nესკიზი 1", payment_status: "unpaid", created_at: ORDER_CREATED },
    { id: "o2", cart_id: CART, total_price: (opts.total ?? 95) - 55, comment: "ესკიზი 1", payment_status: "unpaid", created_at: ORDER_CREATED },
  ];
  const queue = [...(opts.reads ?? [fields()])];
  const calls = { reads: 0, copies: [] as [string, string][], commentWrites: 0, downloads: 0 };
  const order: OrderDeps = {
    loadDraft: async () => clone(drafts.find((d) => ["collecting", "confirmed", "awaiting_payment", "receipt_received"].includes(d.status)) ?? null),
    createDraft: async () => null,
    updateDraft: async (id, patch, guard) => {
      const d = drafts.find((x) => x.id === id);
      if (!d || (guard?.status && d.status !== guard.status)) return false;
      Object.assign(d, clone(patch));
      return true;
    },
    insertOrders: async () => true,
    insertAttribution: async () => true,
    newId: () => "x",
    hashKey: async (s: string) => s,
  };
  const deps: ReceiptDeps = {
    readReceipt: async (_c, _k, url: string) => {
      calls.reads++;
      expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
      return queue.length > 0 ? queue.shift() ?? null : fields({ is_receipt: false });
    },
    downloadUpload: async () => { calls.downloads++; return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); },
    copyUpload: async (from: string, to: string) => { calls.copies.push([from, to]); return true; },
    orderTotal: async () => ({ total: orders.reduce((s, r) => s + r.total_price, 0), createdAt: ORDER_CREATED }),
    loadOrderComments: async () => orders.map((r) => ({ id: r.id, comment: r.comment })),
    updateOrderComment: async (id: string, comment: string) => {
      calls.commentWrites++;
      const r = orders.find((x) => x.id === id);
      if (r) r.comment = comment;
      return true;
    },
  };
  return { drafts, orders, order, deps, calls };
}

const input = (w: ReturnType<typeof world>, thread: ThreadRow[], now = SUNDAY_NOON): ReceiptInput => ({
  conversationKey: KEY, channel: "messenger", now, schedule: "sunday", thread, draft: JSON.parse(JSON.stringify(w.drafts[0])), log: () => {},
});

describe("runReceiptStep", () => {
  it("match: copy outside the purge, draft → receipt_received with the record, note on every row, one reply", async () => {
    const w = world();
    const r = await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps);
    expect(r.outcome).toBe("receipt_match");
    expect(r.messages?.[0].startsWith(RECEIPT_MATCH_TEXT)).toBe(true);
    expect(w.calls.copies).toEqual([["messenger/2026-11/m1-0.jpg", `receipts/${CART}/m1-0.jpg`]]);
    const d = w.drafts[0];
    expect(d.status).toBe("receipt_received");
    const rec = d.receipt as Record<string, unknown>;
    expect(rec).toMatchObject({ path: `receipts/${CART}/m1-0.jpg`, source_path: "messenger/2026-11/m1-0.jpg", message_id: "m1", verdict: "match", expected_total: 95, read_at: SUNDAY_NOON.toISOString() });
    expect(rec.checks).toMatchObject({ iban: "ok", amount: "ok" });
    expect(rec.reads).toHaveLength(1);
    expect(rec.checked).toEqual(["messenger/2026-11/m1-0.jpg"]);
    for (const o of w.orders) {
      expect(o.comment.endsWith("ქვითარი: 95₾ ✓ IBAN ✓ — ოპერატორმა დაადასტუროს")).toBe(true);
      expect(o.payment_status).toBe("unpaid"); // never touched
    }
  });

  it("the same image again is not re-read; the comment is not rewritten", async () => {
    const w = world();
    const thread = [img("m1", "messenger/2026-11/m1-0.jpg")];
    await runReceiptStep(input(w, thread), w.order, w.deps);
    const writes = w.calls.commentWrites;
    const again = await runReceiptStep(input(w, thread), w.order, w.deps);
    expect(again).toEqual({ messages: null, outcome: "no_image" });
    expect(w.calls.reads).toBe(1);
    expect(w.calls.commentWrites).toBe(writes);
  });

  it("a corrected receipt on receipt_received: the new one on top, the old one in history, one receipt line", async () => {
    const w = world({ reads: [fields({ amount: 90 }), fields()] });
    const r1 = await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps);
    expect(r1.outcome).toBe("receipt_amount_mismatch");
    expect(r1.messages?.[0]).toContain("90 ₾");
    expect(r1.messages?.[0]).toContain("95 ₾");
    expect(w.drafts[0].status).toBe("receipt_received");
    const r2 = await runReceiptStep(input(w, [img("m2", "messenger/2026-11/m2-0.jpg", "2026-11-01T08:10:00.000Z")]), w.order, w.deps);
    expect(r2.outcome).toBe("receipt_match");
    const rec = w.drafts[0].receipt as { verdict: string; history: { verdict: string }[] };
    expect(rec.verdict).toBe("match");
    expect(rec.history.map((h) => h.verdict)).toEqual(["amount_mismatch"]);
    expect(w.orders[0].comment.match(/ქვითარი:/g)).toHaveLength(1);
    expect(receiptSourcePaths(w.drafts[0].receipt)).toEqual(new Set(["messenger/2026-11/m2-0.jpg", "messenger/2026-11/m1-0.jpg"]));
  });

  it("wrong_recipient and unreadable; unreadable keeps the status", async () => {
    const w = world({ reads: [fields({ recipient_iban: OTHER_IBAN })] });
    const r = await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps);
    expect(r.outcome).toBe("receipt_wrong_recipient");
    for (const l of BANK_LINES) expect(r.messages?.[0]).toContain(l);

    const u = world({ reads: [fields({ amount: null })] });
    const ru = await runReceiptStep(input(u, [img("m1", "messenger/2026-11/m1-0.jpg")]), u.order, u.deps);
    expect(ru.messages).toEqual([RECEIPT_UNREADABLE_TEXT]);
    expect(u.drafts[0].status).toBe("awaiting_payment");
    expect((u.drafts[0].receipt as { verdict: string }).verdict).toBe("unreadable");
  });

  it("not a receipt → no messages (the normal reply runs), the read is counted and the image marked", async () => {
    const w = world({ reads: [fields({ is_receipt: false })] });
    const r = await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps);
    expect(r).toEqual({ messages: null, outcome: "not_receipt" });
    expect(w.drafts[0].status).toBe("awaiting_payment");
    expect(parseReceiptState(w.drafts[0].receipt)).toMatchObject({ reads: [SUNDAY_NOON.toISOString()], checked: ["messenger/2026-11/m1-0.jpg"] });
    expect((w.drafts[0].receipt as Record<string, unknown>).verdict).toBeUndefined();
    expect(w.calls.copies).toHaveLength(0);
  });

  it("read failure → normal reply, counted, not marked (a later run may retry)", async () => {
    const w = world({ reads: [null] });
    const r = await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps);
    expect(r.outcome).toBe("read_failed");
    expect(parseReceiptState(w.drafts[0].receipt)).toMatchObject({ checked: [] });
    expect(parseReceiptState(w.drafts[0].receipt).reads).toHaveLength(1);
  });

  it("cap: 3 reads per conversation per 24 h; older reads do not count", async () => {
    const w = world();
    const recent = new Date(SUNDAY_NOON.getTime() - 60 * 60 * 1000).toISOString();
    w.drafts[0].receipt = { history: [], checked: [], reads: [recent, recent, recent] };
    const r = await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps);
    expect(r).toEqual({ messages: null, outcome: "cap" });
    expect(w.calls.reads).toBe(0);
    const old = new Date(SUNDAY_NOON.getTime() - 25 * 60 * 60 * 1000).toISOString();
    w.drafts[0].receipt = { history: [], checked: [], reads: [old, old, old, recent, recent] };
    expect((await runReceiptStep(input(w, [img("m1", "messenger/2026-11/m1-0.jpg")]), w.order, w.deps)).outcome).toBe("receipt_match");
    expect(MAX_RECEIPT_READS).toBe(3);
  });

  it("several images: read until the receipt, at most the reads left", async () => {
    const w = world({ reads: [fields({ is_receipt: false }), fields()] });
    const thread = [img("m1", "messenger/2026-11/m1-0.jpg"), img("m2", "messenger/2026-11/m2-0.jpg")];
    const r = await runReceiptStep(input(w, thread), w.order, w.deps);
    expect(r.outcome).toBe("receipt_match");
    expect(w.calls.reads).toBe(2);
    expect((w.drafts[0].receipt as { message_id: string }).message_id).toBe("m2");
  });

  it("no order waiting / no stored image → nothing read", async () => {
    const w = world();
    w.drafts[0].status = "collecting";
    expect((await runReceiptStep(input(w, [img("m1", "p/m1.jpg")]), w.order, w.deps)).outcome).toBe("no_order");
    const w2 = world();
    const unstored: ThreadRow = { ...img("m1", "x.jpg"), attachments: [{ type: "image", url: "https://cdn/x" }] };
    expect((await runReceiptStep(input(w2, [unstored]), w2.order, w2.deps)).outcome).toBe("no_image");
    expect(w.calls.reads + w2.calls.reads).toBe(0);
  });

  it("candidates: only the current burst (after our last reply), stored, unread", () => {
    const out: ThreadRow = { meta_message_id: "o", direction: "out", text: "ok", attachments: [], unsupported: false, sent_at: "2026-11-01T07:59:30.000Z" };
    const thread = [img("m0", "p/m0.jpg"), out, img("m1", "p/m1.jpg"), img("m2", "p/m2.jpg")];
    expect(receiptCandidates(thread, ["p/m2.jpg"])).toEqual([{ path: "p/m1.jpg", mid: "m1" }]);
    expect(imageDataUrl("a/b.png", new Uint8Array([1, 2, 3]))).toBe("data:image/png;base64,AQID");
    expect(imageDataUrl("a/b.pdf", new Uint8Array([1]))).toBeNull();
  });

  it("state helpers keep the bookkeeping bounded", () => {
    let s = parseReceiptState(null);
    for (let i = 0; i < 30; i++) s = nextReceiptState(s, { at: `2026-11-01T00:00:${String(i).padStart(2, "0")}Z`, sourcePath: `p${i}` });
    expect(s.reads.length).toBeLessThanOrEqual(20);
    expect(s.checked).toHaveLength(30);
  });
});

// ── through runAutoReply: receipt vs design photo ──────────────────────────

const trigger: TriggerRow = {
  channel: "messenger", page_id: "159657880717306", customer_id: "psid1",
  meta_message_id: "m1", text: null, sent_at: "2026-11-01T07:59:00.000Z",
};

function autoDeps(w: ReturnType<typeof world>, thread: ThreadRow[], raws: string[] = ["მადლობა!"], withReceipt = true) {
  const sent: string[] = [];
  const asked: { content: string }[][] = [];
  const deps: AutoReplyDeps = {
    now: () => SUNDAY_NOON,
    sleep: async () => {},
    tokenSet: true,
    loadSettings: async () => ({ enabled: true, schedule: "sunday" }),
    isHandedOff: async () => false,
    insertHandoff: async () => {},
    loadThread: async () => thread,
    loadOutRows: async () => [],
    loadBotSends: async () => [],
    recordSend: async () => `r${sent.length}`,
    markSent: async () => {},
    askBot: async (_c, _k, history) => { asked.push(history); return raws.shift() ?? null; },
    send: async (_c, _to, text) => { sent.push(text); return { ok: true, messageId: `mid${sent.length}` }; },
    log: () => {},
    order: w.order,
    ...(withReceipt ? { receipt: w.deps } : {}),
  };
  return { deps, sent, asked };
}

describe("runAutoReply with receipts", () => {
  beforeEach(() => _resetTokenWarning());

  it("an order waits + a receipt image → the code's reply, the model is not asked", async () => {
    const w = world();
    const a = autoDeps(w, [img("m1", "messenger/2026-11/m1-0.jpg")]);
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(a.asked).toHaveLength(0);
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0].startsWith(RECEIPT_MATCH_TEXT)).toBe(true);
    expect(a.sent[0]).toContain(operatorBack("sunday"));
    expect(w.drafts[0].status).toBe("receipt_received");
  });

  it("not a receipt → the model gets the photo as before", async () => {
    const w = world({ reads: [fields({ is_receipt: false })] });
    const a = autoDeps(w, [img("m1", "messenger/2026-11/m1-0.jpg")], ["ლამაზი ფოტოა"]);
    await runAutoReply(trigger, a.deps);
    expect(w.calls.reads).toBe(1);
    expect(a.asked).toHaveLength(1);
    expect(a.asked[0].some((t) => t.content.includes("[ფოტო 1]"))).toBe(true);
    expect(a.sent).toEqual(["ლამაზი ფოტოა"]);
  });

  it("no receipt deps → exactly as before (no read)", async () => {
    const w = world();
    const a = autoDeps(w, [img("m1", "messenger/2026-11/m1-0.jpg")], ["x"], false);
    await runAutoReply(trigger, a.deps);
    expect(w.calls.reads).toBe(0);
    expect(a.asked).toHaveLength(1);
  });

  it("a collecting draft → no receipt read (a design photo before any order)", async () => {
    const w = world();
    w.drafts[0].status = "collecting";
    w.drafts[0].cart_id = null;
    const a = autoDeps(w, [img("m1", "messenger/2026-11/m1-0.jpg")], ["x"]);
    await runAutoReply(trigger, a.deps);
    expect(w.calls.reads).toBe(0);
    expect(a.asked).toHaveLength(1);
  });

  it("a photo already taken as a receipt is never placed on a product", async () => {
    const w = world();
    const thread = [img("m1", "messenger/2026-11/m1-0.jpg")];
    await runAutoReply(trigger, autoDeps(w, thread).deps);
    // later: the customer asks something, the model (wrongly) emits a photo block for [ფოტო 1]
    const out: ThreadRow = { meta_message_id: "o1", direction: "out", text: "ქვითარი მივიღეთ", attachments: [], unsupported: false, sent_at: "2026-11-01T08:00:30.000Z" };
    const q: ThreadRow = { meta_message_id: "m2", direction: "in", text: "ეს მაისურზე დამიბეჭდე", attachments: [], unsupported: false, sent_at: "2026-11-01T08:01:00.000Z" };
    const block = "```maika-mockup\n" + JSON.stringify({ photo: 1, product: "T-Shirt", subProduct: "GILDAN", color: "White", side: "front" }) + "\n```";
    const images: string[] = [];
    const b = autoDeps(w, [...thread, out, q], [`კარგი\n${block}`]);
    b.deps.sketch = {
      countSketches: async () => ({ generate: 0, text: 0 }),
      generateDesign: async () => null,
      fetchImage: async () => null,
      loadFont: async () => null,
      decodeJpeg: () => { throw new Error("no"); },
      encodeJpeg: () => new Uint8Array(),
      upload: async () => null,
      hashKey: async () => "h",
      sendImage: async (_c, _to, url: string) => { images.push(url); return { ok: true, messageId: "i" }; },
      downloadUpload: async () => { images.push("download"); return null; },
    };
    await runAutoReply({ ...trigger, meta_message_id: "m2", sent_at: q.sent_at }, b.deps);
    expect(images).toEqual([]);
    // no sketch for it: the block falls back to the usual link line, nothing is downloaded or sent as an image
    expect(b.sent).toEqual(["კარგი\nდიზაინის სანახავად: https://maika.ge/chat"]);
  });
});

// ── gemini-proxy: read-receipt ─────────────────────────────────────────────

describe("gemini-proxy read-receipt", () => {
  const SRK = "service-role-key";
  it("trusted social call only", () => {
    expect(resolveTrustedSocialReceipt("read-receipt", "messenger", `Bearer ${SRK}`, SRK)).toBe("messenger");
    expect(resolveTrustedSocialReceipt("read-receipt", "instagram", `Bearer ${SRK}`, SRK)).toBe("instagram");
    expect(resolveTrustedSocialReceipt("read-receipt", "messenger", "Bearer anon-key", SRK)).toBeNull();
    expect(resolveTrustedSocialReceipt("read-receipt", undefined, `Bearer ${SRK}`, SRK)).toBeNull();
    expect(resolveTrustedSocialReceipt("read-receipt", "messenger", null, SRK)).toBeNull();
    expect(resolveTrustedSocialReceipt("read-receipt", "messenger", `Bearer ${SRK}`, "")).toBeNull();
    expect(resolveTrustedSocialReceipt("faq-chat", "messenger", `Bearer ${SRK}`, SRK)).toBeNull();
  });

  it("request body: the cheap flash model, the image, a forced function call", () => {
    const body = receiptRequestBody("data:image/png;base64,AAAA") as { model: string; messages: { content: unknown }[]; tool_choice: unknown; tools: unknown[] };
    expect(body.model).toBe(RECEIPT_MODEL);
    expect(RECEIPT_MODEL).toBe("google/gemini-3-flash-preview");
    expect(JSON.stringify(body.messages[1].content)).toContain("data:image/png;base64,AAAA");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "report_receipt" } });
    expect(body.tools).toHaveLength(1);
    expect(isReceiptImage("data:image/jpeg;base64,/9j/")).toBe(true);
    expect(isReceiptImage("https://x/y.jpg")).toBe(false);
    expect(isReceiptImage("data:text/html;base64,AAAA")).toBe(false);
    expect(isReceiptImage(`data:image/png;base64,${"A".repeat(14_000_001)}`)).toBe(false);
  });

  it("parses the function call, or a JSON object in the content; junk → null", () => {
    const viaTool = { choices: [{ message: { tool_calls: [{ function: { name: "report_receipt", arguments: JSON.stringify({ is_receipt: true, amount: "95,00", currency: "GEL", confidence: 0.9, recipient_iban: TBC_SPACED }) } }] } }] };
    expect(parseReceiptResponse(viaTool)).toMatchObject({ is_receipt: true, amount: 95, currency: "GEL", confidence: 0.9, recipient_iban: TBC_SPACED, recipient_name: null });
    const viaContent = { choices: [{ message: { content: "```json\n{\"is_receipt\": false, \"confidence\": 0.8}\n```" } }] };
    expect(parseReceiptResponse(viaContent)).toMatchObject({ is_receipt: false, amount: null });
    expect(parseReceiptResponse({ choices: [{ message: { content: "not json" } }] })).toBeNull();
    expect(parseReceiptResponse({ choices: [{ message: { tool_calls: [{ function: { arguments: "{bad" } }] } }] })).toBeNull();
    expect(parseReceiptResponse({ choices: [{ message: { content: "{\"amount\": 5}" } }] })).toBeNull(); // no is_receipt
    expect(parseReceiptResponse(null)).toBeNull();
  });

  const SRC = read("supabase/functions/gemini-proxy/index.ts");
  it("index.ts: ONE add-only else-if branch, before the Unknown-action fallback, trusted check before any fetch", () => {
    expect(SRC.match(/action === "read-receipt"/g)).toHaveLength(1);
    const start = SRC.indexOf('} else if (action === "read-receipt") {');
    const end = SRC.indexOf('} else {\n      return new Response(JSON.stringify({ error: "Unknown action" })');
    expect(start).toBeGreaterThan(SRC.indexOf('} else if (action === "social-reply-draft") {'));
    expect(end).toBeGreaterThan(start);
    const branch = SRC.slice(start, end);
    const refuse = branch.indexOf('if (!rrChannel) return rrJson(403');
    expect(refuse).toBeGreaterThan(-1);
    expect(branch.indexOf("resolveTrustedSocialReceipt(")).toBeLessThan(refuse);
    expect(branch.indexOf("fetch(")).toBeGreaterThan(refuse);
    expect(branch.indexOf("logAiCall(")).toBeGreaterThan(-1);
    expect(branch).toContain("return rrJson(200, { receipt: rrRead, model: RECEIPT_MODEL });");
    // never logs what was read
    expect(branch).not.toMatch(/console\.\w+\([^)]*rrRead\.(amount|recipient|sender|date)/);
  });

  it("index.ts: not billable, not a text action, and the existing handlers are still there", () => {
    const billable = /const BILLABLE_ACTIONS = new Set\(\[(.*)\]\);/.exec(SRC)?.[1] ?? "";
    const text = /const TEXT_ACTIONS = new Set\(\[(.*)\]\);/.exec(SRC)?.[1] ?? "";
    expect(billable).not.toContain("read-receipt");
    expect(text).not.toContain("read-receipt");
    for (const a of ["generate-design-gpt", "probe-image-model", "probe-image-edit"]) {
      expect(SRC).toContain(`if (action === "${a}") {`);
    }
    for (const a of ["generate-design", "convert-bg-black", "upscale", "isolate-subject", "restyle", "edit-image", "isolate-design", "edit-image-cutout", "randomize-prompt", "virtual-tryon", "faq-chat", "social-reply-draft"]) {
      expect(SRC).toContain(`action === "${a}") {`);
    }
    // the model is one the file already used before this branch
    expect(SRC.indexOf('"google/gemini-3-flash-preview"')).toBeLessThan(SRC.indexOf('action === "read-receipt"'));
  });

  it("meta-webhook calls it as the trusted social call, with the conversation key", () => {
    const wh = read("supabase/functions/meta-webhook/index.ts");
    expect(wh).toContain('body: JSON.stringify({ action: "read-receipt", params: { image, channel, session_id: conversationKey } }),');
    expect(wh).toContain("headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, \"Content-Type\": \"application/json\" },");
    expect(wh).toContain("receipt: receiptDeps(admin),");
    // the only orders write is the comment
    expect(wh).toContain('.from("orders").update({ comment }).eq("id", id)');
    expect(wh).not.toMatch(/payment_status:\s*"paid"/);
  });
});

// ── admin view ─────────────────────────────────────────────────────────────

describe("admin receipt view", () => {
  it("draft.receipt → what the order detail shows", () => {
    const e = evaluateReceipt(fields({ amount: 90 }), 95, ORDER_CREATED, SUNDAY_NOON);
    const stored = nextReceiptState(parseReceiptState(null), { at: SUNDAY_NOON.toISOString(), sourcePath: "s.jpg" }, {
      path: `receipts/${CART}/s.jpg`, source_path: "s.jpg", message_id: "m1", fields: fields({ amount: 90 }), checks: e.checks,
      expected_total: 95, verdict: e.verdict, read_at: SUNDAY_NOON.toISOString(),
    });
    const v = parseReceiptView(JSON.parse(JSON.stringify(stored)));
    expect(v).toMatchObject({ path: `receipts/${CART}/s.jpg`, verdict: "amount_mismatch", amount: 90, expectedTotal: 95, amountOk: false, ibanOk: true, earlier: 0 });
    expect(verdictTone("match")).toBe("ok");
    expect(verdictTone("amount_mismatch")).toBe("bad");
    expect(parseReceiptView({ reads: ["x"], checked: [] })).toBeNull(); // reads only, no receipt yet
    expect(parseReceiptView(null)).toBeNull();
    expect(parseReceiptView({ verdict: "paid!" })).toBeNull();
  });

  it("AdminOrders shows it on bank_transfer orders only; the payment control is unchanged", () => {
    const src = read("src/components/admin/AdminOrders.tsx");
    expect(src).toContain('{order.payment_provider === "bank_transfer" && order.cart_id && (\n                    <OrderReceipt cartId={order.cart_id} />');
    expect(src).toContain('<Select value={order.payment_status} onValueChange={v => updateOrderGroup(group.rows, "payment_status", v)}>');
    const comp = read("src/components/admin/OrderReceipt.tsx");
    expect(comp).toContain(".createSignedUrl(v.path, SIGNED_URL_TTL_SECONDS)");
    expect(comp).not.toContain("payment_status");
    expect(comp).not.toContain(".update(");
  });
});
