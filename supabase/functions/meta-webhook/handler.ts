// Meta (Messenger + Instagram DM) webhook — the whole request handler, with
// NO Deno APIs and NO supabase-js, so vitest can drive it end to end in Node
// with a signed request and an in-memory store. index.ts is the thin Deno
// entry that reads the environment and supplies the real service-role writer.
//
// PHASE 1 IS A READ-ONLY MIRROR. This handler never calls Meta, never replies,
// never resolves a profile. It verifies, parses, redacts and stores.
//
// AUTH. The endpoint is public (verify_jwt = false — Meta cannot send a
// Supabase JWT). What stops anyone on the internet from writing invented
// conversations into the table is the signature: every POST carries
// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, META_APP_SECRET).
// It is checked over the RAW bytes, BEFORE any JSON parsing, with a
// constant-time comparison. Missing or wrong → 401, nothing written.
//
// SHAPES (Meta's documented webhook formats; anything marked UNVERIFIED in the
// tests is a field whose exact spelling could not be confirmed offline):
//
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   (subscription check)
//   POST { object: "page" | "instagram",
//          entry: [{ id: <page or IG account id>, time: <epoch ms>,
//                    messaging: [{ sender: {id}, recipient: {id}, timestamp: <epoch ms>,
//                                  message?: { mid, text?, attachments?: [{type, payload: {url?}}],
//                                              is_echo?, is_deleted?, is_unsupported? },
//                                  read? | delivery? | reaction? | postback? | … }] }] }
//
// WHAT IS STORED: `message` events only, both directions. An `is_echo` message
// is the page's own reply, delivered back to us — that is the operator's half
// of the conversation and is stored as direction 'out'.
//
// WHAT IS IGNORED, and why:
//   read / delivery   receipts — no content, and the timing of a read is not
//                     what the table is for
//   reaction          an emoji on a message — no text, no thread value
//   postback / optin / referral   button clicks and entry points — carry no
//                     message id to dedupe on and no customer words
//   message_edit      UNVERIFIED shape; the original mid already has a row
//   is_deleted        a retraction — there is nothing to store and phase 1
//                     does not update rows
//   entry[].changes   Instagram comment / mention events — not DMs
// Each ignored event is counted and logged by kind so the log shows what the
// webhook is subscribed to that the mirror is not keeping.
//
// RESILIENCE. One malformed event is logged and skipped; the rest of the
// batch is still stored. Parse problems are never a reason to fail the
// request: Meta would only retry the same bytes. A STORE failure is the one
// case where a retry can help, so that returns 500 (see index.ts for the
// trade-off with Meta's disable-after-repeated-failures rule).

import { redactPii } from "./redactPii.ts";

export type Channel = "messenger" | "instagram";
export type Direction = "in" | "out";

export interface SocialMessageRow {
  channel: Channel;
  page_id: string;
  customer_id: string;
  meta_message_id: string;
  sender_id: string;
  direction: Direction;
  text: string | null;
  attachments: { type: string; url: string | null }[];
  unsupported: boolean;
  /** ISO 8601, from messaging[].timestamp (epoch ms). */
  sent_at: string;
}

export interface StoreResult {
  /** Rows actually inserted (a duplicate mid counts as 0). */
  inserted: number;
  /** Set when the store could not complete; the handler answers 500. */
  error: string | null;
}

export interface HandlerDeps {
  appSecret: string;
  verifyToken: string;
  /** Insert with ON CONFLICT (meta_message_id) DO NOTHING semantics. */
  store: (rows: SocialMessageRow[]) => Promise<StoreResult>;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

const enc = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time equality over two strings of ASCII hex. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "sha256=" + hex(HMAC-SHA256(secret, body)) — exactly what Meta sends. */
export async function computeMetaSignature(secret: string, rawBody: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, rawBody as BufferSource);
  return `sha256=${toHex(sig)}`;
}

export async function verifyMetaSignature(secret: string, rawBody: Uint8Array, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = await computeMetaSignature(secret, rawBody);
  return timingSafeEqualHex(header.toLowerCase(), expected);
}

// ── parsing ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export interface ParseOutcome {
  rows: SocialMessageRow[];
  /** Events seen but not stored, by kind (read, delivery, reaction, …). */
  ignored: Record<string, number>;
  /** Events that could not be read at all. */
  malformed: number;
}

function channelFor(object: unknown): Channel | null {
  if (object === "page") return "messenger";
  if (object === "instagram") return "instagram";
  return null;
}

/**
 * Turn one `messaging[]` event into a row, or explain why not.
 * Returns { row } to store, { ignore: kind } to count, or throws on a shape
 * that cannot be read (the caller counts it as malformed and moves on).
 */
function eventToRow(channel: Channel, entryId: string | null, ev: unknown): { row: SocialMessageRow } | { ignore: string } {
  if (!isObj(ev)) throw new Error("event is not an object");
  const message = ev.message;
  if (!isObj(message)) {
    // Not a message. Name the kind so the log shows what we are subscribed to.
    for (const k of ["read", "delivery", "reaction", "postback", "optin", "referral", "message_edit", "account_linking", "pass_thread_control"]) {
      if (k in ev) return { ignore: k };
    }
    return { ignore: "unknown" };
  }
  if (message.is_deleted === true) return { ignore: "is_deleted" };

  const mid = str(message.mid);
  const senderId = str(isObj(ev.sender) ? ev.sender.id : null);
  const recipientId = str(isObj(ev.recipient) ? ev.recipient.id : null);
  const ts = typeof ev.timestamp === "number" && Number.isFinite(ev.timestamp) ? ev.timestamp : null;
  if (!mid) throw new Error("message.mid missing");
  if (!senderId || !recipientId) throw new Error("sender/recipient id missing");
  if (ts === null) throw new Error("timestamp missing");

  const isEcho = message.is_echo === true;
  // For an inbound message the customer is the sender; for an echo (the
  // page's own reply) the customer is the recipient. The page id comes from
  // entry[].id, with the page-side of the event as a fallback.
  const pageId = entryId ?? (isEcho ? senderId : recipientId);
  const customerId = isEcho ? recipientId : senderId;

  const unsupported = message.is_unsupported === true;
  const rawText = str(message.text);
  const attachments: SocialMessageRow["attachments"] = [];
  if (Array.isArray(message.attachments)) {
    for (const a of message.attachments) {
      if (!isObj(a)) continue;
      const type = str(a.type) ?? "unknown";
      const url = isObj(a.payload) ? str(a.payload.url) : null;
      attachments.push({ type, url });
    }
  }

  return {
    row: {
      channel,
      page_id: pageId,
      customer_id: customerId,
      meta_message_id: mid,
      sender_id: senderId,
      direction: isEcho ? "out" : "in",
      text: rawText === null ? null : redactPii(rawText),
      attachments,
      unsupported,
      sent_at: new Date(ts).toISOString(),
    },
  };
}

/** Parse a whole delivery. Never throws: bad events are counted, not fatal. */
export function parseDelivery(body: unknown): ParseOutcome {
  const out: ParseOutcome = { rows: [], ignored: {}, malformed: 0 };
  const count = (k: string) => { out.ignored[k] = (out.ignored[k] ?? 0) + 1; };
  if (!isObj(body)) { out.malformed += 1; return out; }
  const channel = channelFor(body.object);
  if (!channel) { count(`object:${String(body.object)}`); return out; }
  if (!Array.isArray(body.entry)) { out.malformed += 1; return out; }

  for (const entry of body.entry) {
    if (!isObj(entry)) { out.malformed += 1; continue; }
    const entryId = str(entry.id);
    if (Array.isArray(entry.changes) && !Array.isArray(entry.messaging)) {
      count("changes");
      continue;
    }
    if (!Array.isArray(entry.messaging)) { out.malformed += 1; continue; }
    for (const ev of entry.messaging) {
      try {
        const r = eventToRow(channel, entryId, ev);
        if ("row" in r) out.rows.push(r.row);
        else count(r.ignore);
      } catch {
        out.malformed += 1;
      }
    }
  }
  // Two events in one delivery can carry the same mid; keep the first.
  const seen = new Set<string>();
  out.rows = out.rows.filter((r) => (seen.has(r.meta_message_id) ? false : (seen.add(r.meta_message_id), true)));
  return out;
}

// ── HTTP ───────────────────────────────────────────────────────────────────

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleMetaWebhook(req: Request, deps: HandlerDeps): Promise<Response> {
  const log = deps.log ?? ((level, msg) => console[level === "info" ? "log" : level](`[meta-webhook] ${msg}`));

  if (req.method === "GET") {
    // Subscription check. Meta calls this once when the callback URL is saved
    // in the App dashboard, and expects hub.challenge back verbatim.
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token !== null && challenge !== null && deps.verifyToken.length > 0 && timingSafeEqualHex(token, deps.verifyToken)) {
      log("info", "subscription verified");
      return text(200, challenge);
    }
    log("warn", "subscription check refused");
    return text(403, "forbidden");
  }

  if (req.method !== "POST") return text(405, "method not allowed");

  // RAW body first — the signature is over these exact bytes.
  const raw = new Uint8Array(await req.arrayBuffer());
  const ok = deps.appSecret.length > 0 && (await verifyMetaSignature(deps.appSecret, raw, req.headers.get("x-hub-signature-256")));
  if (!ok) {
    log("warn", "bad signature — delivery refused, nothing written");
    return text(401, "unauthorized");
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    // Signed but not JSON: nothing to store, nothing to retry.
    log("warn", "signed body is not JSON — skipped");
    return text(200, "ignored");
  }

  const parsed = parseDelivery(body);
  const ignoredSummary = Object.entries(parsed.ignored).map(([k, n]) => `${k}=${n}`).join(",");
  if (parsed.malformed > 0 || ignoredSummary) {
    log("info", `parsed rows=${parsed.rows.length} malformed=${parsed.malformed} ignored=[${ignoredSummary}]`);
  }
  if (parsed.rows.length === 0) return text(200, "ok");

  const stored = await deps.store(parsed.rows);
  if (stored.error) {
    // The only failure worth a Meta retry: the bytes were fine, the write was not.
    log("error", `store failed: ${stored.error}`);
    return text(500, "store failed");
  }
  log("info", `stored ${stored.inserted}/${parsed.rows.length} (duplicates skipped)`);
  return text(200, "ok");
}
