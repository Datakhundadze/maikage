// Admin view of a DM order's bank-transfer receipt (add-only, 2026-11-01).
//
// meta-webhook/receiptCheck.ts writes social_order_drafts.receipt (admin-only
// RLS): the latest receipt's {path, fields, checks, verdict, read_at, …} at
// the top level, older ones in `history`. The image is a copy in the PRIVATE
// social-uploads bucket under receipts/<cart_id>/ — the admin reads it through
// a signed URL (the bucket's "Admins can read social uploads" policy). This
// file only turns the jsonb into what OrderReceipt.tsx shows; it never
// decides anything — the operator marks the order paid with the existing
// payment control.

export type ReceiptVerdict = "match" | "amount_mismatch" | "wrong_recipient" | "date_mismatch" | "unreadable";

export const RECEIPT_VERDICT_LABELS: Record<ReceiptVerdict, string> = {
  match: "ემთხვევა — დაადასტურეთ ჩარიცხვა",
  amount_mismatch: "თანხა არ ემთხვევა",
  wrong_recipient: "სხვა ანგარიში / მიმღები",
  date_mismatch: "თარიღი არ ემთხვევა",
  unreadable: "ვერ წაიკითხა",
};

export interface ReceiptView {
  path: string | null;
  verdict: ReceiptVerdict;
  verdictLabel: string;
  amount: number | null;
  currency: string | null;
  expectedTotal: number | null;
  amountOk: boolean;
  /** true ✓ / false ✗ / null not readable. "partial" (masked IBAN that fits ours) counts as ✓. */
  ibanOk: boolean | null;
  iban: string | null;
  recipientName: string | null;
  date: string | null;
  readAt: string | null;
  /** Earlier receipts of the same order. */
  earlier: number;
}

const VERDICT_SET = new Set<string>(Object.keys(RECEIPT_VERDICT_LABELS));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** draft.receipt → the view; null when no receipt was read yet. */
export function parseReceiptView(receipt: unknown): ReceiptView | null {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  const r = receipt as Record<string, unknown>;
  const verdict = str(r.verdict);
  if (!verdict || !VERDICT_SET.has(verdict)) return null;
  const f = (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, unknown>;
  const c = (r.checks && typeof r.checks === "object" ? r.checks : {}) as Record<string, unknown>;
  const iban = str(c.iban);
  return {
    path: str(r.path),
    verdict: verdict as ReceiptVerdict,
    verdictLabel: RECEIPT_VERDICT_LABELS[verdict as ReceiptVerdict],
    amount: num(f.amount),
    currency: str(f.currency),
    expectedTotal: num(r.expected_total),
    amountOk: c.amount === "ok" && c.currency !== "mismatch",
    ibanOk: iban === "ok" || iban === "partial" ? true : iban === "mismatch" ? false : null,
    iban: str(f.recipient_iban),
    recipientName: str(f.recipient_name),
    date: str(f.date),
    readAt: str(r.read_at),
    earlier: Array.isArray(r.history) ? r.history.length : 0,
  };
}

export function verdictTone(v: ReceiptVerdict): "ok" | "warn" | "bad" {
  if (v === "match") return "ok";
  if (v === "unreadable" || v === "date_mismatch") return "warn";
  return "bad";
}
