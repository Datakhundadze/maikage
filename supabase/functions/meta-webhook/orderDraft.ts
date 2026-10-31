// DM orders — the draft: every sketch the bot sent, grouped into order items
// (pure: no Deno, no I/O). orderFlow.ts turns a draft into `orders` rows.
//
// One row of public.social_order_drafts per open conversation (migration
// 20261101120000_social_order_drafts.sql). `items` holds what the customer
// was SHOWN — product / brand / colour and, per side, what was printed on it
// and the sketch JPEG that went out — so the order can be built later from
// facts the code has, never from the model's words.
//
// GROUPING (addSketch). A front and a back sketch of the same product, brand
// and colour are ONE item with two sides. A re-send of the same design on the
// same side (bigger, moved, other placement) replaces that side; a different
// design on a side that is already taken starts a new item (two shirts, or an
// alternative — the order block then names which item numbers to make).
// Item numbers are stable: items are only appended, at most MAX_DRAFT_ITEMS.

import type { DeliveryType } from "./orderMath.ts";
import { FRONT_ONLY_PRODUCTS } from "./catalogSnapshot.ts";
import { colorKa, productKa } from "./orderCatalog.ts";
import { isFlagBlock, type ProductChoice, type RenderPlan } from "./sketchParse.ts";
import type { ChatTurn } from "./botReply.ts";

export type DraftStatus = "collecting" | "confirmed" | "awaiting_payment" | "receipt_received" | "approved" | "cancelled";
/** Statuses the partial unique index treats as "open" (one per conversation). */
export const OPEN_DRAFT_STATUSES: DraftStatus[] = ["collecting", "confirmed", "awaiting_payment", "receipt_received"];

export const MAX_DRAFT_ITEMS = 20;
/** A collecting draft untouched this long is cancelled and a fresh one opened. */
export const DRAFT_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export type Side = "front" | "back";

export interface DraftSide {
  kind: "generate" | "text" | "photo";
  placement?: string;
  size?: "large";
  /** generate: the block's prompt / style / background, the design cache key. */
  prompt?: string;
  style?: string;
  withBackground?: boolean;
  flag?: boolean;
  cacheKey?: string;
  /** text */
  text?: string;
  number?: string;
  textColor?: string;
  /** photo: „[ფოტო N]" and its PRIVATE social-uploads path (the print source). */
  photo?: number;
  photoPath?: string;
  removeWhite?: boolean;
  /** The sketch JPEG the customer saw (public designs bucket) = the order's mockup. */
  sketchUrl: string;
  messageId?: string | null;
  at: string;
  /** Set at confirmation: the transparent print file (public designs bucket). */
  printUrl?: string | null;
  /** Why there is no print file (the operator exports it from the source). */
  printSkipped?: string;
}

export interface DraftItem {
  product: string;
  subProduct: string;
  color: string;
  sides: { front?: DraftSide; back?: DraftSide };
}

/** Admin-only (RLS). phone / email are captured in code from the raw text. */
export interface DraftCustomer {
  phone?: string;
  email?: string;
  name?: string;
  address?: string;
}

/** A priced order line as stored on the draft (prices from orderMath, never the model). */
export interface DraftLine {
  item: number;
  size: string | null;
  qty: number;
  unitPrice: number;
}

export interface OrderDraft {
  id: string;
  conversation_key: string;
  channel: "messenger" | "instagram";
  status: DraftStatus;
  items: DraftItem[];
  lines: DraftLine[] | null;
  delivery_type: DeliveryType | null;
  delivery_price: number | null;
  total: number | null;
  customer: DraftCustomer;
  receipt: unknown;
  cart_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Front-only products (mug, cap, …) have no back: the sketch shows the front. */
export function normaliseTarget(t: ProductChoice): ProductChoice {
  return FRONT_ONLY_PRODUCTS.includes(t.product) ? { ...t, side: "front" } : t;
}

/** One sent sketch → the draft's side record. */
export function sideFromPlan(
  plan: RenderPlan,
  sketchUrl: string,
  at: string,
  extra: { messageId?: string | null; cacheKey?: string } = {},
): { target: ProductChoice; side: DraftSide } {
  const target = normaliseTarget(plan.target);
  const base = {
    sketchUrl,
    at,
    ...(extra.messageId ? { messageId: extra.messageId } : {}),
    ...(plan.block.placement ? { placement: plan.block.placement } : {}),
    ...(plan.block.size === "large" ? { size: "large" as const } : {}),
  };
  if (plan.kind === "generate") {
    return {
      target,
      side: {
        kind: "generate",
        prompt: plan.block.prompt,
        style: plan.block.style,
        withBackground: plan.block.withBackground,
        ...(isFlagBlock(plan.block) ? { flag: true } : {}),
        ...(extra.cacheKey ? { cacheKey: extra.cacheKey } : {}),
        ...base,
      },
    };
  }
  if (plan.kind === "photo") {
    return {
      target,
      side: {
        kind: "photo",
        photo: plan.block.photo,
        photoPath: plan.path,
        ...(plan.block.removeWhite ? { removeWhite: true } : {}),
        ...base,
      },
    };
  }
  return {
    target,
    side: {
      kind: "text",
      text: plan.block.text,
      ...(plan.block.number ? { number: plan.block.number } : {}),
      ...(plan.block.textColor ? { textColor: plan.block.textColor } : {}),
      ...base,
    },
  };
}

/** Same design (size / placement may differ)? */
export function sameDesign(a: DraftSide, b: DraftSide): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "generate") return a.prompt === b.prompt && (a.style ?? "") === (b.style ?? "") && !!a.withBackground === !!b.withBackground;
  if (a.kind === "photo") return a.photoPath === b.photoPath && !!a.removeWhite === !!b.removeWhite;
  return a.text === b.text && (a.number ?? "") === (b.number ?? "") && (a.textColor ?? "") === (b.textColor ?? "");
}

export type AddOutcome = "new" | "side" | "replace" | "full";

/** Add one sent sketch to the items (a new array; the input is not changed). */
export function addSketch(
  items: DraftItem[],
  target: ProductChoice,
  side: DraftSide,
): { items: DraftItem[]; item: number | null; outcome: AddOutcome } {
  const next = items.map((it) => ({ ...it, sides: { ...it.sides } }));
  const s: Side = target.side;
  const matches: number[] = [];
  for (let i = next.length - 1; i >= 0; i--) {
    const it = next[i];
    if (it.product === target.product && it.subProduct === target.subProduct && it.color === target.color) matches.push(i);
  }
  // 1. the same design on the same side → a revision of that side
  for (const i of matches) {
    const cur = next[i].sides[s];
    if (cur && sameDesign(cur, side)) {
      next[i].sides[s] = side;
      return { items: next, item: i + 1, outcome: "replace" };
    }
  }
  // 2. the latest matching item with that side free → its second side
  for (const i of matches) {
    if (!next[i].sides[s]) {
      next[i].sides[s] = side;
      return { items: next, item: i + 1, outcome: "side" };
    }
  }
  // 3. a new item
  if (next.length >= MAX_DRAFT_ITEMS) return { items, item: null, outcome: "full" };
  next.push({ product: target.product, subProduct: target.subProduct, color: target.color, sides: { [s]: side } });
  return { items: next, item: next.length, outcome: "new" };
}

// ── what the model is told ─────────────────────────────────────────────────

/** „მაისური GILDAN" / „ჭიქა". */
export function productLabel(product: string, subProduct: string): string {
  return subProduct && subProduct !== product ? `${productKa(product)} ${subProduct}` : productKa(product);
}

const SAFE = (s: string, n: number) => s.replace(/[[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function sideSummary(s: DraftSide): string {
  const big = s.size === "large" ? " (დიდი)" : "";
  if (s.kind === "text") return `წარწერა „${SAFE(s.text ?? "", 40)}"${s.number ? ` №${s.number}` : ""}${big}`;
  if (s.kind === "photo") return `ფოტო ${s.photo ?? "?"}${big}`;
  return `ნახატი „${SAFE(s.prompt ?? "", 40)}"${big}`;
}

export function itemSummary(it: DraftItem): string {
  const parts: string[] = [];
  if (it.sides.front) parts.push(`წინ: ${sideSummary(it.sides.front)}`);
  if (it.sides.back) parts.push(`ზურგი: ${sideSummary(it.sides.back)}`);
  return `${productLabel(it.product, it.subProduct)}, ${colorKa(it.color)} — ${parts.join("; ")}`;
}

/** The tag the history carries per item: „[ესკიზი 1: მაისური GILDAN, შავი — წინ: …]". */
export const sketchTag = (n: number, it: DraftItem) => `[ესკიზი ${n}: ${itemSummary(it)}]`;

// botReply.stripSketchSystemText removes both tags from the model's answer
// (DRAFT_TAG_RE there), as it does „[ფოტო N]".

/** One line per item, or "" when there are none. */
export function sketchesNote(items: DraftItem[]): string {
  return items.map((it, i) => sketchTag(i + 1, it)).join("\n");
}

/** A confirmed draft, for the model: number, total, waiting for the transfer. */
export function orderStatusNote(d: Pick<OrderDraft, "status" | "cart_id" | "total">): string {
  if (!d.cart_id || d.status === "collecting") return "";
  const ref = orderRef(d.cart_id);
  if (d.status === "confirmed" || d.status === "awaiting_payment") return `[შეკვეთა #${ref} გაფორმებულია, ელოდება გადარიცხვას — სულ ${d.total ?? "?"} ₾]`;
  if (d.status === "receipt_received") return `[შეკვეთა #${ref}: ქვითარი მიღებულია, ოპერატორი ამოწმებს]`;
  return "";
}

/** Short order number from the cart id (the customer quotes it on the transfer). */
export function orderRef(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Put the note on OUR side of the history, right before the customer's
 * current burst: appended to the assistant turn there, or as a new one.
 * faq-chat answers the last user turn, so the history still ends on it.
 */
export function withDraftNote(turns: ChatTurn[], note: string): ChatTurn[] {
  if (!note || turns.length === 0) return turns;
  let i = turns.length;
  while (i > 0 && turns[i - 1].role === "user") i--;
  const out = turns.slice();
  if (i > 0 && out[i - 1].role === "assistant") {
    out[i - 1] = { role: "assistant", content: `${out[i - 1].content}\n${note}` };
  } else {
    out.splice(i, 0, { role: "assistant", content: note });
  }
  return out;
}

/** The open draft is too old to keep collecting into. */
export function isStale(d: Pick<OrderDraft, "status" | "updated_at">, now: Date): boolean {
  if (d.status !== "collecting") return false;
  const t = Date.parse(d.updated_at);
  return Number.isFinite(t) && now.getTime() - t > DRAFT_STALE_MS;
}
