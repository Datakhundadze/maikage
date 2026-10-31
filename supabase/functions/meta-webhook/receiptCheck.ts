// DM orders — the bank-transfer RECEIPT: every check, the verdict, the
// customer texts and the admin note (pure: no Deno, no I/O). receiptFlow.ts
// runs it; gemini-proxy `read-receipt` only READS the image.
//
// THE MODEL READS, THE CODE DECIDES. The model returns what is written on the
// screenshot (amount, currency, recipient, IBAN, date …). Whether that is a
// payment for THIS order is decided here, never by the model:
//   IBAN       ∈ our two accounts (bankAccountsCopy.ts), spaces / case /
//              currency suffix ignored; a masked IBAN (GE13TB****0012) whose
//              visible parts fit one of ours counts as "partial"
//   recipient  „მაიკა ჯი" / Maika G / MAIKA JI … (legal form, quotes, ს/ნ
//              ignored) — only decisive when the IBAN is not readable
//   currency   GEL (₾, ლარი); none written → assumed GEL (flagged)
//   amount     |amount − SUM(orders.total_price of the cart)| < 1 — the same
//              rule as the payment functions' validation (>= 1 → 400)
//   date       not before the day the order was created, not in the future
//              (Tbilisi days; a day/month swap that fits is accepted)
// Verdict, first that applies: unreadable → wrong_recipient →
// amount_mismatch (amount or currency) → date_mismatch → match.
// The operator still marks the order paid; nothing here touches payment_status.

import { MAIKA_BOG_IBAN, MAIKA_TBC_IBAN } from "./bankAccountsCopy.ts";
import { BANK_LINES } from "./orderFlow.ts";

export const ALLOWED_IBANS: readonly string[] = [MAIKA_TBC_IBAN, MAIKA_BOG_IBAN];
/** Below this the read is "unreadable" (the model's own 0..1 certainty). */
export const MIN_CONFIDENCE = 0.4;

export type Verdict = "match" | "amount_mismatch" | "wrong_recipient" | "date_mismatch" | "unreadable";
export const VERDICTS: readonly Verdict[] = ["match", "amount_mismatch", "wrong_recipient", "date_mismatch", "unreadable"];

/** What gemini-proxy read-receipt returns (re-validated here: never trusted as is). */
export interface ReceiptFields {
  is_receipt: boolean;
  amount: number | null;
  currency: string | null;
  recipient_name: string | null;
  recipient_iban: string | null;
  /** YYYY-MM-DD as the model read it. */
  date: string | null;
  sender_name: string | null;
  purpose: string | null;
  bank: string | null;
  confidence: number;
}

export type IbanCheck = "ok" | "partial" | "mismatch" | "missing";
export type NameCheck = "ok" | "mismatch" | "missing";
export type CurrencyCheck = "ok" | "assumed" | "mismatch";
export type AmountCheck = "ok" | "mismatch" | "missing" | "no_total";
export type DateCheck = "ok" | "missing" | "before_order" | "future";

export interface ReceiptChecks {
  iban: IbanCheck;
  name: NameCheck;
  recipient: boolean;
  currency: CurrencyCheck;
  amount: AmountCheck;
  date: DateCheck;
}

// ── field coercion ─────────────────────────────────────────────────────────

const cleanStr = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return t ? t : null;
};

/** "1 234,50" / "1,234.50" / "95,00 ₾" / 95 → 1234.5 / 1234.5 / 95 / 95. null when it is not one number. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v < 10_000_000 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s\u00a0]+/g, "").replace(/₾|GEL|ლარი|ლ\.?$/gi, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // the later separator is the decimal one
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "95,00" → decimal; "1,234" → thousands
    s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (s.split(".").length > 2) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return parseAmount(Number.isFinite(n) ? n : NaN);
}

/** The model's JSON → ReceiptFields, every field re-validated. null = not an object. */
export function coerceReceiptFields(v: unknown): ReceiptFields | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const conf = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  return {
    is_receipt: r.is_receipt === true,
    amount: parseAmount(r.amount),
    currency: cleanStr(r.currency, 12),
    recipient_name: cleanStr(r.recipient_name, 120),
    recipient_iban: cleanStr(r.recipient_iban, 64),
    date: cleanStr(r.date, 32),
    sender_name: cleanStr(r.sender_name, 120),
    purpose: cleanStr(r.purpose, 200),
    bank: cleanStr(r.bank, 60),
    confidence: conf,
  };
}

// ── IBAN ───────────────────────────────────────────────────────────────────

const MASK = "*";

/**
 * Upper case, no spaces / dashes / single dots, currency suffix dropped;
 * mask characters (* • · … and runs of dots) become "*". null when empty.
 */
export function normaliseIban(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase()
    .replace(/[\s\u00a0\u200b-]+/g, "")
    .replace(/\.{2,}|…/g, MASK)
    .replace(/\./g, "")
    .replace(/[•·●∙]/g, MASK)
    .replace(/\*+/g, MASK)
    .replace(/(GEL|USD|EUR)$/, "");
  return s ? s : null;
}

export function checkIban(v: unknown): IbanCheck {
  const n = normaliseIban(v);
  if (!n) return "missing";
  if (ALLOWED_IBANS.includes(n)) return "ok";
  if (n.includes(MASK)) {
    const parts = n.split(MASK).filter((p) => p !== "");
    const visible = parts.join("").length;
    const last = parts[parts.length - 1] ?? "";
    // Enough of it is visible, and it ends in at least 4 visible characters.
    if (parts.length >= 1 && visible >= 8 && !n.endsWith(MASK) && last.length >= 4) {
      const re = new RegExp(`^${parts.map((p) => p.replace(/[^A-Z0-9]/g, "")).join(".*")}$`);
      if (!n.startsWith(MASK) && ALLOWED_IBANS.some((iban) => re.test(iban))) return "partial";
    }
  }
  return "mismatch";
}

// ── recipient name ─────────────────────────────────────────────────────────

const KA_LAT: Record<string, string> = {
  "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z", "თ": "t", "ი": "i", "კ": "k",
  "ლ": "l", "მ": "m", "ნ": "n", "ო": "o", "პ": "p", "ჟ": "zh", "რ": "r", "ს": "s", "ტ": "t", "უ": "u",
  "ფ": "p", "ქ": "k", "ღ": "gh", "ყ": "q", "შ": "sh", "ჩ": "ch", "ც": "ts", "ძ": "dz", "წ": "ts", "ჭ": "ch",
  "ხ": "kh", "ჯ": "j", "ჰ": "h",
};

/** „შპს „მაიკა ჯი"" / "MAIKA G LLC" / "Maika-Ji" → "maikaji" / "maikag" / "maikaji". */
export function normaliseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // toLowerCase also folds Mtavruli (ᲛᲐᲘᲙᲐ) into Mkhedruli.
  let s = ` ${v.toLowerCase()} `;
  s = s
    .replace(/შ\.?\s*პ\.?\s*ს\.?/g, " ")
    .replace(/(^|[^a-z])(?:llc|ltd|limited|jsc|shps|sps|inc)\.?(?=[^a-z]|$)/g, "$1 ")
    .replace(/(^|[^ა-ჿ])სს(?=[^ა-ჿ]|$)/g, "$1 ")
    .replace(/ს\/ნ|s\/n|\d+/g, " ");
  let out = "";
  for (const ch of s) out += KA_LAT[ch] ?? (/[a-z]/.test(ch) ? ch : "");
  return out ? out : null;
}

/** maika + g / gi / ji / dji / gee / jee / ge (the brand). */
const OUR_NAME_RE = /^maika(?:g|gi|ji|dji|dzhi|gee|jee|ge)$/;

export function checkName(v: unknown): NameCheck {
  const n = normaliseName(v);
  if (!n) return "missing";
  return OUR_NAME_RE.test(n) ? "ok" : "mismatch";
}

// ── currency / amount / date ───────────────────────────────────────────────

export function normaliseCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Georgian first: toUpperCase() would turn „ლარი" into Mtavruli.
  const raw = v.trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return null;
  if (raw === "ლარი" || raw === "ლ" || raw === "₾") return "GEL";
  const s = raw.toUpperCase();
  if (s === "GEL" || s === "LARI" || s === "GEO") return "GEL";
  return s.slice(0, 8);
}

export function checkCurrency(v: unknown): CurrencyCheck {
  const c = normaliseCurrency(v);
  if (c === null) return "assumed";
  return c === "GEL" ? "ok" : "mismatch";
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The payment functions' rule: |amount − total| >= 1 is a mismatch. */
export function amountMatches(amount: number, expected: number): boolean {
  return Math.abs(cents(amount) - cents(expected)) < 1;
}

export function checkAmount(amount: number | null, expected: number | null): AmountCheck {
  if (amount === null) return "missing";
  if (expected === null || !Number.isFinite(expected)) return "no_total";
  return amountMatches(amount, expected) ? "ok" : "mismatch";
}

/** "YYYY-MM-DD" of an instant, in Tbilisi. */
export function tbilisiDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "2026-11-01", "2026-11-01T10:00", "01.11.2026", "01/11/2026" → {y, m, d}; null otherwise. */
export function parseReceiptDate(v: unknown): { y: number; m: number; d: number } | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else {
    hit = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
    if (!hit) return null;
    [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return { y, m, d };
}

const dayKey = (p: { y: number; m: number; d: number }) =>
  `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;

export function checkDate(v: unknown, orderCreatedAt: string | null, now: Date): DateCheck {
  const p = parseReceiptDate(v);
  if (!p) return "missing";
  const created = orderCreatedAt ? new Date(orderCreatedAt) : null;
  const from = created && Number.isFinite(created.getTime()) ? tbilisiDay(created) : null;
  const to = tbilisiDay(now);
  const fits = (k: string) => (from === null || k >= from) && k <= to;
  if (fits(dayKey(p))) return "ok";
  // A day/month swap (11.05 read as 05.11) that fits is the model's misread.
  if (p.d <= 12 && fits(dayKey({ y: p.y, m: p.d, d: p.m }))) return "ok";
  return dayKey(p) > to ? "future" : "before_order";
}

// ── the verdict ────────────────────────────────────────────────────────────

export interface Evaluation {
  verdict: Verdict;
  checks: ReceiptChecks;
}

export function evaluateReceipt(f: ReceiptFields, expectedTotal: number | null, orderCreatedAt: string | null, now: Date): Evaluation {
  const iban = checkIban(f.recipient_iban);
  const name = checkName(f.recipient_name);
  const recipient = iban === "ok" || (iban === "partial" && name !== "mismatch") || (iban === "missing" && name === "ok");
  const checks: ReceiptChecks = {
    iban,
    name,
    recipient,
    currency: checkCurrency(f.currency),
    amount: checkAmount(f.amount, expectedTotal),
    date: checkDate(f.date, orderCreatedAt, now),
  };
  let verdict: Verdict;
  if (f.amount === null || (iban === "missing" && name === "missing") || f.confidence < MIN_CONFIDENCE) verdict = "unreadable";
  else if (!recipient) verdict = "wrong_recipient";
  else if (checks.amount !== "ok" || checks.currency === "mismatch") verdict = "amount_mismatch";
  else if (checks.date === "before_order" || checks.date === "future") verdict = "date_mismatch";
  else verdict = "match";
  return { verdict, checks };
}

// ── what is stored (social_order_drafts.receipt, admin-only) ───────────────

export interface ReceiptRecord {
  /** The copy in social-uploads/receipts/<cart_id>/ (not purged); null if the copy failed. */
  path: string | null;
  /** The original social-uploads path (purged after 90 days with its message). */
  source_path: string;
  message_id: string;
  fields: ReceiptFields;
  checks: ReceiptChecks;
  expected_total: number | null;
  verdict: Verdict;
  read_at: string;
}

/**
 * draft.receipt: the LATEST receipt's record at the top level ({path, fields,
 * checks, verdict, read_at, …}), older ones in `history`, and the bookkeeping
 * of every read: `reads` (ISO times, for the 24 h cap) and `checked` (source
 * paths already read, receipt or not, so an image is never read twice).
 */
export interface ReceiptState extends Partial<ReceiptRecord> {
  history: ReceiptRecord[];
  reads: string[];
  checked: string[];
}

export const MAX_RECEIPT_HISTORY = 5;
const MAX_READS_KEPT = 20;
const MAX_CHECKED_KEPT = 40;

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function isRecord(v: unknown): v is ReceiptRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.verdict === "string" && typeof r.read_at === "string" && typeof r.source_path === "string";
}

export function parseReceiptState(v: unknown): ReceiptState {
  const r = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const latest = isRecord(r) ? recordOf(r as unknown as ReceiptRecord) : {};
  return {
    ...latest,
    history: Array.isArray(r.history) ? (r.history as unknown[]).filter(isRecord) : [],
    reads: strArr(r.reads),
    checked: strArr(r.checked),
  };
}

function recordOf(r: ReceiptRecord): ReceiptRecord {
  return {
    path: r.path ?? null,
    source_path: r.source_path,
    message_id: r.message_id,
    fields: r.fields,
    checks: r.checks,
    expected_total: r.expected_total ?? null,
    verdict: r.verdict,
    read_at: r.read_at,
  };
}

/** Reads within the window (the cap). */
export function readsSince(state: ReceiptState, sinceMs: number): number {
  return state.reads.filter((t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms > sinceMs;
  }).length;
}

/** The state after one more read (and, when it was a receipt, its record). */
export function nextReceiptState(state: ReceiptState, read: { at: string; sourcePath: string | null }, record?: ReceiptRecord): ReceiptState {
  const reads = [...state.reads, read.at].slice(-MAX_READS_KEPT);
  const checked = read.sourcePath && !state.checked.includes(read.sourcePath)
    ? [...state.checked, read.sourcePath].slice(-MAX_CHECKED_KEPT)
    : state.checked;
  const prev = isRecord(state) ? recordOf(state as ReceiptRecord) : null;
  if (!record) {
    return { ...(prev ?? {}), history: state.history, reads, checked };
  }
  const history = prev ? [prev, ...state.history].slice(0, MAX_RECEIPT_HISTORY) : state.history;
  return { ...recordOf(record), history, reads, checked };
}

/** Source paths of every image already taken as a receipt (never a design photo). */
export function receiptSourcePaths(v: unknown): Set<string> {
  const s = parseReceiptState(v);
  const out = new Set<string>();
  if (typeof s.source_path === "string") out.add(s.source_path);
  for (const h of s.history) out.add(h.source_path);
  return out;
}

/** social-uploads/receipts/<cart_id>/<file name of the original>. */
export function receiptCopyPath(cartId: string, sourcePath: string): string {
  const base = sourcePath.split("/").pop() ?? "receipt";
  const safeCart = cartId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "cart";
  return `receipts/${safeCart}/${base.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 160) || "receipt"}`;
}

// ── the admin note on the orders rows ──────────────────────────────────────

export const RECEIPT_NOTE_PREFIX = "ქვითარი:";

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const mark = (ok: boolean) => (ok ? "✓" : "✗");

/** „ქვითარი: 95₾ ✓ IBAN ✓ — ოპერატორმა დაადასტუროს" and the other verdicts. */
export function receiptNote(r: Pick<ReceiptRecord, "fields" | "checks" | "verdict" | "expected_total">): string {
  if (r.verdict === "unreadable") return `${RECEIPT_NOTE_PREFIX} ვერ წავიკითხე — ოპერატორმა ნახოს`;
  const cur = normaliseCurrency(r.fields.currency);
  const amt = r.fields.amount === null ? "?" : `${money(r.fields.amount)}${cur && cur !== "GEL" ? ` ${cur}` : "₾"}`;
  const amountOk = r.checks.amount === "ok" && r.checks.currency !== "mismatch";
  const parts = [`${RECEIPT_NOTE_PREFIX} ${amt} ${mark(amountOk)}`];
  if (!amountOk && r.expected_total !== null) parts.push(`(შეკვეთა ${money(r.expected_total)}₾)`);
  parts.push(`IBAN ${r.checks.iban === "ok" ? "✓" : r.checks.iban === "partial" ? "≈" : "✗"}`);
  if (r.checks.iban !== "ok") parts.push(`მიმღები ${mark(r.checks.name === "ok")}`);
  if (r.checks.date === "before_order" || r.checks.date === "future") parts.push("თარიღი ✗");
  const tail = r.verdict === "match" ? "ოპერატორმა დაადასტუროს" : "ოპერატორმა გადაამოწმოს";
  return `${parts.join(" ")} — ${tail}`;
}

/** The comment with the previous receipt line (if any) replaced by `note`. Same input → same output. */
export function withReceiptNote(comment: string | null, note: string): string {
  const kept = (comment ?? "").split("\n").filter((l) => !l.startsWith(RECEIPT_NOTE_PREFIX));
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  return [...kept, note].join("\n");
}

// ── the customer texts (no PII: only amounts and our own account lines) ────

export const RECEIPT_MATCH_TEXT = "ქვითარი მივიღეთ, მადლობა! ოპერატორი გადაამოწმებს ჩარიცხვას და შეკვეთას წარმოებაში გავუშვებთ.";
export const RECEIPT_UNREADABLE_TEXT =
  "ქვითარი კარგად ვერ წავიკითხე 🙏 გამოგვიგზავნეთ, გთხოვთ, უფრო მკაფიო სქრინშოტი, სადაც ჩანს თანხა, მიმღები და ანგარიშის ნომერი (IBAN).";

/** `back` = when the operator is back (botReply.operatorBack), or null inside working hours. */
export function receiptReplyText(
  verdict: Verdict,
  o: { amount: number | null; currency: string | null; expected: number | null; back: string | null },
): string {
  const later = o.back ? ` ${o.back}` : "";
  if (verdict === "match") return o.back ? `${RECEIPT_MATCH_TEXT}\nოპერატორი ჩარიცხვას ნახავს ${o.back}.` : RECEIPT_MATCH_TEXT;
  if (verdict === "unreadable") return RECEIPT_UNREADABLE_TEXT;
  if (verdict === "wrong_recipient") {
    return [
      "ქვითარი მივიღეთ, მადლობა. როგორც ჩანს, გადარიცხვა სხვა ანგარიშზეა გაკეთებული. ჩვენი ანგარიშები:",
      ...BANK_LINES,
      `ოპერატორი გადაამოწმებს და დაგიკავშირდებათ${later}.`,
    ].join("\n");
  }
  if (verdict === "amount_mismatch") {
    const cur = normaliseCurrency(o.currency);
    const amt = o.amount === null ? "?" : `${money(o.amount)} ${cur && cur !== "GEL" ? cur : "₾"}`;
    const total = o.expected === null ? "" : `, შეკვეთის ჯამი კი ${money(o.expected)} ₾`;
    return `ქვითარი მივიღეთ, მადლობა. ქვითარზე თანხა ${amt}-ია${total} — ოპერატორი გადაამოწმებს და დაგიკავშირდებათ${later}.`;
  }
  return `ქვითარი მივიღეთ, მადლობა. ქვითრის თარიღი შეკვეთის თარიღს არ ემთხვევა — ოპერატორი გადაამოწმებს და დაგიკავშირდებათ${later}.`;
}
