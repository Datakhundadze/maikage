// @vitest-environment node
//
// DM orders (meta-webhook orderDraft / orderFlow / orderContacts / printFile):
// copies staying identical to their sources, sketch → item grouping, the
// history note, the maika-order block, missing-info questions, prices
// recomputed in code (two sides small / big, delivery, bag fee), the texts,
// the `orders` rows, idempotent creation, print files, PII capture, and the
// whole run through runAutoReply with fakes.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { calculatePrice } from "@/lib/pricing";
import { BAG_FEE } from "@/lib/fees";
import { BRAND_SIZES as SITE_BRAND_SIZES } from "@/lib/catalog";
import { translations } from "@/lib/i18n";
import { BRAND_SIZES, COLOR_KA, PRODUCT_KA, needsSize, resolveSize } from "../../supabase/functions/meta-webhook/orderCatalog";
import { extractContacts, mergeContacts } from "../../supabase/functions/meta-webhook/orderContacts";
import { redactPii } from "../../supabase/functions/meta-webhook/redactPii";
import {
  addSketch,
  orderRef,
  orderStatusNote,
  sideFromPlan,
  sketchesNote,
  withDraftNote,
  type DraftItem,
  type OrderDraft,
} from "../../supabase/functions/meta-webhook/orderDraft";
import {
  BANK_LINES,
  CONFIRM_WORD,
  ORDER_FAILED_TEXT,
  attributionRows,
  backSizeOf,
  bankText,
  buildOrderRows,
  hasOrderBlock,
  missingText,
  parseOrderBlock,
  previewText,
  recordSketches,
  resolveOrder,
  rowId,
  runOrderBlock,
  splitName,
  type OrderBlock,
  type OrderDeps,
  type PricedOrder,
} from "../../supabase/functions/meta-webhook/orderFlow";
import { PRINT_TEXT_WIDTH, imageSize, makePrintFile, printFolder, renderPrintText, type PrintDeps } from "../../supabase/functions/meta-webhook/printFile";
import { planSketches, type RenderPlan } from "../../supabase/functions/meta-webhook/sketchParse";
import { cleanBotReply, stripSketchSystemText, type ThreadRow } from "../../supabase/functions/meta-webhook/botReply";
import { decodePng, type RgbaImage } from "../../supabase/functions/meta-webhook/pngDecode";
import { encodePng } from "../../supabase/functions/meta-webhook/pngEncode";
import { createImage, type FontLike, type PathCommand } from "../../supabase/functions/meta-webhook/sketchRaster";
import { sha256Hex } from "../../supabase/functions/meta-webhook/sketchFont";
import { parseDelivery, type SocialMessageRow } from "../../supabase/functions/meta-webhook/handler";
import { _resetTokenWarning, runAutoReply, type AutoReplyDeps, type TriggerRow } from "../../supabase/functions/meta-webhook/autoReply";
import type { SketchDeps } from "../../supabase/functions/meta-webhook/sketchFlow";
import { redactOrderBlockForLog, socialOrdersOn, socialPromptBlock, withSocialBlock } from "../../supabase/functions/gemini-proxy/socialChannel";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SUNDAY_NOON = new Date("2026-11-01T12:00:00+04:00");
const KEY = "messenger:159657880717306:psid1";

const GEN = (o: Record<string, unknown>) => `\`\`\`maika-generate\n${JSON.stringify(o)}\n\`\`\``;
const MOCK = (o: Record<string, unknown>) => `\`\`\`maika-mockup\n${JSON.stringify(o)}\n\`\`\``;
const ORDER = (o: Record<string, unknown>) => `კარგი!\n\`\`\`maika-order\n${JSON.stringify(o)}\n\`\`\``;

function plan(raw: string, photos: { paths: (string | null)[]; pending: number[] } = { paths: [], pending: [] }): RenderPlan {
  const p = planSketches(raw, photos, 5)[0];
  if (!p || p.kind === "unsupported") throw new Error(`no plan: ${raw}`);
  return p;
}

/** Items built the way the bot builds them: one sketch at a time. */
function itemsFrom(...entries: { raw: string; url: string; photos?: { paths: (string | null)[]; pending: number[] }; cacheKey?: string }[]): DraftItem[] {
  let items: DraftItem[] = [];
  for (const e of entries) {
    const { target, side } = sideFromPlan(plan(e.raw, e.photos), e.url, "2026-11-01T08:00:00.000Z", { cacheKey: e.cacheKey });
    items = addSketch(items, target, side).items;
  }
  return items;
}

const BLACK_TEE_FRONT_LION = GEN({ prompt: "ლომი", product: "GILDAN", color: "Black", side: "front" });
const BLACK_TEE_BACK_NAME = MOCK({ text: "გიორგი", product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "back" });
const WHITE_HOODIE_FRONT_PHOTO = MOCK({ photo: 1, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "White", side: "front" });
const WHITE_HOODIE_BACK_PHOTO = MOCK({ photo: 1, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "White", side: "back" });
const PHOTOS = { paths: ["messenger/m1/0.jpg"], pending: [] };

// ── copies stay identical to their sources ─────────────────────────────────

describe("copies inside meta-webhook stay identical to the site / gemini-proxy", () => {
  it("bankAccountsCopy.ts is byte-for-byte gemini-proxy/bankAccounts.ts below its header", () => {
    const original = read("supabase/functions/gemini-proxy/bankAccounts.ts");
    const copy = read("supabase/functions/meta-webhook/bankAccountsCopy.ts");
    const marker = "// ── end of header ──\n";
    expect(copy.slice(copy.indexOf(marker) + marker.length)).toBe(original);
  });

  it("the bank lines of the recap are lines the FAQ KB itself gives", () => {
    const kb = read("supabase/functions/gemini-proxy/index.ts");
    for (const line of BANK_LINES) expect(kb).toContain(line);
  });

  it("BRAND_SIZES and the Georgian labels equal the site's", () => {
    expect(BRAND_SIZES).toEqual(SITE_BRAND_SIZES);
    expect(COLOR_KA).toEqual(translations.ge.colors);
    expect(PRODUCT_KA).toEqual(translations.ge.products);
  });
});

describe("sizes", () => {
  it("resolves the customer's spelling to the brand's sizes only", () => {
    expect(resolveSize("T-Shirt", "GILDAN", "xl")).toBe("XL");
    expect(resolveSize("T-Shirt", "GILDAN", "3XL")).toBe("XXXL");
    expect(resolveSize("Hoodie", "GILDAN Hoodie", "XXXL")).toBeNull(); // the hoodie stops at XXL
    expect(resolveSize("T-Shirt", "GILDAN KIDS", "5/6")).toBe("5/6 წელი");
    expect(resolveSize("T-Shirt", "GILDAN KIDS", "5/6 წელი")).toBe("5/6 წელი");
    expect(resolveSize("Phone Case", "Phone Case", "iPhone 15")).toBe("iPhone 15");
    expect(needsSize("T-Shirt", "Oversize")).toBe(false);
    expect(needsSize("Mug", "Mug")).toBe(false);
    expect(needsSize("Phone Case", "Phone Case")).toBe(true);
  });
});

// ── PII capture ────────────────────────────────────────────────────────────

describe("contacts from the RAW text", () => {
  it("captures what redactPii masks, and nothing of ours", () => {
    const raw = "ნომერი 577 12 34 56, ან +995 599 11 22 33; მეილი Giorgi.K@gmail.com. თქვენი 599 05 08 07 ვიცი, info@maika.ge";
    const c = extractContacts(raw);
    expect(c.phones).toEqual(["577123456", "+995599112233"]);
    expect(c.emails).toEqual(["giorgi.k@gmail.com"]);
    const masked = redactPii(raw);
    expect((masked.match(/\[phone:/g) ?? []).length).toBe(c.phones.length);
    expect((masked.match(/\[email:/g) ?? []).length).toBe(c.emails.length);
  });

  it("dates, prices and quantities are not phones; the last number wins", () => {
    expect(extractContacts("2026-08-21, 45 ₾, 3 ცალი").phones).toEqual([]);
    expect(mergeContacts({ name: "ა" }, extractContacts("555111222 არა, 555333444"))).toEqual({ name: "ა", phone: "555333444" });
  });

  it("handler: the row is masked, the contacts ride beside it (inbound only)", () => {
    const ev = (mid: string, echo: boolean) => ({
      sender: { id: echo ? "PAGE" : "PSID" }, recipient: { id: echo ? "PSID" : "PAGE" }, timestamp: 1758600000000,
      message: { mid, text: "ჩემი ნომერია 577 12 34 56", ...(echo ? { is_echo: true } : {}) },
    });
    const out = parseDelivery({ object: "page", entry: [{ id: "PAGE", time: 1, messaging: [ev("m_in", false), ev("m_out", true)] }] });
    expect(out.rows.map((r: SocialMessageRow) => r.text)).toEqual(["ჩემი ნომერია [phone:***56]", "ჩემი ნომერია [phone:***56]"]);
    expect(out.contacts.get("m_in")).toEqual({ phones: ["577123456"], emails: [] });
    expect(out.contacts.has("m_out")).toBe(false);
  });
});

// ── grouping ───────────────────────────────────────────────────────────────

describe("sketch → draft items", () => {
  it("front + back of the same product / brand / colour = one item with two sides", () => {
    const items = itemsFrom({ raw: BLACK_TEE_FRONT_LION, url: "u/f.jpg", cacheKey: "k1" }, { raw: BLACK_TEE_BACK_NAME, url: "u/b.jpg" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product: "T-Shirt", subProduct: "GILDAN", color: "Black" });
    expect(items[0].sides.front).toMatchObject({ kind: "generate", prompt: "ლომი", cacheKey: "k1", sketchUrl: "u/f.jpg" });
    expect(items[0].sides.back).toMatchObject({ kind: "text", text: "გიორგი", sketchUrl: "u/b.jpg" });
  });

  it("the same design re-sent (bigger) replaces its side; a different one starts a new item", () => {
    const bigger = MOCK({ text: "გიორგი", product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "back", size: "large" });
    const other = MOCK({ text: "ნინო", product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "back" });
    const items = itemsFrom(
      { raw: BLACK_TEE_FRONT_LION, url: "1" }, { raw: BLACK_TEE_BACK_NAME, url: "2" },
      { raw: bigger, url: "3" }, { raw: other, url: "4" },
    );
    expect(items).toHaveLength(2);
    expect(items[0].sides.back).toMatchObject({ text: "გიორგი", size: "large", sketchUrl: "3" });
    expect(items[1].sides).toEqual({ back: expect.objectContaining({ text: "ნინო", sketchUrl: "4" }) });
  });

  it("another colour is another item; photo sides keep the private path; mugs are front only", () => {
    const items = itemsFrom(
      { raw: BLACK_TEE_FRONT_LION, url: "1" },
      { raw: GEN({ prompt: "ლომი", product: "GILDAN", color: "White" }), url: "2" },
      { raw: WHITE_HOODIE_FRONT_PHOTO, url: "3", photos: PHOTOS },
      { raw: MOCK({ text: "ანა", product: "Mug", side: "back" }), url: "4" },
    );
    expect(items.map((i) => `${i.product}/${i.color}`)).toEqual(["T-Shirt/Black", "T-Shirt/White", "Hoodie/White", "Mug/White"]);
    expect(items[2].sides.front).toMatchObject({ kind: "photo", photo: 1, photoPath: "messenger/m1/0.jpg" });
    expect(Object.keys(items[3].sides)).toEqual(["front"]);
  });
});

describe("what the model is told", () => {
  const items = itemsFrom({ raw: BLACK_TEE_FRONT_LION, url: "1" }, { raw: BLACK_TEE_BACK_NAME, url: "2" });

  it("one tag per item, on our side right before the customer's burst", () => {
    const note = sketchesNote(items);
    expect(note).toBe('[ესკიზი 1: მაისური GILDAN, შავი — წინ: ნახატი „ლომი"; ზურგი: წარწერა „გიორგი"]');
    const turns = withDraftNote([
      { role: "user", content: "ლომი მინდა" }, { role: "assistant", content: "აი იდეა" },
      { role: "user", content: "შევუკვეთავ" }, { role: "user", content: "M ზომა" },
    ], note);
    expect(turns[1].content).toBe(`აი იდეა\n${note}`);
    expect(turns[turns.length - 1]).toEqual({ role: "user", content: "M ზომა" });
    expect(withDraftNote([{ role: "user", content: "x" }], note)).toEqual([{ role: "assistant", content: note }, { role: "user", content: "x" }]);
  });

  it("a confirmed draft adds the order line", () => {
    expect(orderStatusNote({ status: "awaiting_payment", cart_id: "abcdef12-3456-4000-8000-000000000000", total: 92 }))
      .toBe("[შეკვეთა #ABCDEF12 გაფორმებულია, ელოდება გადარიცხვას — სულ 92 ₾]");
    expect(orderStatusNote({ status: "collecting", cart_id: null, total: null })).toBe("");
  });

  it("the tags and the order block never reach the customer", () => {
    const raw = `[ესკიზი 1: მაისური GILDAN, შავი — წინ: ნახატი „ლომი"]\nკარგი 🙌 [შეკვეთა #AB12 გაფორმებულია]\n${ORDER({ confirm: false, items: [] })}`;
    expect(stripSketchSystemText("[ესკიზი 2: x] ტექსტი")).toBe("ტექსტი");
    const clean = cleanBotReply(raw);
    expect(clean).not.toMatch(/ესკიზი 1|შეკვეთა #|maika-order/);
    expect(clean).toContain("კარგი");
  });
});

// ── the block, missing info, prices ────────────────────────────────────────

describe("maika-order block", () => {
  it("parses leniently; the status block is not an order block", () => {
    const b = parseOrderBlock(ORDER({ confirm: "true", items: [{ item: 2, size: "xl", quantity: "3" }, { sketch: 0 }], delivery: "region", name: "  ნინო   ბერიძე ", address: "ქუთაისი" }))!;
    expect(b).toEqual({ confirm: true, lines: [{ item: 2, size: "xl", qty: 3 }], delivery: "courier_outside", name: "ნინო ბერიძე", address: "ქუთაისი" });
    expect(hasOrderBlock("```maika-order-status\n{}\n```")).toBe(false);
    expect(parseOrderBlock("```maika-order\nnot json\n```")).toBeNull();
  });
});

const block = (o: Partial<OrderBlock>): OrderBlock => ({ confirm: false, lines: [], delivery: null, name: null, address: null, ...o });

describe("resolveOrder", () => {
  const items = itemsFrom(
    { raw: BLACK_TEE_FRONT_LION, url: "f1" }, { raw: BLACK_TEE_BACK_NAME, url: "b1" },
    { raw: WHITE_HOODIE_FRONT_PHOTO, url: "f2", photos: PHOTOS }, { raw: WHITE_HOODIE_BACK_PHOTO, url: "b2", photos: PHOTOS },
  );

  it("asks for everything that is missing, sizes from the brand's list", () => {
    const r = resolveOrder(items, {}, block({ lines: [{ item: 1, size: null, qty: 1 }, { item: 9, size: "M", qty: 1 }], delivery: "courier_tbilisi" }));
    expect("missing" in r && r.missing.map((m) => m.kind)).toEqual(["size", "unknown_item", "name", "phone", "address"]);
    const text = missingText("missing" in r ? r.missing : [], items);
    expect(text).toContain("ზომა — ესკიზი 1 (მაისური GILDAN, შავი): S, M, L, XL, XXL, XXXL, XXXXL");
    expect(text).toContain("ტელეფონის ნომერი");
    expect(text).toContain("მიწოდების მისამართი");
    expect(missingText([{ kind: "no_items" }], [])).toContain("ჯერ დიზაინი");
  });

  it("prices in code: text back = small, photo back = big, delivery and the bag fee once", () => {
    const r = resolveOrder(items, { phone: "577123456" }, block({
      lines: [{ item: 1, size: "M", qty: 2 }, { item: 2, size: "L", qty: 1 }, { item: 1, size: "m", qty: 1 }],
      delivery: "courier_tbilisi", name: "გიორგი ბერიძე", address: "თბილისი, ვაჟა-ფშაველას 1",
    }));
    if ("missing" in r) throw new Error("missing");
    const o = r.order;
    const tee = calculatePrice("T-Shirt", "GILDAN", true, true, false, "small").total;
    const hoodie = calculatePrice("Hoodie", "GILDAN Hoodie", true, true, false, "big").total;
    expect(o.lines.map((l) => [l.item, l.size, l.qty, l.backSize, l.unitPrice])).toEqual([[1, "M", 3, "small", tee], [2, "L", 1, "big", hoodie]]);
    expect(o.total).toBe(tee * 3 + hoodie + 8 + BAG_FEE);
    expect(backSizeOf(undefined)).toBe("big");
    const preview = previewText(o);
    expect(preview).toContain(`× 3 — ${tee} ₾ × 3 = ${tee * 3} ₾`);
    expect(preview).toContain("მიწოდება: კურიერი თბილისში — 8 ₾");
    expect(preview).toContain("ჩანთა — 1 ₾");
    expect(preview).toContain(`სულ: ${o.total} ₾`);
    expect(preview).toContain(CONFIRM_WORD);
  });

  it("a number the model writes is never read", () => {
    const b = parseOrderBlock(ORDER({ items: [{ sketch: 1, size: "M", qty: 1, price: 1 }], total: 1, delivery: "pickup", name: "ა ბ" }))!;
    const r = resolveOrder(items, { phone: "577123456" }, b);
    if ("missing" in r) throw new Error("missing");
    expect(r.order.total).toBe(calculatePrice("T-Shirt", "GILDAN", true, true, false, "small").total + BAG_FEE);
  });
});

// ── rows ───────────────────────────────────────────────────────────────────

describe("orders rows", () => {
  const items = itemsFrom({ raw: BLACK_TEE_FRONT_LION, url: "https://s/f1.jpg" }, { raw: BLACK_TEE_BACK_NAME, url: "https://s/b1.jpg" });
  items[0].sides.front!.printUrl = "https://s/print-front.png";
  const priced = (): PricedOrder => {
    const r = resolveOrder(items, { phone: "577123456", email: "a@b.ge" }, block({ lines: [{ item: 1, size: "M", qty: 3 }], delivery: "courier_outside", name: "ნინო მარია ბერიძე", address: "ბათუმი" }));
    if ("missing" in r) throw new Error("missing");
    return r.order;
  };
  const CART = "11111111-2222-4333-8444-555555555555";

  it("one row per unit, the site's shape; SUM(total_price) = total; deterministic ids", async () => {
    const o = priced();
    const rows = await buildOrderRows(o, { channel: "instagram", cartId: CART, hash: sha256Hex });
    expect(rows).toHaveLength(3);
    expect(rows.reduce((n, r) => n + (r.total_price as number), 0)).toBe(o.total);
    expect(rows[0]).toMatchObject({ delivery_price: 12, total_price: o.lines[0].unitPrice + 12 + BAG_FEE });
    expect(rows[1]).toMatchObject({ delivery_price: 0, total_price: o.lines[0].unitPrice });
    expect(rows[0]).toMatchObject({
      first_name: "ნინო", last_name: "მარია ბერიძე", email: "a@b.ge", phone: "577123456",
      delivery_type: "courier_outside", delivery_address: "ბათუმი", product: "T-Shirt", sub_product: "GILDAN", color: "Black",
      size: "M", is_studio: false, status: "pending", payment_status: "unpaid", payment_provider: "bank_transfer", bog_order_id: null,
      front_mockup_url: "https://s/f1.jpg", back_mockup_url: "https://s/b1.jpg",
      transparent_image_url: "https://s/print-front.png", back_transparent_image_url: null, cart_id: CART, design_state: null, user_id: null,
    });
    expect(String(rows[0].comment)).toContain("DM ბოტი · Instagram · შეკვეთა #11111111");
    expect(String(rows[0].comment)).toContain("პრინტ ფაილი ოპერატორმა გაიტანოს");
    expect(String(rows[0].prompt)).toContain("ტექსტი: გიორგი");
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows[0].id).toBe(await rowId(CART, 0, sha256Hex));
    expect(String(rows[0].id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(attributionRows(rows, "instagram", "T")[0]).toEqual({ order_id: rows[0].id, cart_id: CART, manual_channel: "instagram", manual_note: "bot", manual_set_at: "T" });
    expect(splitName("ნინო")).toEqual({ first: "ნინო", last: "" });
  });

  it("pickup: no address on the rows; missing email is ''", async () => {
    const r = resolveOrder(items, { phone: "577123456", address: "ძველი" }, block({ lines: [{ item: 1, size: "S", qty: 1 }], delivery: "pickup", name: "ა" }));
    if ("missing" in r) throw new Error("missing");
    const rows = await buildOrderRows(r.order, { channel: "messenger", cartId: CART, hash: sha256Hex });
    expect(rows[0]).toMatchObject({ delivery_address: null, email: "", delivery_price: 0, total_price: r.order.lines[0].unitPrice + BAG_FEE });
  });

  it("bank text: the KB's accounts, the total and the order number", () => {
    const t = bankText(92, CART);
    for (const l of BANK_LINES) expect(t).toContain(l);
    expect(t).toContain("92 ₾");
    expect(t).toContain(`#${orderRef(CART)}`);
    expect(t).toContain("ქვითარი");
  });
});

// ── the flow, idempotent ───────────────────────────────────────────────────

function fakeDb() {
  const OPEN = ["collecting", "confirmed", "awaiting_payment", "receipt_received"];
  const drafts: OrderDraft[] = [];
  const orders = new Map<string, Record<string, unknown>>();
  const attribution = new Map<string, Record<string, unknown>>();
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const state = { failOrders: 0, ids: 0, inserts: 0 };
  const deps: OrderDeps = {
    loadDraft: async (key: string) => {
      const open = drafts.filter((d) => d.conversation_key === key && OPEN.includes(d.status));
      return open.length ? clone(open[open.length - 1]) : null;
    },
    createDraft: async (row) => {
      const existing = drafts.find((d) => d.conversation_key === row.conversation_key && OPEN.includes(d.status));
      if (existing) return clone(existing); // the one-open-draft index
      const d: OrderDraft = {
        id: `d${drafts.length + 1}`, conversation_key: row.conversation_key, channel: row.channel, status: "collecting",
        items: row.items ?? [], lines: null, delivery_type: null, delivery_price: null, total: null, customer: row.customer ?? {},
        receipt: null, cart_id: null, created_at: SUNDAY_NOON.toISOString(), updated_at: SUNDAY_NOON.toISOString(),
      };
      drafts.push(d);
      return clone(d);
    },
    updateDraft: async (id, patch, guard) => {
      const d = drafts.find((x) => x.id === id);
      if (!d) return false;
      if (guard?.status && d.status !== guard.status) return false;
      if (guard?.cartIdNull && d.cart_id !== null) return false;
      Object.assign(d, clone(patch));
      return true;
    },
    insertOrders: async (rows) => {
      state.inserts++;
      if (state.failOrders > 0) { state.failOrders--; return false; }
      for (const r of rows) if (!orders.has(String(r.id))) orders.set(String(r.id), r); // ON CONFLICT (id) DO NOTHING
      return true;
    },
    insertAttribution: async (rows) => {
      for (const r of rows) if (!attribution.has(String(r.order_id))) attribution.set(String(r.order_id), r);
      return true;
    },
    newId: () => `00000000-0000-4000-8000-${String(++state.ids).padStart(12, "0")}`,
    hashKey: sha256Hex,
  };
  return { deps, drafts, orders, attribution, state };
}

const ctx = { conversationKey: KEY, channel: "messenger" as const, now: SUNDAY_NOON, log: () => {} };
const FULL = { items: [{ sketch: 1, size: "M", qty: 2 }], delivery: "courier_tbilisi", name: "გიორგი ბერიძე", address: "თბილისი, რუსთაველი 1" };

async function seeded() {
  const db = fakeDb();
  await recordSketches(KEY, "messenger", SUNDAY_NOON, [
    { plan: plan(BLACK_TEE_FRONT_LION), url: "https://s/f.jpg", messageId: "mid1" },
    { plan: plan(BLACK_TEE_BACK_NAME), url: "https://s/b.jpg", messageId: "mid2" },
  ], db.deps, () => {});
  db.drafts[0].customer = { phone: "577123456" };
  return db;
}

describe("runOrderBlock", () => {
  it("no block → null; no sketches yet → asks for a design first", async () => {
    const db = fakeDb();
    expect(await runOrderBlock("სალამი", ctx, db.deps)).toBeNull();
    const r = await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps);
    expect(r?.messages[0]).toContain("ჯერ დიზაინი");
    expect(db.orders.size).toBe(0);
  });

  it("preview → confirm → orders + attribution, recap + bank text; a repeat creates nothing new", async () => {
    const db = await seeded();
    const p = await runOrderBlock(ORDER({ confirm: false, ...FULL }), ctx, db.deps);
    expect(p?.outcome).toBe("order_preview");
    expect(db.drafts[0]).toMatchObject({ status: "collecting", delivery_type: "courier_tbilisi", cart_id: null });
    const unit = calculatePrice("T-Shirt", "GILDAN", true, true, false, "small").total;
    expect(db.drafts[0].total).toBe(unit * 2 + 8 + BAG_FEE);

    const c = await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps);
    expect(c?.outcome).toBe("order_created");
    expect(c?.messages).toHaveLength(2);
    expect(c?.messages[0]).toMatch(/^✅ შეკვეთა #00000000 მიღებულია/);
    expect(c?.messages[1]).toContain(BANK_LINES[1]);
    expect(db.orders.size).toBe(2);
    expect(db.attribution.size).toBe(2);
    expect(db.drafts[0]).toMatchObject({ status: "awaiting_payment", cart_id: "00000000-0000-4000-8000-000000000001" });
    expect([...db.orders.values()].reduce((n, r) => n + (r.total_price as number), 0)).toBe(db.drafts[0].total);

    const again = await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps);
    expect(again?.outcome).toBe("order_exists");
    expect(db.orders.size).toBe(2);
    expect(db.state.inserts).toBe(1);
  });

  it('{"confirm":true} alone confirms the summary that was shown; with none shown it asks', async () => {
    const db = await seeded();
    expect((await runOrderBlock(ORDER({ confirm: true }), ctx, db.deps))?.outcome).toMatch(/^order_missing:no_items/);
    const p = await runOrderBlock(ORDER({ confirm: false, ...FULL }), ctx, db.deps);
    expect(p?.messages[0]).toContain("• ესკიზი 1: მაისური GILDAN, შავი — წინ + ზურგი (პატარა ზურგის პრინტი) · ზომა M × 2");
    const c = await runOrderBlock(ORDER({ confirm: true }), ctx, db.deps);
    expect(c?.outcome).toBe("order_created");
    expect(db.orders.size).toBe(2);
    expect([...db.orders.values()][0]).toMatchObject({ delivery_address: "თბილისი, რუსთაველი 1", first_name: "გიორგი" });
  });

  it("confirm without a preview, or with a change → the summary first", async () => {
    const db = await seeded();
    expect((await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps))?.outcome).toBe("order_preview_changed");
    expect((await runOrderBlock(ORDER({ confirm: true, ...FULL, items: [{ sketch: 1, size: "L", qty: 2 }] }), ctx, db.deps))?.outcome).toBe("order_preview_changed");
    expect(db.orders.size).toBe(0);
    expect((await runOrderBlock(ORDER({ confirm: true, ...FULL, items: [{ sketch: 1, size: "L", qty: 2 }] }), ctx, db.deps))?.outcome).toBe("order_created");
  });

  it("a failed insert leaves the draft claimed; the next confirmation finishes it with the SAME ids", async () => {
    const db = await seeded();
    await runOrderBlock(ORDER({ confirm: false, ...FULL }), ctx, db.deps);
    db.state.failOrders = 1;
    const first = await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps);
    expect(first?.messages).toEqual([ORDER_FAILED_TEXT]);
    expect(db.drafts[0].status).toBe("confirmed");
    const second = await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps);
    expect(second?.outcome).toBe("order_created");
    expect(db.state.ids).toBe(1); // no second cart id
    expect([...db.orders.keys()]).toEqual([await rowId(db.drafts[0].cart_id!, 0, sha256Hex), await rowId(db.drafts[0].cart_id!, 1, sha256Hex)]);
  });

  it("two runs confirming at once → one order", async () => {
    const db = await seeded();
    await runOrderBlock(ORDER({ confirm: false, ...FULL }), ctx, db.deps);
    const [a, b] = await Promise.all([
      runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps),
      runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps),
    ]);
    for (const r of [a, b]) expect(["order_created", "order_exists"]).toContain(r?.outcome);
    expect(db.orders.size).toBe(2); // qty 2 → two rows, not four
    expect(new Set([...db.orders.values()].map((r) => r.cart_id))).toEqual(new Set([db.drafts[0].cart_id]));
  });

  it("missing info keeps the name / address on the draft for the next turn", async () => {
    const db = fakeDb();
    await recordSketches(KEY, "messenger", SUNDAY_NOON, [{ plan: plan(BLACK_TEE_FRONT_LION), url: "u", messageId: null }], db.deps, () => {});
    const r = await runOrderBlock(ORDER({ items: [{ sketch: 1, size: "M" }], delivery: "pickup", name: "ნინო" }), ctx, db.deps);
    expect(r?.outcome).toBe("order_missing:phone");
    expect(db.drafts[0].customer).toEqual({ name: "ნინო" });
  });

  it("sketches after a confirmation are not added to that order", async () => {
    const db = await seeded();
    db.drafts[0].status = "awaiting_payment";
    expect(await recordSketches(KEY, "messenger", SUNDAY_NOON, [{ plan: plan(WHITE_HOODIE_FRONT_PHOTO, PHOTOS), url: "x", messageId: null }], db.deps, () => {})).toBe("draft_locked");
    expect(db.drafts[0].items).toHaveLength(1);
  });
});

// ── print files ────────────────────────────────────────────────────────────

const boxFont: FontLike = {
  unitsPerEm: 100, ascender: 100, descender: 0,
  getAdvanceWidth: (t, size) => [...t].length * 0.7 * size,
  getPath: (t, x, y, size) => {
    const commands: PathCommand[] = [];
    [...t].forEach((ch, i) => {
      if (ch === " ") return;
      const x0 = x + i * 0.7 * size, x1 = x0 + 0.6 * size, y0 = y - size, y1 = y;
      commands.push({ type: "M", x: x0, y: y0 }, { type: "L", x: x1, y: y0 }, { type: "L", x: x1, y: y1 }, { type: "L", x: x0, y: y1 }, { type: "Z" });
    });
    return { commands };
  },
};

function printFakes(o: Partial<PrintDeps> = {}) {
  const uploads: { path: string; bytes: Uint8Array; type: string }[] = [];
  let t = 0;
  const deps: PrintDeps = {
    now: () => t,
    loadFont: async () => boxFont,
    decodeJpeg: () => createImage(4, 4),
    cacheGet: async () => null,
    downloadUpload: async () => new Uint8Array([0xff, 0xd8, 0xff, 1, 2]),
    upload: async (p, bytes, type) => { uploads.push({ path: p, bytes, type }); return `https://pub/${p}`; },
    hashKey: sha256Hex,
    ...o,
  };
  return { deps, uploads, tick: (ms: number) => { t += ms; } };
}

async function magentaFlagPng(): Promise<Uint8Array> {
  const img: RgbaImage = createImage(10, 10);
  for (let i = 0; i < 100; i++) {
    const inner = i % 10 >= 3 && i % 10 < 7 && Math.floor(i / 10) >= 3 && Math.floor(i / 10) < 7;
    img.data.set(inner ? [255, 255, 255, 255] : [255, 0, 255, 255], i * 4);
  }
  return await encodePng(img);
}

describe("print files", () => {
  it("lettering: transparent PNG at print width, hashed path", async () => {
    const items = itemsFrom({ raw: BLACK_TEE_BACK_NAME, url: "b" });
    const f = printFakes();
    const folder = await printFolder("cart-1", sha256Hex);
    expect(folder).toMatch(/^social-orders\/[0-9a-f]{32}$/);
    const r = await makePrintFile(folder, 1, items[0], "back", f.deps, { ms: 0 });
    expect(r).toEqual({ url: `https://pub/${folder}/item1-back.png` });
    const png = await decodePng(f.uploads[0].bytes);
    expect(png.width).toBe(PRINT_TEXT_WIDTH);
    expect(png.width).toBeGreaterThanOrEqual(2000);
    expect(png.data.some((v, i) => i % 4 === 3 && v === 0)).toBe(true); // transparent between the letters
    expect(png.data.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    expect(f.uploads[0].type).toBe("image/png");
  });

  it("jersey: the name over the number", () => {
    const img = renderPrintText(boxFont, { kind: "text", text: "ბერიძე", number: "10", placement: "jersey-back", sketchUrl: "", at: "" }, "#FFFFFF");
    expect(img.height).toBeGreaterThan(img.width * 0.5);
  });

  it("generate: the cached design as it is; a flag gets its magenta keyed out", async () => {
    const plain = await encodePng(createImage(3, 3));
    const flag = await magentaFlagPng();
    const items = itemsFrom(
      { raw: GEN({ prompt: "ლომი", product: "GILDAN", color: "Black" }), url: "a", cacheKey: "plain" },
      { raw: GEN({ prompt: "საქართველოს დროშა", product: "GILDAN", color: "White" }), url: "b", cacheKey: "flag" },
    );
    expect(items[1].sides.front?.flag).toBe(true);
    const f = printFakes({ cacheGet: async (k) => (k === "plain" ? plain : flag) });
    await makePrintFile("F", 1, items[0], "front", f.deps, { ms: 0 });
    expect(f.uploads[0].bytes).toBe(plain);
    await makePrintFile("F", 2, items[1], "front", f.deps, { ms: 0 });
    const out = await decodePng(f.uploads[1].bytes);
    expect(out.width).toBeLessThan(10); // trimmed to the flag
    expect(Math.min(...Array.from({ length: out.width * out.height }, (_, i) => out.data[i * 4 + 3]))).toBeGreaterThanOrEqual(0);
  });

  it("photo: the original bytes when nothing is removed; a missing source / CPU budget → skipped, never thrown", async () => {
    const items = itemsFrom({ raw: WHITE_HOODIE_FRONT_PHOTO, url: "a", photos: PHOTOS });
    const f = printFakes();
    expect(await makePrintFile("F", 1, items[0], "front", f.deps, { ms: 0 })).toEqual({ url: "https://pub/F/item1-front.jpg" });
    expect(f.uploads[0].type).toBe("image/jpeg");
    const text = itemsFrom({ raw: BLACK_TEE_BACK_NAME, url: "b" });
    expect(await makePrintFile("F", 1, text[0], "back", f.deps, { ms: 5000 })).toEqual({ skipped: "cpu_budget" });
    const gen = itemsFrom({ raw: BLACK_TEE_FRONT_LION, url: "c" });
    expect(await makePrintFile("F", 1, gen[0], "front", f.deps, { ms: 0 })).toEqual({ skipped: "no_design_source" });
  });

  it("removeWhite: a small photo is keyed to a PNG; a big one (by its header) is left to the operator", async () => {
    const white = createImage(6, 6);
    white.data.fill(255);
    white.data.set([0, 0, 0, 255], (2 * 6 + 2) * 4);
    const small = await encodePng(white);
    expect(imageSize(small)).toEqual({ w: 6, h: 6 });
    // a JPEG header only: SOI, APP0, SOF0 with 3000 × 4000
    const bigJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x0f, 0xa0, 0x0b, 0xb8, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(bigJpeg)).toEqual({ w: 3000, h: 4000 });
    const raw = MOCK({ photo: 1, removeWhite: true, product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "front" });
    const items = itemsFrom({ raw, url: "a", photos: PHOTOS });
    const f = printFakes({ downloadUpload: async () => small });
    const ok = await makePrintFile("F", 1, items[0], "front", f.deps, { ms: 0 });
    expect(ok).toEqual({ url: "https://pub/F/item1-front.png" });
    const out = await decodePng(f.uploads[0].bytes);
    expect(out.width).toBeLessThan(6); // the white is gone, trimmed to the black dot
    const g = printFakes({ downloadUpload: async () => bigJpeg });
    expect(await makePrintFile("F", 1, items[0], "front", g.deps, { ms: 0 })).toEqual({ skipped: "photo_too_heavy" });
  });

  it("the confirmed order's rows carry the print URLs", async () => {
    const db = await seeded();
    const f = printFakes();
    db.deps.print = f.deps;
    await runOrderBlock(ORDER({ confirm: false, ...FULL }), ctx, db.deps);
    await runOrderBlock(ORDER({ confirm: true, ...FULL }), ctx, db.deps);
    const row = [...db.orders.values()][0];
    expect(row.back_transparent_image_url).toMatch(/^https:\/\/pub\/social-orders\/[0-9a-f]{32}\/item1-back\.png$/);
    expect(row.transparent_image_url).toBeNull(); // the lion was never cached in this fake
    expect(String(row.comment)).toContain("წინა: no_design_source");
    expect(db.drafts[0].items[0].sides.back?.printUrl).toBe(row.back_transparent_image_url);
  });
});

// ── the DM prompt ──────────────────────────────────────────────────────────

describe("socialChannel order rules", () => {
  it("without the flag the block is what it was; with it, the order rules replace the no-orders line", () => {
    const off = socialPromptBlock("messenger", "sunday");
    expect(off).toContain("- Do not take orders or confirm payments");
    expect(off).not.toContain("maika-order");
    expect(socialPromptBlock("messenger", "sunday", { orders: false })).toBe(off);
    const on = socialPromptBlock("messenger", "sunday", { orders: true });
    expect(on).not.toContain("Do not take orders");
    expect(on).toContain("```maika-order");
    expect(on).toContain("[phone:***NN]");
    expect(withSocialBlock("KB\n\nCALLER: x", "instagram", "sunday", { orders: true })).toMatch(/maika-order[\s\S]*\n\nCALLER: x$/);
    expect(socialOrdersOn(null, true)).toBe(false);
    expect(socialOrdersOn("messenger", "true")).toBe(false);
    expect(socialOrdersOn("messenger", true)).toBe(true);
  });

  it("chat_logs copy: name / address masked inside the order block only", () => {
    const t = `ok "name":"x"\n${ORDER({ confirm: false, items: [{ sketch: 1 }], name: 'გიორგი "გ"', address: "თბილისი" })}`;
    const out = redactOrderBlockForLog(t);
    expect(out).toContain('ok "name":"x"');
    expect(out).toContain('"name":"***"');
    expect(out).toContain('"address":"***"');
    expect(out).not.toContain("თბილისი");
    expect(redactOrderBlockForLog("plain")).toBe("plain");
  });
});

// ── through runAutoReply ───────────────────────────────────────────────────

function sketchFakes(): SketchDeps {
  const product = createImage(100, 120);
  product.data.fill(255);
  return {
    countSketches: async () => ({ generate: 0, text: 0 }),
    generateDesign: async () => null,
    fetchImage: async () => new Uint8Array([0xff, 0xd8, 0xff]),
    loadFont: async () => boxFont,
    decodeJpeg: () => ({ ...product, data: new Uint8ClampedArray(product.data) }),
    encodeJpeg: () => new Uint8Array([1, 2, 3]),
    upload: async (p) => `https://storage/designs/${p}`,
    hashKey: async () => "h".repeat(64),
    sendImage: async () => ({ ok: true, messageId: "mid_img" }),
  };
}

const row = (o: Partial<ThreadRow> & { meta_message_id: string; sent_at: string }): ThreadRow => ({
  direction: "in", text: null, attachments: [], unsupported: false, ...o,
});

function autoDeps(raws: string[], db: ReturnType<typeof fakeDb>, thread: ThreadRow[]) {
  const sent: string[] = [];
  const asked: { history: { role: string; content: string }[]; opts?: { orders?: boolean } }[] = [];
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
    askBot: async (_c, _k, history, _s, opts) => { asked.push({ history, opts }); return raws.shift() ?? null; },
    send: async (_c, _to, text) => { sent.push(text); return { ok: true, messageId: `mid${sent.length}` }; },
    log: () => {},
    sketch: sketchFakes(),
    order: db.deps,
  };
  return { deps, sent, asked };
}

const trigger: TriggerRow = {
  channel: "messenger", page_id: "159657880717306", customer_id: "psid1",
  meta_message_id: "m1", text: "x", sent_at: "2026-11-01T07:59:50.000Z",
};

describe("runAutoReply with orders", () => {
  beforeEach(() => _resetTokenWarning());

  it("sketch → draft item; next turn the model sees it; the order block → texts written by code", async () => {
    const db = fakeDb();
    const thread = [row({ meta_message_id: "m1", text: "შავ GILDAN-ზე ზურგზე გიორგი", sent_at: trigger.sent_at })];
    const a = autoDeps([`აი ასე 👇\n${BLACK_TEE_BACK_NAME}`], db, thread);
    expect(await runAutoReply(trigger, a.deps, { contacts: { phones: ["577123456"], emails: [] } })).toBe("reply");
    expect(a.asked[0].opts).toEqual({ orders: true });
    expect(db.drafts[0].customer).toEqual({ phone: "577123456" });
    expect(db.drafts[0].items[0]).toMatchObject({ subProduct: "GILDAN", color: "Black", sides: { back: { kind: "text", text: "გიორგი", messageId: "mid_img" } } });

    const t2 = { ...trigger, meta_message_id: "m2", sent_at: "2026-11-01T08:05:00.000Z" };
    const thread2 = [...thread, row({ meta_message_id: "m2", text: "M, 1 ცალი, გატანა, ნინო ბერიძე", sent_at: t2.sent_at })];
    const b = autoDeps([`შეჯამება: სულ 1 ₾ 🙂\n${ORDER({ confirm: false, items: [{ sketch: 1, size: "M", qty: 1 }], delivery: "pickup", name: "ნინო ბერიძე" })}`], db, thread2);
    await runAutoReply(t2, b.deps);
    expect(b.asked[0].history.some((h) => h.role === "assistant" && h.content.includes("[ესკიზი 1: მაისური GILDAN, შავი — ზურგი: წარწერა „გიორგი\"]"))).toBe(true);
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]).toContain(`სულ: ${calculatePrice("T-Shirt", "GILDAN", false, true, false).total + BAG_FEE} ₾`);
    expect(b.sent[0]).not.toContain("სულ 1 ₾"); // the model's own number is never sent

    const t3 = { ...trigger, meta_message_id: "m3", sent_at: "2026-11-01T08:06:00.000Z" };
    const c = autoDeps([ORDER({ confirm: true, items: [{ sketch: 1, size: "M", qty: 1 }], delivery: "pickup", name: "ნინო ბერიძე" })], db, [...thread2, row({ meta_message_id: "m3", text: "ვადასტურებ", sent_at: t3.sent_at })]);
    await runAutoReply(t3, c.deps);
    expect(c.sent).toHaveLength(2);
    expect(c.sent[1]).toContain(BANK_LINES[0]);
    expect(db.orders.size).toBe(1);
    expect([...db.orders.values()][0]).toMatchObject({ payment_provider: "bank_transfer", phone: "577123456", first_name: "ნინო", last_name: "ბერიძე" });
  });

  it("draft table unreadable → no order rules, no draft, the reply as before", async () => {
    const db = fakeDb();
    db.deps.loadDraft = async () => "error";
    const a = autoDeps([`სალამი\n${ORDER({ confirm: true })}`], db, [row({ meta_message_id: "m1", text: "x", sent_at: trigger.sent_at })]);
    await runAutoReply(trigger, a.deps);
    expect(a.asked[0].opts).toBeUndefined();
    expect(a.sent).toEqual(["სალამი\nკარგი!"]); // the fence stripped, as every maika-* block
    expect(db.drafts).toHaveLength(0);
  });
});
