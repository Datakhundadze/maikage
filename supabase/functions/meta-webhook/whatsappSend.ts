// WhatsApp Cloud API — request bodies, the HTTP call, media download and the
// log-masking helpers (add-only, 2026-11-02). NO Deno APIs and NO supabase-js:
// `fetch` is passed in, so vitest drives every function with fakes. index.ts
// supplies the real fetch and WHATSAPP_TOKEN.
//
// SEND. POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
//   text:  { messaging_product: "whatsapp", recipient_type: "individual", to,
//            type: "text", text: { body, preview_url: false } }   (body ≤ 4096 chars)
//   image: { …, type: "image", image: { link } }                   (public https URL)
//   read:  { messaging_product: "whatsapp", status: "read", message_id }
// Response: { messaging_product, contacts: [{ input, wa_id }], messages: [{ id: "wamid…" }] }
//
// 24 h WINDOW. Free-form messages are allowed only within 24 h of the
// customer's last message. The bot only ever answers a freshly stored INBOUND
// message (withinReplyWindow guards Meta retries of old deliveries); nothing
// here sends proactively.
//
// TOKENS travel only in the Authorization header — never in a URL, never in a
// log line. A Bearer is sent ONLY to Meta's own hosts (isMetaMediaHost).

import type { SendResult } from "./autoReply.ts";
import { capText } from "./botReply.ts";
import { isScheduleActive } from "./botSchedule.ts";

export const WA_GRAPH = "https://graph.facebook.com/v21.0";
/** WhatsApp text message body limit. */
export const WA_MAX_TEXT = 4096;
/** Reply only to inbound messages younger than this (Meta's window is 24 h). */
export const WA_REPLY_WINDOW_MS = 23 * 60 * 60 * 1000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── masking for logs ───────────────────────────────────────────────────────

/** "995599123456" → "*********456". Anything with < 4 digits → "***". */
export function maskPhone(v: string | null | undefined): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${"*".repeat(digits.length - 3)}${digits.slice(-3)}`;
}

/**
 * A log line made safe: every run of 7+ digits (phone numbers, wa_ids, phone
 * number ids) keeps only its last 3 digits, and a wamid — which is base64 of
 * data that includes the customer's number — keeps only its last 6 characters.
 */
export function scrubWaLog(msg: string): string {
  return String(msg ?? "")
    .replace(/wamid\.[A-Za-z0-9_=+/-]+/g, (m: string): string => `wamid.***${m.slice(-6)}`)
    .replace(/\+?\d{7,}/g, (m: string): string => maskPhone(m));
}

// ── bodies ─────────────────────────────────────────────────────────────────

export const waMessagesUrl = (phoneNumberId: string): string =>
  `${WA_GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`;

/** The Graph media endpoint of a media id (GET with the Bearer → { url, mime_type, file_size }). */
export const waMediaUrl = (mediaId: string): string => `${WA_GRAPH}/${encodeURIComponent(mediaId)}`;

export function waTextBody(to: string, text: string): Record<string, unknown> {
  const body = Array.from(text).length > WA_MAX_TEXT ? capText(text, WA_MAX_TEXT) : text;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body, preview_url: false },
  };
}

export function waImageBody(to: string, link: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { link },
  };
}

export function waReadBody(messageId: string): Record<string, unknown> {
  return { messaging_product: "whatsapp", status: "read", message_id: messageId };
}

// ── HTTP ───────────────────────────────────────────────────────────────────

/** POST a body to {phone_number_id}/messages. Never throws. */
export async function postWhatsApp(
  fetchFn: FetchLike,
  phoneNumberId: string,
  token: string,
  body: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<SendResult> {
  if (!token) return { ok: false, status: 0, code: "no_token" };
  try {
    const res = await fetchFn(waMessagesUrl(phoneNumberId), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch((): null => null) as
      | { messages?: { id?: unknown }[]; error?: { code?: unknown; error_subcode?: unknown; type?: unknown } }
      | null;
    if (!res.ok) {
      const err = data?.error;
      const code = err ? `${String(err.code ?? "?")}/${String(err.error_subcode ?? "-")}/${String(err.type ?? "-")}` : "no_body";
      return { ok: false, status: res.status, code };
    }
    const first = Array.isArray(data?.messages) ? data!.messages![0] : undefined;
    return { ok: true, messageId: first && typeof first.id === "string" ? first.id : null };
  } catch (e) {
    return { ok: false, status: 0, code: e instanceof Error ? e.name : "fetch_error" };
  }
}

/** Hosts that may receive the WhatsApp Bearer: Graph and Meta's media CDN. */
export function isMetaMediaHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  return h === "graph.facebook.com" || h === "lookaside.fbsbx.com" || h.endsWith(".fbsbx.com") ||
    h.endsWith(".whatsapp.net") || h.endsWith(".fbcdn.net");
}

export interface WaMedia {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Inbound media in two steps, both with the Bearer: GET {media-id} → JSON with
 * a short-lived `url` (≈ 5 min) → GET that url → bytes. Only image/* is
 * returned; anything else, oversize, a non-Meta host or any failure → null.
 */
export async function downloadWaMedia(
  fetchFn: FetchLike,
  mediaEndpoint: string,
  token: string,
  maxBytes: number,
  timeoutMs = 15_000,
): Promise<WaMedia | null> {
  if (!token || !mediaEndpoint.startsWith(`${WA_GRAPH}/`)) return null;
  try {
    const meta = await fetchFn(mediaEndpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!meta.ok) return null;
    const info = await meta.json().catch((): null => null) as { url?: unknown; mime_type?: unknown; file_size?: unknown } | null;
    const url = typeof info?.url === "string" ? info.url : "";
    const declaredType = typeof info?.mime_type === "string" ? info.mime_type : "";
    const declaredSize = Number(info?.file_size ?? 0);
    if (!url || !isMetaMediaHost(url)) return null;
    if (declaredType && !declaredType.toLowerCase().startsWith("image/")) return null;
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) return null;
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const headerType = res.headers.get("content-type") ?? "";
    const contentType = headerType.toLowerCase().startsWith("image/") ? headerType : declaredType;
    if (!contentType.toLowerCase().startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

// ── bot gating ─────────────────────────────────────────────────────────────

/** Can never equal a real conversation key (keys are channel:digits:digits). */
export const WA_ALLOWLIST_REQUIRED = "whatsapp:allow-list-required";

/**
 * WhatsApp is STRICT: the bot answers only numbers that are explicitly on
 * social_bot_settings.allow_keys. For Messenger an empty list means "everyone";
 * here an empty list becomes a list nobody matches, so runAutoReply returns
 * "not_allowlisted" instead of answering every WhatsApp customer.
 */
export function strictAllowKeys(keys: readonly string[] | null | undefined): string[] {
  const list = Array.isArray(keys) ? keys.filter((k: unknown): k is string => typeof k === "string") : [];
  return list.length > 0 ? list : [WA_ALLOWLIST_REQUIRED];
}

/**
 * Mark-read (blue ticks) only where the bot is in charge right now: enabled,
 * inside its schedule AND explicitly allow-listed. Everyone else's messages
 * stay unread on the operator's phone.
 */
export function waMayMarkRead(
  settings: { enabled: boolean; schedule?: string; allowKeys?: string[] } | null,
  conversationKey: string,
  now: Date,
): boolean {
  return !!settings && settings.enabled === true && isScheduleActive(settings.schedule, now) &&
    Array.isArray(settings.allowKeys) && settings.allowKeys.includes(conversationKey);
}

/** Inside the customer-service window (with an hour of margin). */
export function withinReplyWindow(sentAtIso: string, now: Date): boolean {
  const t = Date.parse(sentAtIso);
  return Number.isFinite(t) && now.getTime() - t < WA_REPLY_WINDOW_MS;
}
