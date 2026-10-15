// Callback requests from the FAQ chat (§9d of FAQ_KB in index.ts).
//
// THE CONTRACT. When a customer asks to be called — or accepts the bot's offer —
// AND their own message carries a phone number, the model ends its reply with
// an EMPTY fenced block:
//
//   ```maika-callback
//   {}
//   ```
//
// The block only says "this turn is a callback request". The NUMBER is never
// taken from the model: it is read here from the customer's own last one or
// two turns, so the model cannot invent or mistype digits, and a prompt that
// talks the model into emitting the block still needs a real number typed by
// the customer.
//
// WHAT HAPPENS (handleCallbackRequest, called only from the faq-chat success
// branch, in the background — the chat reply never waits for any of it):
//   1. extract a Georgian phone number from the last 1–2 USER turns
//      (none → nothing at all happens);
//   2. skip if the same number already asked within 24 hours;
//   3. rate limit: check_and_increment_rate_limit, key callback:<user|ip>,
//      3 per day;
//   4. insert into public.callback_requests (service role — the table has no
//      INSERT policy) — the ONLY place the raw number is stored;
//   5. e-mail maika@maika.ge through Resend and record email_sent_at /
//      email_error on the row.
//
// The block itself is ALWAYS stripped from the reply (stripCallbackBlock)
// before chat_logs and before the response, whether or not 1–5 succeed.
//
// Plain TypeScript, no Deno or npm imports at module level: every side effect
// goes through the injected CallbackDeps, so vitest loads this file directly
// (src/test/callbackRequest.test.ts) and the code under test is the code that
// runs in production.
import { redactPii } from "./redactPii.ts";

// ── Block detection / stripping ────────────────────────────────────────────

/** Closed OR truncated fence (same shape as maika-order-status / -mockup). */
const CALLBACK_FENCE_RE = /```maika-callback\b[\s\S]*?(?:```|$)/g;

/** Written to chat_logs in place of the block. */
export const CALLBACK_LOG_MARKER = "[ზარის მოთხოვნა]";

export function hasCallbackBlock(text: string): boolean {
  if (!text) return false;
  CALLBACK_FENCE_RE.lastIndex = 0;
  return CALLBACK_FENCE_RE.test(text);
}

/** Remove every maika-callback fence (closed or truncated); trim what is left. */
export function stripCallbackBlock(text: string): string {
  if (!text) return text;
  return text.replace(CALLBACK_FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Phone extraction ───────────────────────────────────────────────────────

/**
 * Candidate phone run — the SAME pattern redactPii.ts uses (PHONE_RE there),
 * so anything that would be masked in chat_logs is what can be extracted here.
 * Copied rather than imported because redactPii.ts keeps it private and has a
 * byte-for-byte twin in meta-webhook that must not drift.
 */
const PHONE_RE = /[+(]?\d[\d\s()./\\_-]{6,}\d/g;

/** maika.ge's own published numbers, national 9-digit form. Never a callback. */
const OWN_NATIONAL = new Set(["322050620", "599050807"]);

/**
 * A Georgian number in national form (9 digits), or null.
 * Accepts 9 digits, 995 + 9 digits, and 00995 + 9 digits. Georgian national
 * numbers start with 3, 4 (landlines by region) or 5, 7 (mobile / non-geo).
 */
export function normalizeGeorgianPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 14 && d.startsWith("00995")) d = d.slice(5);
  else if (d.length === 12 && d.startsWith("995")) d = d.slice(3);
  if (d.length !== 9) return null;
  if (!/^[3457]/.test(d)) return null;
  return d;
}

/** "+995 577 12 34 56" — for the e-mail subject and the admin list. */
export function formatGeorgianPhone(national: string): string {
  return `+995 ${national.slice(0, 3)} ${national.slice(3, 5)} ${national.slice(5, 7)} ${national.slice(7, 9)}`;
}

/**
 * The customer's phone number from their last one or two USER turns (newest
 * first), as E.164 ("+995577123456"), or null. Our own numbers are skipped —
 * a customer quoting the showroom number back is not leaving theirs.
 */
export function extractCallbackPhone(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  const userTurns = messages
    .filter((m): m is { role: string; content: string } =>
      !!m && typeof m === "object" && (m as { role?: unknown }).role === "user" &&
      typeof (m as { content?: unknown }).content === "string")
    .slice(-2)
    .reverse();
  for (const turn of userTurns) {
    for (const match of turn.content.match(PHONE_RE) ?? []) {
      const national = normalizeGeorgianPhone(match);
      if (national && !OWN_NATIONAL.has(national)) return `+995${national}`;
    }
  }
  return null;
}

/** The last USER turn's text, or "" — for the e-mail and the admin note. */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

// ── E-mail ─────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "2026-10-15 14:05" in Asia/Tbilisi. */
export function tbilisiTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tbilisi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export const CALLBACK_ADMIN_URL = "https://maika.ge/admin?tab=callbacks";
export const CALLBACK_RECIPIENT = "maika@maika.ge";

export function buildCallbackEmail(input: {
  phone: string; // E.164
  createdAt: Date;
  lang: string | null;
  lastMessage: string;
}): { subject: string; html: string } {
  const display = formatGeorgianPhone(input.phone.replace(/^\+995/, ""));
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${label}</td><td style="padding:8px;border:1px solid #ddd;">${value}</td></tr>`;
  const html = `
<h2>📞 ახალი ზარის მოთხოვნა ჩატიდან</h2>
<table style="border-collapse:collapse;width:100%;max-width:600px;">
  ${row("ტელეფონი", `<a href="tel:${escapeHtml(input.phone)}">${escapeHtml(display)}</a>`)}
  ${row("დრო (თბილისი)", escapeHtml(tbilisiTime(input.createdAt)))}
  ${row("ენა", escapeHtml(input.lang || "—"))}
  ${row("კლიენტის ბოლო შეტყობინება", `<div style="white-space:pre-wrap;">${escapeHtml(input.lastMessage.slice(0, 2000))}</div>`)}
</table>
<p><a href="${CALLBACK_ADMIN_URL}">ადმინ პანელი → დარეკვის მოთხოვნები</a></p>
`.trim();
  return { subject: `📞 დარეკვა: ${display}`, html };
}

/**
 * One e-mail through Resend's HTTP API — the same call create-payment,
 * send-corporate-inquiry and the weekly report already make. `fetchFn` is
 * injected for tests. Never throws.
 */
export async function sendViaResend(
  fetchFn: typeof fetch,
  apiKey: string | undefined,
  from: string,
  msg: { to: string; subject: string; html: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html }),
    });
    if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Orchestration ──────────────────────────────────────────────────────────

export interface CallbackRow {
  phone: string;
  session_id: string | null;
  user_id: string | null;
  lang: string | null;
  note: string;
}

export interface CallbackDeps {
  now(): Date;
  /** true = allowed, false = over the limit, null = check failed (fail open). */
  rateLimit(key: string): Promise<boolean | null>;
  /** Has this phone asked since `sinceIso`? */
  recentRequestExists(phone: string, sinceIso: string): Promise<boolean>;
  /** Insert and return the new row id, or null on failure. */
  insert(row: CallbackRow): Promise<string | null>;
  update(id: string, fields: { email_sent_at?: string; email_error?: string }): Promise<void>;
  /** Send one e-mail; { ok:false, error } on any failure. Never throws. */
  sendEmail(msg: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }>;
  log(...args: unknown[]): void;
}

export type CallbackOutcome =
  | "no_phone"
  | "duplicate"
  | "rate_limited"
  | "insert_failed"
  | "email_failed"
  | "sent"
  | "error";

export const CALLBACK_DAY_LIMIT = 3;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Steps 1–5 above. Never throws: every failure is logged and becomes an
 * outcome, so the caller (runInBackground) has nothing to catch.
 */
export async function handleCallbackRequest(
  deps: CallbackDeps,
  input: {
    messages: unknown;
    sessionId: string | null;
    userId: string | null;
    lang: string | null;
    /** callback:user:<id> or callback:ip:<ip> */
    rateKey: string;
  },
): Promise<CallbackOutcome> {
  try {
    const phone = extractCallbackPhone(input.messages);
    if (!phone) return "no_phone";

    const now = deps.now();
    if (await deps.recentRequestExists(phone, new Date(now.getTime() - DEDUPE_WINDOW_MS).toISOString())) {
      return "duplicate";
    }

    const allowed = await deps.rateLimit(input.rateKey);
    if (allowed === false) {
      deps.log("[callback] rate limit reached for", input.rateKey);
      return "rate_limited";
    }
    // null = the check itself failed → fail open, like every other limiter.

    const lastMessage = lastUserText(input.messages);
    const id = await deps.insert({
      phone,
      session_id: input.sessionId,
      user_id: input.userId,
      lang: input.lang,
      // Context for the admin list. Masked like chat_logs: the raw number
      // lives in `phone` and nowhere else.
      note: redactPii(lastMessage).slice(0, 500),
    });
    if (!id) return "insert_failed";

    const email = buildCallbackEmail({ phone, createdAt: now, lang: input.lang, lastMessage });
    const sent = await deps.sendEmail({ to: CALLBACK_RECIPIENT, ...email });
    if (sent.ok) {
      await deps.update(id, { email_sent_at: deps.now().toISOString() });
      return "sent";
    }
    await deps.update(id, { email_error: (sent.error || "unknown").slice(0, 500) });
    return "email_failed";
  } catch (e) {
    deps.log("[callback] failed (ignored):", e);
    return "error";
  }
}
