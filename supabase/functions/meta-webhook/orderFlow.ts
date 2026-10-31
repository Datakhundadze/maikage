// DM orders — from the model's ```maika-order block to `orders` rows.
//
// THE BLOCK (socialChannel.ts tells the model how to write it):
//   ```maika-order
//   {"confirm":false,"items":[{"sketch":1,"size":"M","qty":2}],
//    "delivery":"courier_tbilisi","name":"…","address":"…"}
//   ```
// It carries REFERENCES and choices only. Products, sides and every price
// come from the draft (orderDraft.ts) and orderMath / pricingCopy — a number
// the model writes is never read. The phone / email come from the draft too
// (captured in code from the raw DM text, orderContacts.ts); the model only
// sees them masked.
//
// FLOW (runOrderBlock), every reply text written HERE from computed numbers:
//   missing info            → one question listing what is missing
//   complete, confirm false → the priced summary + „დაადასტურეთ"; the
//                             summary is stored on the draft (lines, delivery,
//                             total = the PREVIEW)
//   confirm true            → only if it equals the stored preview (else the
//                             preview is shown again; {"confirm":true} with no
//                             items = the stored preview). Claim the draft
//                             (cart_id NULL → id, status 'confirmed', one
//                             conditional UPDATE: a second run loses), render
//                             the print files, insert the `orders` rows
//                             (ids derived from the cart id, ON CONFLICT DO
//                             NOTHING) + order_attribution, status
//                             'awaiting_payment', then the recap + the bank
//                             transfer details.
//   already confirmed       → the same recap again; a draft left 'confirmed'
//                             (claimed, insert not finished) is finished now,
//                             with the same ids — never a second order.
//
// Rows mirror the site checkout (CartPage.tsx / OrderDialog.tsx): one row per
// UNIT, a shared cart_id, delivery + BAG_FEE on row 0, so SUM(total_price) is
// the total the customer is asked to transfer.

import { BAG_FEE, DELIVERY_PRICES, orderTotals, type DeliveryType } from "./orderMath.ts";
import { MAIKA_BOG_IBAN, MAIKA_TAX_ID, MAIKA_TBC_IBAN } from "./bankAccountsCopy.ts";
import { colorKa, needsSize, resolveSize, sizesFor } from "./orderCatalog.ts";
import {
  addSketch,
  isStale,
  orderRef,
  productLabel,
  sideFromPlan,
  type DraftCustomer,
  type DraftItem,
  type DraftLine,
  type DraftSide,
  type OrderDraft,
  type Side,
} from "./orderDraft.ts";
import { mergeContacts, type CapturedContacts } from "./orderContacts.ts";
import { makePrintFile, printFolder, type PrintDeps } from "./printFile.ts";
import type { RenderPlan } from "./sketchParse.ts";

export const PAYMENT_PROVIDER = "bank_transfer";
/** More units than this in one DM order → the operator finalises it. */
export const MAX_ORDER_UNITS = 30;
export const SKETCH_FONT_NAME = "Noto Sans Georgian Bold";

const ORDER_FENCE_RE = /```maika-order(?![\w-])[^\n]*\n?([\s\S]*?)```/;

export function hasOrderBlock(raw: string): boolean {
  return /```maika-order(?![\w-])/.test(String(raw ?? ""));
}

export interface OrderBlockLine { item: number; size: string | null; qty: number }
export interface OrderBlock {
  confirm: boolean;
  lines: OrderBlockLine[];
  delivery: DeliveryType | null;
  name: string | null;
  address: string | null;
}

const DELIVERY_ALIASES: Record<string, DeliveryType> = {
  pickup: "pickup", store: "pickup", showroom: "pickup", "მაღაზია": "pickup", "გატანა": "pickup",
  courier_tbilisi: "courier_tbilisi", tbilisi: "courier_tbilisi", courier: "courier_tbilisi",
  courier_outside: "courier_outside", courier_region: "courier_outside", region: "courier_outside", regions: "courier_outside", outside: "courier_outside",
};

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t ? t : null;
};

/** The block's JSON, leniently ("sketch" or "item", "qty" or "quantity"). null = no / unreadable block. */
export function parseOrderBlock(raw: string): OrderBlock | null {
  const m = ORDER_FENCE_RE.exec(String(raw ?? ""));
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const lines: OrderBlockLine[] = [];
  for (const l of Array.isArray(p.items) ? p.items : []) {
    if (!l || typeof l !== "object") continue;
    const r = l as Record<string, unknown>;
    const n = Number(r.sketch ?? r.item);
    if (!Number.isInteger(n) || n < 1 || n > 99) continue;
    const q = Number(r.qty ?? r.quantity ?? 1);
    const size = typeof r.size === "string" || typeof r.size === "number" ? String(r.size).trim().slice(0, 60) : "";
    lines.push({ item: n, size: size || null, qty: Number.isFinite(q) ? Math.max(1, Math.floor(q)) : 1 });
  }
  const d = typeof p.delivery === "string" ? DELIVERY_ALIASES[p.delivery.trim().toLowerCase()] ?? null : null;
  return {
    confirm: p.confirm === true || p.confirm === "true",
    lines,
    delivery: d,
    name: cleanText(p.name, 120),
    address: cleanText(p.address, 300),
  };
}

// ── resolve: what is missing, or the priced order ──────────────────────────

export type Missing =
  | { kind: "no_items" }
  | { kind: "unknown_item"; item: number }
  | { kind: "size"; item: number; sizes: string[] }
  | { kind: "too_many" }
  | { kind: "delivery" }
  | { kind: "name" }
  | { kind: "phone" }
  | { kind: "address" };

export interface PricedLine {
  item: number;
  data: DraftItem;
  size: string | null;
  qty: number;
  hasFront: boolean;
  hasBack: boolean;
  backSize: "small" | "big";
  unitPrice: number;
  lineTotal: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  delivery: DeliveryType;
  deliveryPrice: number;
  bagFee: number;
  subtotal: number;
  total: number;
  customer: Required<Pick<DraftCustomer, "name" | "phone">> & DraftCustomer;
}

/** The site's rule (SimplePage backPrintSize): photos / drawings → big, lettering only → small. */
export function backSizeOf(back: DraftSide | undefined): "small" | "big" {
  return back && back.kind === "text" ? "small" : "big";
}

export function resolveOrder(items: DraftItem[], customer: DraftCustomer, block: OrderBlock): { ok: true; order: PricedOrder } | { ok: false; missing: Missing[] } {
  const missing: Missing[] = [];
  if (items.length === 0) return { ok: false, missing: [{ kind: "no_items" }] };
  if (block.lines.length === 0) missing.push({ kind: "no_items" });
  const lines: Omit<PricedLine, "unitPrice" | "lineTotal">[] = [];
  const seenSizeAsk = new Set<number>();
  for (const l of block.lines) {
    const data = items[l.item - 1];
    if (!data) {
      missing.push({ kind: "unknown_item", item: l.item });
      continue;
    }
    let size: string | null = null;
    if (needsSize(data.product, data.subProduct)) {
      size = resolveSize(data.product, data.subProduct, l.size);
      if (!size) {
        if (!seenSizeAsk.has(l.item)) missing.push({ kind: "size", item: l.item, sizes: sizesFor(data.subProduct) });
        seenSizeAsk.add(l.item);
        continue;
      }
    }
    const hasFront = !!data.sides.front;
    const hasBack = !!data.sides.back;
    lines.push({ item: l.item, data, size, qty: l.qty, hasFront, hasBack, backSize: backSizeOf(data.sides.back) });
  }
  // Same item and size twice → one line.
  const merged: typeof lines = [];
  for (const l of lines) {
    const hit = merged.find((m) => m.item === l.item && m.size === l.size);
    if (hit) hit.qty += l.qty;
    else merged.push({ ...l });
  }
  if (merged.reduce((n, l) => n + l.qty, 0) > MAX_ORDER_UNITS) missing.push({ kind: "too_many" });
  if (!block.delivery) missing.push({ kind: "delivery" });
  const name = block.name ?? customer.name ?? null;
  const address = block.address ?? customer.address ?? null;
  if (!name) missing.push({ kind: "name" });
  if (!customer.phone) missing.push({ kind: "phone" });
  if (block.delivery && block.delivery !== "pickup" && !address) missing.push({ kind: "address" });
  if (missing.length > 0) return { ok: false, missing };

  const delivery = block.delivery as DeliveryType;
  const totals = orderTotals(
    merged.map((l) => ({ product: l.data.product, subProduct: l.data.subProduct, hasFront: l.hasFront, hasBack: l.hasBack, isStudio: false, backSize: l.backSize, quantity: l.qty })),
    delivery,
  );
  return {
    ok: true,
    order: {
      lines: merged.map((l, i) => ({ ...l, unitPrice: totals.unitPrices[i], lineTotal: totals.lineTotals[i] })),
      delivery,
      deliveryPrice: totals.delivery,
      bagFee: totals.bagFee,
      subtotal: totals.subtotal,
      total: totals.total,
      customer: {
        ...customer,
        name: name as string,
        phone: customer.phone as string,
        ...(delivery !== "pickup" && address ? { address } : {}),
      },
    },
  };
}

/** What the draft stores as the preview, and what a confirmation must equal. */
export function previewOf(o: PricedOrder): { lines: DraftLine[]; delivery_type: DeliveryType; delivery_price: number; total: number } {
  return {
    lines: o.lines.map((l) => ({ item: l.item, size: l.size, qty: l.qty, unitPrice: l.unitPrice })),
    delivery_type: o.delivery,
    delivery_price: o.deliveryPrice,
    total: o.total,
  };
}

/**
 * Preview identity: lines, delivery, total, the sketches of the ordered items
 * and the name / address. A change to any of them after the summary was shown
 * means the customer has not confirmed THIS order yet.
 */
export function orderSignature(o: PricedOrder): string {
  return JSON.stringify({
    p: previewOf(o),
    s: o.lines.map((l) => [l.data.sides.front?.sketchUrl ?? "", l.data.sides.back?.sketchUrl ?? ""]),
    n: o.customer.name,
    a: o.customer.address ?? "",
  });
}

/** The signature of the preview stored on a draft (null = none stored). */
export function storedSignature(d: OrderDraft): string | null {
  if (!d.lines || !d.delivery_type || d.total === null || d.delivery_price === null) return null;
  const block: OrderBlock = {
    confirm: false,
    lines: d.lines.map((l) => ({ item: l.item, size: l.size, qty: l.qty })),
    delivery: d.delivery_type,
    name: null,
    address: null,
  };
  const r = resolveOrder(d.items, d.customer, block);
  if ("missing" in r) return null;
  // The stored numbers must still be what the code computes now.
  const now = previewOf(r.order);
  if (JSON.stringify(now) !== JSON.stringify({ lines: d.lines, delivery_type: d.delivery_type, delivery_price: d.delivery_price, total: d.total })) return null;
  return orderSignature(r.order);
}

// ── texts (all numbers from PricedOrder) ───────────────────────────────────

export const DELIVERY_LABEL_KA: Record<DeliveryType, string> = {
  pickup: "მაღაზიიდან გატანა",
  courier_tbilisi: "კურიერი თბილისში",
  courier_outside: "კურიერი რეგიონში",
};

const sidesLabel = (l: Pick<PricedLine, "hasFront" | "hasBack" | "backSize">) =>
  l.hasFront && l.hasBack ? `წინ + ზურგი (${l.backSize === "small" ? "პატარა" : "დიდი"} ზურგის პრინტი)` : l.hasBack ? "ზურგი" : "წინ";

/** One line per order line; it names the SKETCH number (the model re-reads it). */
export function lineText(l: PricedLine): string {
  const size = l.size ? ` · ზომა ${l.size}` : "";
  const money = l.qty > 1 ? `${l.unitPrice} ₾ × ${l.qty} = ${l.lineTotal} ₾` : `${l.unitPrice} ₾`;
  return `• ესკიზი ${l.item}: ${productLabel(l.data.product, l.data.subProduct)}, ${colorKa(l.data.color)} — ${sidesLabel(l)}${size} × ${l.qty} — ${money}`;
}

export function totalsText(o: PricedOrder): string {
  return [
    ...o.lines.map((l) => lineText(l)),
    `მიწოდება: ${DELIVERY_LABEL_KA[o.delivery]} — ${o.deliveryPrice} ₾`,
    `ჩანთა — ${o.bagFee} ₾`,
    `სულ: ${o.total} ₾`,
  ].join("\n");
}

export const CONFIRM_WORD = "ვადასტურებ";

export function previewText(o: PricedOrder): string {
  return `შეკვეთის შეჯამება:\n${totalsText(o)}\n\nყველაფერი სწორია? დასადასტურებლად დაწერეთ „${CONFIRM_WORD}".`;
}

export function confirmedText(o: PricedOrder, cartId: string): string {
  return `✅ შეკვეთა #${orderRef(cartId)} მიღებულია:\n${totalsText(o)}`;
}

/** The KB's own lines (gemini-proxy FAQ §9) — a test checks the KB still has them. */
export const BANK_LINES = [
  `შპს „მაიკა ჯი" · ს/ნ ${MAIKA_TAX_ID}`,
  `- თიბისი ბანკი (TBC): ${MAIKA_TBC_IBAN}`,
  `- საქართველოს ბანკი (BOG): ${MAIKA_BOG_IBAN}`,
] as const;

export function bankText(total: number, cartId: string): string {
  return [
    `გადახდა საბანკო გადარიცხვით — ${total} ₾:`,
    ...BANK_LINES,
    `დანიშნულებაში მიუთითეთ: შეკვეთა #${orderRef(cartId)}`,
    "გადარიცხვის შემდეგ ქვითარი (სქრინშოტი) აქვე გამოგვიგზავნეთ — ოპერატორი დაადასტურებს და შეკვეთას დავიწყებთ.",
  ].join("\n");
}

export function missingText(missing: Missing[], items: DraftItem[]): string {
  if (missing.some((m) => m.kind === "no_items") && items.length === 0) {
    return "შეკვეთისთვის ჯერ დიზაინი შევათანხმოთ: მომწერეთ, რა დავბეჭდოთ და რომელ პროდუქტზე — ესკიზს აქვე გამოგიგზავნით.";
  }
  if (missing.some((m) => m.kind === "too_many")) {
    return "ამდენი ცალის შეკვეთას ოპერატორი გააფორმებს — დაწერეთ „ოპერატორი\" და დაგიკავშირდებით.";
  }
  const ask: string[] = [];
  for (const m of missing) {
    if (m.kind === "no_items") ask.push(`რომელი ესკიზი შევუკვეთოთ (${items.map((_, i) => i + 1).join(", ")})`);
    else if (m.kind === "unknown_item") ask.push(`ესკიზი ${m.item} ვერ ვიპოვე — რომელი ესკიზი იგულისხმეთ?`);
    else if (m.kind === "size") {
      const it = items[m.item - 1];
      const label = it ? `${productLabel(it.product, it.subProduct)}, ${colorKa(it.color)}` : "";
      ask.push(m.sizes.length > 0 ? `ზომა — ესკიზი ${m.item} (${label}): ${m.sizes.join(", ")}` : `ტელეფონის მოდელი — ესკიზი ${m.item}`);
    } else if (m.kind === "delivery") ask.push(`მიწოდება: მაღაზიიდან გატანა (${DELIVERY_PRICES.pickup} ₾), კურიერი თბილისში (${DELIVERY_PRICES.courier_tbilisi} ₾) თუ რეგიონში (${DELIVERY_PRICES.courier_outside} ₾)?`);
    else if (m.kind === "name") ask.push("სახელი და გვარი");
    else if (m.kind === "phone") ask.push("ტელეფონის ნომერი");
    else if (m.kind === "address") ask.push("მიწოდების მისამართი (ქალაქი, ქუჩა, ნომერი)");
  }
  return `შეკვეთის გასაფორმებლად კიდევ მჭირდება:\n${ask.map((a) => `• ${a}`).join("\n")}`;
}

export const ORDER_FAILED_TEXT =
  "შეკვეთის ჩაწერისას ტექნიკური შეფერხება მოხდა 🙏 სცადეთ ცოტა ხანში კიდევ ერთხელ „ვადასტურებ\", ან დაწერეთ „ოპერატორი\".";
export const ORDER_LOCKED_TEXT =
  "წინა შეკვეთა ჯერ გადახდას ელოდება — ახალს ოპერატორი გააფორმებს. დაწერეთ „ოპერატორი\".";

// ── orders rows ────────────────────────────────────────────────────────────

/** A UUID derived from the cart id and the row number: a resumed insert writes the SAME ids. */
export async function rowId(cartId: string, n: number, hash: (s: string) => Promise<string>): Promise<string> {
  const h = await hash(`order-row:${cartId}:${n}`);
  // RFC 4122 shape (version 5 nibble, variant 10xx) so every consumer accepts it.
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** First word → first_name, the rest → last_name ("" when there is none). */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

const SIDE_KA: Record<Side, string> = { front: "წინა მხარე", back: "უკანა მხარე" };

/** orders.prompt, in the site's buildTextPrompt shape for lettering. */
export function promptFor(item: DraftItem): string | null {
  const parts: string[] = [];
  for (const side of ["front", "back"] as const) {
    const s = item.sides[side];
    if (!s) continue;
    if (s.kind === "text") {
      parts.push(`${SIDE_KA[side]}:\n  ტექსტი: ${s.text ?? ""}${s.number ? `\n  ნომერი: ${s.number}` : ""}\n  ფონტი: ${SKETCH_FONT_NAME}\n  ფერი: ${s.textColor ?? "auto"}`);
    } else if (s.kind === "generate") {
      parts.push(`${SIDE_KA[side]} (AI ნახატი):\n  ${s.prompt ?? ""}${s.style ? `\n  სტილი: ${s.style}` : ""}`);
    } else {
      parts.push(`${SIDE_KA[side]}:\n  მომხმარებლის ფოტო ${s.photo ?? ""}${s.removeWhite ? " (თეთრი ფონი მოშორებული)" : ""}`);
    }
    if (s.placement || s.size === "large") parts.push(`  განთავსება: ${[s.placement, s.size === "large" ? "დიდი" : ""].filter(Boolean).join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export interface OrderRowContext {
  channel: "messenger" | "instagram";
  cartId: string;
  hash: (s: string) => Promise<string>;
}

const CHANNEL_LABEL = { messenger: "Messenger", instagram: "Instagram" } as const;

/** The `orders` rows for a priced order (one per unit) — the site's shape. */
export async function buildOrderRows(o: PricedOrder, ctx: OrderRowContext): Promise<Record<string, unknown>[]> {
  const { first, last } = splitName(o.customer.name);
  const ref = orderRef(ctx.cartId);
  const rows: Record<string, unknown>[] = [];
  for (const l of o.lines) {
    const f = l.data.sides.front, b = l.data.sides.back;
    const skipped = [f && !f.printUrl ? `წინა: ${f.printSkipped ?? "—"}` : "", b && !b.printUrl ? `უკანა: ${b.printSkipped ?? "—"}` : ""].filter(Boolean);
    const comment = [
      `DM ბოტი · ${CHANNEL_LABEL[ctx.channel]} · შეკვეთა #${ref} · საბანკო გადარიცხვა`,
      `ესკიზი ${l.item}${l.hasFront && l.hasBack ? ` · ზურგის პრინტი: ${l.backSize === "small" ? "პატარა" : "დიდი"}` : ""}`,
      skipped.length > 0 ? `პრინტ ფაილი ოპერატორმა გაიტანოს (${skipped.join("; ")})` : "",
    ].filter(Boolean).join("\n");
    const template = {
      user_id: null,
      first_name: first,
      last_name: last,
      email: o.customer.email ?? "",
      comment,
      phone: o.customer.phone,
      delivery_type: o.delivery,
      delivery_address: o.delivery !== "pickup" ? o.customer.address ?? null : null,
      delivery_price: 0,
      product_price: l.unitPrice,
      total_price: l.unitPrice,
      product: l.data.product,
      sub_product: l.data.subProduct,
      color: l.data.color,
      is_studio: false,
      status: "pending",
      payment_status: "unpaid",
      payment_provider: PAYMENT_PROVIDER,
      bog_order_id: null,
      front_mockup_url: f?.sketchUrl ?? null,
      back_mockup_url: b?.sketchUrl ?? null,
      transparent_image_url: f?.printUrl ?? null,
      back_transparent_image_url: b?.printUrl ?? null,
      prompt: promptFor(l.data),
      size: l.size,
      cart_id: ctx.cartId,
      design_state: null,
    };
    for (let k = 0; k < l.qty; k++) rows.push({ id: await rowId(ctx.cartId, rows.length, ctx.hash), ...template });
  }
  if (rows.length > 0) {
    rows[0].delivery_price = o.deliveryPrice;
    rows[0].total_price = (rows[0].product_price as number) + o.deliveryPrice + BAG_FEE;
  }
  return rows;
}

export function attributionRows(rows: Record<string, unknown>[], channel: "messenger" | "instagram", nowIso: string): Record<string, unknown>[] {
  return rows.map((r) => ({ order_id: r.id, cart_id: r.cart_id, manual_channel: channel, manual_note: "bot", manual_set_at: nowIso }));
}

// ── the flow ───────────────────────────────────────────────────────────────

export interface OrderDeps {
  /** The open draft; null = none; "error" = unreadable (table missing → the order flow stays off). */
  loadDraft: (conversationKey: string) => Promise<OrderDraft | null | "error">;
  /** Insert a collecting draft; on the one-open-draft conflict, the existing one. */
  createDraft: (row: { conversation_key: string; channel: "messenger" | "instagram"; items?: DraftItem[]; customer?: DraftCustomer }) => Promise<OrderDraft | null>;
  /**
   * UPDATE … WHERE id = $id [AND status = guard.status] [AND cart_id IS NULL];
   * true when a row changed.
   */
  updateDraft: (id: string, patch: Record<string, unknown>, guard?: { status?: string; cartIdNull?: boolean }) => Promise<boolean>;
  /** INSERT … ON CONFLICT (id) DO NOTHING; false on error. */
  insertOrders: (rows: Record<string, unknown>[]) => Promise<boolean>;
  /** INSERT … ON CONFLICT (order_id) DO NOTHING; best-effort. */
  insertAttribution: (rows: Record<string, unknown>[]) => Promise<boolean>;
  newId: () => string;
  hashKey: (s: string) => Promise<string>;
  /** Print file rendering; absent → no print files (mockups + sources only). */
  print?: PrintDeps;
}

export interface OrderRun {
  messages: string[];
  outcome: string;
}

export interface OrderContext {
  conversationKey: string;
  channel: "messenger" | "instagram";
  now: Date;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

function blockFromDraft(d: OrderDraft): OrderBlock {
  return {
    confirm: true,
    lines: (d.lines ?? []).map((l) => ({ item: l.item, size: l.size, qty: l.qty })),
    delivery: d.delivery_type,
    name: null,
    address: null,
  };
}

/** Render + attach the print files of the ordered items (in place on `items`). */
async function attachPrintFiles(items: DraftItem[], o: PricedOrder, cartId: string, deps: OrderDeps, log: OrderContext["log"]): Promise<void> {
  const p = deps.print;
  const ordered = [...new Set(o.lines.map((l) => l.item))];
  if (!p) {
    for (const n of ordered) for (const side of ["front", "back"] as const) {
      const s = items[n - 1]?.sides[side];
      if (s && !s.printUrl) s.printSkipped = "not_rendered";
    }
    return;
  }
  const folder = await printFolder(cartId, deps.hashKey);
  const cpu = { ms: 0 };
  for (const n of ordered) {
    const it = items[n - 1];
    if (!it) continue;
    for (const side of ["front", "back"] as const) {
      const s = it.sides[side];
      if (!s || s.printUrl) continue;
      const r = await makePrintFile(folder, n, it, side, p, cpu);
      if ("url" in r) {
        s.printUrl = r.url;
        delete s.printSkipped;
      } else {
        s.printSkipped = r.skipped;
        log("info", `order print file skipped (${s.kind}): ${r.skipped}`);
      }
    }
  }
  log("info", `order print files: ${cpu.ms} ms pixel time`);
}

/** Claimed draft → print files, rows, attribution, awaiting_payment. */
async function finishOrder(d: OrderDraft, cartId: string, ctx: OrderContext, deps: OrderDeps): Promise<OrderRun> {
  const items: DraftItem[] = JSON.parse(JSON.stringify(d.items));
  const r = resolveOrder(items, d.customer, blockFromDraft(d));
  if ("missing" in r) {
    ctx.log("error", `order: claimed draft no longer resolves (${r.missing.map((m) => m.kind).join(",")})`);
    return { messages: [ORDER_FAILED_TEXT], outcome: "order_unresolvable" };
  }
  // Lines reference the `items` copy, so the print URLs set here are on them.
  await attachPrintFiles(items, r.order, cartId, deps, ctx.log);
  const order = r.order;
  const rows = await buildOrderRows(order, { channel: ctx.channel, cartId, hash: deps.hashKey });
  if (!(await deps.insertOrders(rows))) {
    ctx.log("error", "order: orders insert failed — draft stays 'confirmed', the next confirmation resumes it");
    await deps.updateDraft(d.id, { items }, { status: "confirmed" });
    return { messages: [ORDER_FAILED_TEXT], outcome: "order_insert_failed" };
  }
  if (!(await deps.insertAttribution(attributionRows(rows, ctx.channel, ctx.now.toISOString())))) {
    ctx.log("warn", "order: attribution insert failed (ignored)");
  }
  const moved = await deps.updateDraft(d.id, { items, status: "awaiting_payment" }, { status: "confirmed" });
  if (!moved) ctx.log("warn", "order: draft status update failed (orders are in)");
  ctx.log("info", `order created ${ctx.channel}: ${rows.length} row(s)`);
  return { messages: [confirmedText(order, cartId), bankText(order.total, cartId)], outcome: "order_created" };
}

/** The recap of a draft that is already an order (a repeated „ვადასტურებ"). */
function recapAgain(d: OrderDraft): OrderRun {
  const r = resolveOrder(d.items, d.customer, blockFromDraft(d));
  if ("missing" in r || !d.cart_id) return { messages: [ORDER_LOCKED_TEXT], outcome: "order_locked" };
  return { messages: [confirmedText(r.order, d.cart_id), bankText(r.order.total, d.cart_id)], outcome: "order_exists" };
}

/** The open draft, or a new one; a stale collecting draft is cancelled first. */
export async function openDraft(key: string, channel: "messenger" | "instagram", now: Date, deps: OrderDeps): Promise<OrderDraft | null> {
  const d = await deps.loadDraft(key);
  if (d === "error") return null;
  if (d && isStale(d, now)) {
    await deps.updateDraft(d.id, { status: "cancelled" }, { status: "collecting" });
    return await deps.createDraft({ conversation_key: key, channel });
  }
  return d ?? (await deps.createDraft({ conversation_key: key, channel }));
}

export interface SentSketch {
  plan: RenderPlan;
  url: string;
  messageId: string | null;
  cacheKey?: string;
}

/**
 * The sketches of one reply → draft items (one read, one write). Only a
 * collecting draft takes new sketches: after a confirmation the order is
 * fixed, and a new order waits until the operator closes that draft.
 */
export async function recordSketches(key: string, channel: "messenger" | "instagram", now: Date, sent: SentSketch[], deps: OrderDeps, log: OrderContext["log"]): Promise<string> {
  if (sent.length === 0) return "none";
  const d = await openDraft(key, channel, now, deps);
  if (!d) return "draft_unavailable";
  if (d.status !== "collecting") {
    log("info", `order draft: ${sent.length} sketch(es) not recorded, draft is ${d.status}`);
    return "draft_locked";
  }
  let items = d.items;
  const at = now.toISOString();
  for (const s of sent) {
    const { target, side } = sideFromPlan(s.plan, s.url, at, { messageId: s.messageId, cacheKey: s.cacheKey });
    const r = addSketch(items, target, side);
    if (r.outcome === "full") log("info", "order draft: item limit reached, sketch not recorded");
    items = r.items;
  }
  const ok = await deps.updateDraft(d.id, { items }, { status: "collecting" });
  return ok ? "recorded" : "update_failed";
}

/** Phone / email captured from the raw DM → the draft's admin-only customer jsonb. */
export async function saveContacts(key: string, channel: "messenger" | "instagram", now: Date, c: CapturedContacts, deps: OrderDeps): Promise<string> {
  const d = await openDraft(key, channel, now, deps);
  if (!d) return "draft_unavailable";
  const ok = await deps.updateDraft(d.id, { customer: mergeContacts(d.customer ?? {}, c) });
  return ok ? "saved" : "update_failed";
}

/** The whole order step for one bot reply carrying a maika-order block. null = no block. */
export async function runOrderBlock(raw: string, ctx: OrderContext, deps: OrderDeps): Promise<OrderRun | null> {
  if (!hasOrderBlock(raw)) return null;
  const block = parseOrderBlock(raw);
  const loaded = await deps.loadDraft(ctx.conversationKey);
  if (loaded === "error") return { messages: [ORDER_FAILED_TEXT], outcome: "draft_unreadable" };
  if (!block) {
    ctx.log("warn", "order: unreadable maika-order block");
    return { messages: [missingText([{ kind: "no_items" }], loaded?.items ?? [])], outcome: "order_block_unreadable" };
  }
  const d = loaded;
  if (d && d.status !== "collecting") {
    if (d.status === "confirmed" && d.cart_id) return await finishOrder(d, d.cart_id, ctx, deps);
    return recapAgain(d);
  }
  const items = d?.items ?? [];
  // {"confirm":true} with no items = "yes to the summary you showed": the
  // stored preview's lines and delivery (name / address may still change).
  const eff: OrderBlock = block.confirm && block.lines.length === 0 && d && d.lines && d.lines.length > 0
    ? { ...blockFromDraft(d), name: block.name, address: block.address }
    : block;
  const customer: DraftCustomer = {
    ...(d?.customer ?? {}),
    ...(block.name ? { name: block.name } : {}),
    ...(block.address ? { address: block.address } : {}),
  };
  const r = resolveOrder(items, customer, eff);
  if ("missing" in r) {
    if (d && (block.name || block.address)) await deps.updateDraft(d.id, { customer }, { status: "collecting" });
    return { messages: [missingText(r.missing, items)], outcome: `order_missing:${r.missing.map((m) => m.kind).join(",")}` };
  }
  if (!d) return { messages: [ORDER_FAILED_TEXT], outcome: "no_draft" }; // items exist only on a draft
  const sig = orderSignature(r.order);
  const prev = storedSignature(d);
  if (!eff.confirm || prev !== sig) {
    const stored = await deps.updateDraft(d.id, { ...previewOf(r.order), customer: r.order.customer }, { status: "collecting", cartIdNull: true });
    if (!stored) return { messages: [ORDER_FAILED_TEXT], outcome: "preview_store_failed" };
    return { messages: [previewText(r.order)], outcome: eff.confirm ? "order_preview_changed" : "order_preview" };
  }
  // Confirmed and identical to the summary the customer saw: claim the draft.
  const cartId = deps.newId();
  const claimed = await deps.updateDraft(d.id, { status: "confirmed", cart_id: cartId }, { status: "collecting", cartIdNull: true });
  if (!claimed) {
    // Another run got there first (or the row changed): show what is there now.
    const now = await deps.loadDraft(ctx.conversationKey);
    if (now && now !== "error" && now.cart_id) return now.status === "confirmed" ? await finishOrder(now, now.cart_id, ctx, deps) : recapAgain(now);
    return { messages: [ORDER_FAILED_TEXT], outcome: "claim_failed" };
  }
  return await finishOrder({ ...d, status: "confirmed", cart_id: cartId }, cartId, ctx, deps);
}
