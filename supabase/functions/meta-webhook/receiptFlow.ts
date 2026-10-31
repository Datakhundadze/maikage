// DM orders — the RECEIPT step (add-only, 2026-11-01). Every side effect comes
// in through deps, so vitest drives it with fakes; index.ts supplies the real
// Supabase / gemini-proxy ones. The checks and texts are receiptCheck.ts.
//
// WHEN. autoReply.ts calls it for a bot run that is about to answer, BEFORE
// the model is asked, when the conversation's open draft is an order waiting
// for the transfer ('awaiting_payment') or already holding a receipt
// ('receipt_received' — a second / corrected one). Only the images of the
// customer's current burst that are stored in social-uploads and were not
// read before are looked at, oldest first, until one is a receipt.
//
//   no image / cap reached / read failed / not a receipt
//        → messages null: the normal reply runs (a design photo stays a design photo)
//   a receipt
//        → copy to social-uploads/receipts/<cart_id>/ (media.ts purges only
//          the paths recorded on social_messages.attachments, so the copy is
//          kept), the record on draft.receipt, status 'receipt_received'
//          (not for "unreadable"), the note on every orders row of the cart,
//          and ONE reply written here. The model is not asked.
//
// CAP. MAX_RECEIPT_READS model reads per conversation per 24 h (every read
// counts, receipt or not), counted from draft.receipt.reads.
// NEVER touches payment_status: the operator marks the order paid in the admin.
// Logs carry outcomes only — no amount, name, IBAN or path.

import type { Channel } from "./handler.ts";
import type { BotSchedule } from "./botSchedule.ts";
import { isScheduleActive } from "./botSchedule.ts";
import { operatorBack, pendingInbound, type ThreadRow } from "./botReply.ts";
import type { OrderDeps } from "./orderFlow.ts";
import type { DraftStatus, OrderDraft } from "./orderDraft.ts";
import {
  evaluateReceipt,
  nextReceiptState,
  parseReceiptState,
  readsSince,
  receiptCopyPath,
  receiptNote,
  receiptReplyText,
  withReceiptNote,
  type ReceiptFields,
  type ReceiptRecord,
} from "./receiptCheck.ts";

export const RECEIPT_DRAFT_STATUSES: readonly DraftStatus[] = ["awaiting_payment", "receipt_received"];
export const MAX_RECEIPT_READS = 3;
export const RECEIPT_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** gemini-proxy read-receipt accepts a data URL up to this many characters. */
export const MAX_RECEIPT_DATA_URL_CHARS = 14_000_000;

export interface ReceiptDeps {
  /** gemini-proxy read-receipt (trusted social call). null = the call failed. */
  readReceipt: (channel: Channel, conversationKey: string, imageDataUrl: string) => Promise<ReceiptFields | null>;
  /** A customer image from the PRIVATE social-uploads bucket (service role). */
  downloadUpload: (path: string) => Promise<Uint8Array | null>;
  /** Copy inside social-uploads; true when the target exists afterwards. */
  copyUpload: (fromPath: string, toPath: string) => Promise<boolean>;
  /** SUM(total_price) and the earliest created_at of the cart's orders rows; null = unreadable / none. */
  orderTotal: (cartId: string) => Promise<{ total: number; createdAt: string | null } | null>;
  loadOrderComments: (cartId: string) => Promise<{ id: string; comment: string | null }[] | null>;
  updateOrderComment: (id: string, comment: string) => Promise<boolean>;
}

export interface ReceiptInput {
  conversationKey: string;
  channel: Channel;
  now: Date;
  schedule: BotSchedule;
  thread: ThreadRow[];
  draft: OrderDraft;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface ReceiptRun {
  /** null → no receipt: continue with the normal reply. */
  messages: string[] | null;
  outcome: string;
}

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic" };

/** Stored images of the current burst not read before, oldest first. */
export function receiptCandidates(thread: ThreadRow[], checked: readonly string[]): { path: string; mid: string }[] {
  const out: { path: string; mid: string }[] = [];
  for (const r of pendingInbound(thread)) {
    for (const a of Array.isArray(r.attachments) ? r.attachments : []) {
      if (!a || a.type !== "image" || a.stored !== true || a.purged === true) continue;
      if (typeof a.path !== "string" || a.path.trim() === "" || checked.includes(a.path)) continue;
      out.push({ path: a.path, mid: r.meta_message_id });
    }
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** data:image/<type>;base64,… by the stored file's extension; null for anything else. */
export function imageDataUrl(path: string, bytes: Uint8Array): string | null {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const type = IMAGE_TYPES[ext];
  if (!type || bytes.length === 0) return null;
  const url = `data:${type};base64,${bytesToBase64(bytes)}`;
  return url.length <= MAX_RECEIPT_DATA_URL_CHARS ? url : null;
}

export async function runReceiptStep(input: ReceiptInput, order: OrderDeps, deps: ReceiptDeps): Promise<ReceiptRun> {
  const { draft, now, log } = input;
  if (!draft.cart_id || !RECEIPT_DRAFT_STATUSES.includes(draft.status)) return { messages: null, outcome: "no_order" };
  const cartId: string = draft.cart_id;
  let state = parseReceiptState(draft.receipt);
  const candidates = receiptCandidates(input.thread, state.checked);
  if (candidates.length === 0) return { messages: null, outcome: "no_image" };
  const left = MAX_RECEIPT_READS - readsSince(state, now.getTime() - RECEIPT_CAP_WINDOW_MS);
  if (left <= 0) return { messages: null, outcome: "cap" };

  let found: { path: string; mid: string; fields: ReceiptFields } | null = null;
  let reads = 0;
  let failed = false;
  for (const c of candidates) {
    if (reads >= left) break;
    const bytes = await deps.downloadUpload(c.path);
    const dataUrl = bytes ? imageDataUrl(c.path, bytes) : null;
    if (!dataUrl) {
      log("warn", "receipt: image unavailable");
      continue;
    }
    reads++;
    const fields = await deps.readReceipt(input.channel, input.conversationKey, dataUrl);
    if (!fields) {
      // Counted (it cost a call), not marked as checked: a later run may retry.
      failed = true;
      state = nextReceiptState(state, { at: now.toISOString(), sourcePath: null });
      continue;
    }
    if (!fields.is_receipt) {
      state = nextReceiptState(state, { at: now.toISOString(), sourcePath: c.path });
      continue;
    }
    found = { ...c, fields };
    break;
  }

  if (!found) {
    if (reads > 0 && !(await order.updateDraft(draft.id, { receipt: state }, { status: draft.status }))) {
      log("warn", "receipt: read bookkeeping not saved");
    }
    return { messages: null, outcome: reads === 0 ? "no_image" : failed ? "read_failed" : "not_receipt" };
  }

  const totals = await deps.orderTotal(cartId);
  if (!totals) log("warn", "receipt: orders total unreadable, using the draft total");
  const expected = totals ? totals.total : draft.total;
  const createdAt = totals?.createdAt ?? draft.created_at ?? null;
  const ev = evaluateReceipt(found.fields, expected, createdAt, now);

  const copyTo = receiptCopyPath(cartId, found.path);
  const copied = await deps.copyUpload(found.path, copyTo);
  if (!copied) log("warn", "receipt: copy to receipts/ failed (the original stays until the 90-day purge)");

  const record: ReceiptRecord = {
    path: copied ? copyTo : null,
    source_path: found.path,
    message_id: found.mid,
    fields: found.fields,
    checks: ev.checks,
    expected_total: expected,
    verdict: ev.verdict,
    read_at: now.toISOString(),
  };
  state = nextReceiptState(state, { at: now.toISOString(), sourcePath: found.path }, record);
  const status: DraftStatus = ev.verdict === "unreadable" ? draft.status : "receipt_received";
  if (!(await order.updateDraft(draft.id, { receipt: state, status }, { status: draft.status }))) {
    log("warn", "receipt: draft update failed");
  }

  // The note on every row of the cart: the previous receipt line replaced, so a re-run writes nothing new.
  const note = receiptNote(record);
  const rows = await deps.loadOrderComments(cartId);
  if (!rows) log("warn", "receipt: orders comment read failed");
  let noted = 0;
  for (const r of rows ?? []) {
    const next = withReceiptNote(r.comment, note);
    if (next === (r.comment ?? "")) continue;
    if (await deps.updateOrderComment(r.id, next)) noted++;
  }
  log("info", `receipt ${input.channel}: ${ev.verdict}, ${noted} order row(s) noted`);

  const back = isScheduleActive(input.schedule, now) ? operatorBack(input.schedule) : null;
  return {
    messages: [receiptReplyText(ev.verdict, { amount: found.fields.amount, currency: found.fields.currency, expected, back })],
    outcome: `receipt_${ev.verdict}`,
  };
}
