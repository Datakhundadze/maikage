// WhatsApp Cloud API webhook — parsing and the delivery handler (add-only,
// 2026-11-02). NO Deno APIs and NO supabase-js, so vitest drives it; index.ts
// supplies the real store. handler.ts calls handleWhatsAppDelivery only for a
// signed POST whose body.object is "whatsapp_business_account" — Messenger and
// Instagram deliveries never reach this file.
//
// SAME APP, SAME URL. Meta delivers WhatsApp webhooks of the "Maika.ge" app to
// the same meta-webhook callback, signed with the same app secret
// (X-Hub-Signature-256, verified in handler.ts before this runs). The GET
// handshake is the same hub.mode / hub.verify_token / hub.challenge one.
//
// SHAPES (Meta's documented WhatsApp Cloud API formats; UNVERIFIED marks a
// field whose exact spelling could not be confirmed offline):
//
//   { object: "whatsapp_business_account",
//     entry: [{ id: <WABA id>, changes: [{ field, value }] }] }
//
//   field "messages":
//     value: { messaging_product: "whatsapp",
//              metadata: { display_phone_number, phone_number_id },
//              contacts?: [{ wa_id, profile: { name } }],
//              messages?: [{ from, id: "wamid…", timestamp: "<epoch s>", type,
//                            text?: { body }, image?: { id, mime_type, caption? },
//                            audio? / video? / document? / sticker?: { id, … },
//                            location?: { latitude, longitude, name?, address? },
//                            button?: { text, payload },
//                            interactive?: { type, button_reply?|list_reply?: { id, title } },
//                            reaction? / contacts? / order? / system? / errors? }],
//              statuses?: [{ id, status, timestamp, recipient_id, errors? }] }
//
//   field "smb_message_echoes" (coexistence: what the operator sent from the
//   WhatsApp Business app on the phone):
//     value: { metadata, message_echoes: [{ from: <our number>, to: <customer>,
//                                           id, timestamp, type, …same payloads }] }
//     UNVERIFIED: the array name; `messages` is read as a fallback.
//
//   field "history" / "smb_app_state_sync" (coexistence onboarding sync) and
//   "account_update": logged as a compact summary only. TODO: store history.
//
// IDENTITY. channel "whatsapp", page_id = metadata.phone_number_id,
// customer_id = the customer's wa_id (E.164 digits, no "+"), so the generated
// conversation_key is "whatsapp:<phone_number_id>:<wa_id>".
//
// IMAGES are not downloaded here. The attachment url is the Graph media
// endpoint (https://graph.facebook.com/v21.0/<media-id>, no secret in it);
// index.ts fetches it with the Bearer and copies the picture into
// social-uploads exactly like a DM photo (media.ts mirrorRowImages).
//
// PRIVACY. No log line from this file carries a phone number, a wa_id, a
// profile name or message text — only counts. Profile names stay in memory.

import { redactPii } from "./redactPii.ts";
import { extractContacts, hasContacts, type CapturedContacts } from "./orderContacts.ts";
import type { Channel, ContactsByMid, SocialAttachment, SocialMessageRow, StoreResult } from "./handler.ts";
import { waMediaUrl } from "./whatsappSend.ts";

export const WA_OBJECT = "whatsapp_business_account";

/** Stored as the text of a message the inbox cannot show as text or a photo. */
export const WA_PLACEHOLDERS: Record<string, string> = {
  audio: "[ხმოვანი შეტყობინება]",
  video: "[ვიდეო]",
  document: "[ფაილი]",
  sticker: "[სტიკერი]",
  location: "[მდებარეობა]",
  contacts: "[კონტაქტი]",
  order: "[კატალოგის შეკვეთა]",
  interactive: "[პასუხი ღილაკით]",
  unknown: "[შეტყობინება]",
};

/** Message types the bot may answer: customer words or a photo. Placeholders never trigger it. */
export const WA_BOT_TYPES: ReadonlySet<string> = new Set(["text", "image", "button", "interactive"]);

/** Attachment type per media message type, in the Messenger vocabulary the inbox already knows. */
const ATTACHMENT_TYPE: Record<string, string> = {
  image: "image",
  sticker: "sticker",
  audio: "audio",
  video: "video",
  document: "file",
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export interface WaParseOutcome {
  rows: SocialMessageRow[];
  /** mids of inbound rows whose type may trigger the bot (WA_BOT_TYPES). */
  botEligible: Set<string>;
  /** Raw-text phones / emails of inbound messages, by mid (never stored, never logged). */
  contacts: ContactsByMid;
  /** wa_id → WhatsApp profile name. In memory only (social_messages has no name column). */
  profiles: Map<string, string>;
  /** statuses[] by status (sent / delivered / read / failed). */
  statuses: Record<string, number>;
  /** Events seen but not stored, by kind. */
  ignored: Record<string, number>;
  malformed: number;
  /** Compact, PII-free summaries (history, app state sync, account_update, failed statuses). */
  notes: string[];
}

/** WhatsApp sends epoch SECONDS as a string. */
function tsToIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

interface Content {
  text: string | null;
  attachments: SocialAttachment[];
  unsupported: boolean;
  /** Customer-typed text, before redaction (for orderContacts). */
  raw: string | null;
}

const join = (...parts: (string | null | undefined)[]): string | null => {
  const t = parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" ").trim();
  return t === "" ? null : t;
};

/** The stored text / attachments of one WhatsApp message (inbound or echo). */
export function waContent(m: Json): Content | { ignore: string } {
  const type = str(m.type) ?? "unknown";
  const body = (k: string): Json => (isObj(m[k]) ? (m[k] as Json) : {});
  switch (type) {
    case "text": {
      const raw = str(body("text").body);
      return { text: raw === null ? null : redactPii(raw), attachments: [], unsupported: false, raw };
    }
    case "image":
    case "sticker":
    case "audio":
    case "video":
    case "document": {
      const b = body(type);
      const id = str(b.id);
      const caption = str(b.caption);
      const attachments: SocialAttachment[] = [{ type: ATTACHMENT_TYPE[type], url: id ? waMediaUrl(id) : null }];
      const shown = caption === null ? null : redactPii(caption);
      // A photo is shown as a photo (its caption, if any, as text) — like a DM photo.
      const text = type === "image" ? shown : join(WA_PLACEHOLDERS[type], shown);
      return { text, attachments, unsupported: false, raw: caption };
    }
    case "location": {
      const b = body("location");
      const lat = typeof b.latitude === "number" ? b.latitude : null;
      const lon = typeof b.longitude === "number" ? b.longitude : null;
      const label = join(str(b.name), str(b.address));
      const link = lat !== null && lon !== null ? `https://maps.google.com/?q=${lat},${lon}` : null;
      return { text: join(WA_PLACEHOLDERS.location, label === null ? null : redactPii(label), link), attachments: [], unsupported: false, raw: null };
    }
    case "button": {
      const raw = str(body("button").text);
      return { text: raw === null ? null : redactPii(raw), attachments: [], unsupported: false, raw };
    }
    case "interactive": {
      const b = body("interactive");
      const reply = isObj(b.button_reply) ? b.button_reply : isObj(b.list_reply) ? b.list_reply : null;
      const raw = reply ? str(reply.title) : null;
      return { text: raw === null ? WA_PLACEHOLDERS.interactive : redactPii(raw), attachments: [], unsupported: false, raw };
    }
    case "contacts":
    case "order":
      return { text: WA_PLACEHOLDERS[type], attachments: [], unsupported: false, raw: null };
    case "reaction":
    case "system":
    case "ephemeral":
      return { ignore: type };
    case "unsupported":
      return { text: null, attachments: [], unsupported: true, raw: null };
    default:
      return { text: WA_PLACEHOLDERS.unknown, attachments: [], unsupported: false, raw: null };
  }
}

/**
 * One inbound message (direction "in") or one echo of the operator's phone
 * app (direction "out") → a row, { ignore }, or a throw on an unreadable shape.
 */
function messageToRow(
  direction: "in" | "out",
  phoneNumberId: string,
  m: unknown,
): { row: SocialMessageRow; type: string; contacts?: CapturedContacts } | { ignore: string } {
  if (!isObj(m)) throw new Error("message is not an object");
  const mid = str(m.id);
  const sentAt = tsToIso(m.timestamp);
  const from = str(m.from);
  const to = str(m.to);
  if (!mid) throw new Error("message id missing");
  if (!sentAt) throw new Error("timestamp missing");
  const customerId = direction === "in" ? from : to;
  if (!customerId) throw new Error(direction === "in" ? "from missing" : "to missing");

  const c = waContent(m);
  if ("ignore" in c) return c;
  const contacts = direction === "in" && c.raw !== null ? extractContacts(c.raw) : null;
  const channel: Channel = "whatsapp";
  return {
    type: str(m.type) ?? "unknown",
    ...(contacts && hasContacts(contacts) ? { contacts } : {}),
    row: {
      channel,
      page_id: phoneNumberId,
      customer_id: customerId,
      meta_message_id: mid,
      // The page side of an out row is our number, as Messenger's out rows carry the page id.
      sender_id: direction === "in" ? customerId : phoneNumberId,
      direction,
      text: c.text,
      attachments: c.attachments,
      unsupported: c.unsupported,
      sent_at: sentAt,
    },
  };
}

/** Parse a whole WhatsApp delivery. Never throws: bad events are counted, not fatal. */
export function parseWhatsAppDelivery(body: unknown): WaParseOutcome {
  const out: WaParseOutcome = {
    rows: [], botEligible: new Set(), contacts: new Map(), profiles: new Map(),
    statuses: {}, ignored: {}, malformed: 0, notes: [],
  };
  const count = (k: string): void => { out.ignored[k] = (out.ignored[k] ?? 0) + 1; };
  if (!isObj(body) || body.object !== WA_OBJECT || !Array.isArray(body.entry)) { out.malformed += 1; return out; }

  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) { out.malformed += 1; continue; }
    for (const change of entry.changes) {
      if (!isObj(change) || !isObj(change.value)) { out.malformed += 1; continue; }
      const field = str(change.field) ?? "unknown";
      const value = change.value;
      const phoneNumberId = str(isObj(value.metadata) ? value.metadata.phone_number_id : null);

      if (field === "messages" || field === "smb_message_echoes") {
        if (!phoneNumberId) { out.malformed += 1; continue; }
        if (Array.isArray(value.contacts)) {
          for (const ct of value.contacts) {
            const waId = isObj(ct) ? str(ct.wa_id) : null;
            const name = isObj(ct) && isObj(ct.profile) ? str(ct.profile.name) : null;
            if (waId && name && !out.profiles.has(waId)) out.profiles.set(waId, name);
          }
        }
        const isEcho = field === "smb_message_echoes";
        const list = isEcho
          ? (Array.isArray(value.message_echoes) ? value.message_echoes : Array.isArray(value.messages) ? value.messages : [])
          : (Array.isArray(value.messages) ? value.messages : []);
        for (const m of list) {
          try {
            const r = messageToRow(isEcho ? "out" : "in", phoneNumberId, m);
            if ("row" in r) {
              out.rows.push(r.row);
              if (!isEcho && WA_BOT_TYPES.has(r.type)) out.botEligible.add(r.row.meta_message_id);
              if (r.contacts && !out.contacts.has(r.row.meta_message_id)) out.contacts.set(r.row.meta_message_id, r.contacts);
            } else count(r.ignore);
          } catch {
            out.malformed += 1;
          }
        }
        if (Array.isArray(value.statuses)) {
          for (const s of value.statuses) {
            const st = isObj(s) ? str(s.status) ?? "unknown" : "unknown";
            out.statuses[st] = (out.statuses[st] ?? 0) + 1;
            if (st === "failed" && isObj(s) && Array.isArray(s.errors)) {
              const codes = s.errors.map((e: unknown): string => (isObj(e) ? String(e.code ?? "?") : "?")).join(",");
              out.notes.push(`status failed code=${codes}`);
            }
          }
        }
        continue;
      }

      if (field === "history") {
        // TODO(whatsapp-history): store the synced chat history (coexistence onboarding).
        const chunks = Array.isArray(value.history) ? value.history : [];
        let threads = 0;
        let messages = 0;
        for (const h of chunks) {
          const ts = isObj(h) && Array.isArray(h.threads) ? h.threads : [];
          threads += ts.length;
          for (const t of ts) messages += isObj(t) && Array.isArray(t.messages) ? t.messages.length : 0;
        }
        out.notes.push(`history (TODO, not stored): chunks=${chunks.length} threads=${threads} messages=${messages}`);
        continue;
      }
      if (field === "smb_app_state_sync") {
        // TODO(whatsapp-state-sync): contacts from the phone app — not stored.
        const items = Array.isArray(value.state_sync) ? value.state_sync : [];
        const byAction: Record<string, number> = {};
        for (const it of items) {
          const a = isObj(it) ? str(it.action) ?? "?" : "?";
          byAction[a] = (byAction[a] ?? 0) + 1;
        }
        const s = Object.entries(byAction).map(([k, n]) => `${k}=${n}`).join(",");
        out.notes.push(`smb_app_state_sync (TODO, not stored): items=${items.length}${s ? ` [${s}]` : ""}`);
        continue;
      }
      if (field === "account_update") {
        out.notes.push(`account_update event=${str(value.event) ?? "?"}`);
        continue;
      }
      count(`field:${field}`);
    }
  }
  // Two events in one delivery can carry the same wamid; keep the first.
  const seen = new Set<string>();
  out.rows = out.rows.filter((r: SocialMessageRow): boolean => (seen.has(r.meta_message_id) ? false : (seen.add(r.meta_message_id), true)));
  return out;
}

/** What index.ts receives with the rows (memory only). */
export interface WaStoreExtras {
  contacts: ContactsByMid;
  botEligible: Set<string>;
}

export interface WhatsAppDeps {
  /** Insert with ON CONFLICT (meta_message_id) DO NOTHING semantics. */
  store: (rows: SocialMessageRow[], extras: WaStoreExtras) => Promise<StoreResult>;
}

const textResponse = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * A signed WhatsApp delivery. Same contract as the Messenger path: parse
 * problems never fail the request; only a store failure answers 500 (so Meta
 * retries).
 */
export async function handleWhatsAppDelivery(
  body: unknown,
  deps: WhatsAppDeps,
  log: (level: "info" | "warn" | "error", msg: string) => void,
): Promise<Response> {
  const parsed = parseWhatsAppDelivery(body);
  const kv = (o: Record<string, number>): string => Object.entries(o).map(([k, n]) => `${k}=${n}`).join(",");
  const ignored = kv(parsed.ignored);
  const statuses = kv(parsed.statuses);
  if (parsed.malformed > 0 || ignored || statuses) {
    log("info", `whatsapp: parsed rows=${parsed.rows.length} malformed=${parsed.malformed} ignored=[${ignored}] statuses=[${statuses}]`);
  }
  for (const n of parsed.notes) log("info", `whatsapp: ${n}`);
  if (parsed.rows.length === 0) return textResponse(200, "ok");

  const stored = await deps.store(parsed.rows, { contacts: parsed.contacts, botEligible: parsed.botEligible });
  if (stored.error) {
    log("error", `whatsapp: store failed: ${stored.error}`);
    return textResponse(500, "store failed");
  }
  log("info", `whatsapp: stored ${stored.inserted}/${parsed.rows.length} (duplicates skipped)`);
  return textResponse(200, "ok");
}

/** gemini-proxy trusts only "messenger" | "instagram" (socialChannel.ts); WhatsApp asks as a DM. */
export function proxyChannelFor(channel: Channel): "messenger" | "instagram" {
  return channel === "instagram" ? "instagram" : "messenger";
}

/** The bot's own message as an out row: Cloud API sends are NOT echoed back by Meta. */
export function waBotOutRow(
  phoneNumberId: string,
  to: string,
  messageId: string,
  text: string | null,
  attachments: SocialAttachment[],
  now: Date,
): SocialMessageRow {
  return {
    channel: "whatsapp",
    page_id: phoneNumberId,
    customer_id: to,
    meta_message_id: messageId,
    sender_id: phoneNumberId,
    direction: "out",
    // Redacted exactly like social_bot_replies.text, so isBotEcho matches the two.
    text: text === null ? null : redactPii(text),
    attachments,
    unsupported: false,
    sent_at: now.toISOString(),
  };
}
