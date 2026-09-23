// Pure helpers for the admin "შეტყობინებები" tab (AdminSocialInbox), kept out
// of the component so the grouping and formatting can be unit-tested.
//
// Source: public.social_messages, written ONLY by the meta-webhook edge
// function (service role). The admin reads it through the "Admins can read
// social_messages" SELECT policy; nothing on the client ever writes to it.

export type SocialChannel = "messenger" | "instagram";
export type SocialDirection = "in" | "out";

/** The columns the tab selects. Text is already PII-redacted at write time. */
export interface SocialMessageRow {
  id: string;
  channel: SocialChannel;
  customer_id: string;
  direction: SocialDirection;
  text: string | null;
  attachments: unknown;
  unsupported: boolean;
  sent_at: string;
}

export interface Conversation {
  /** Stable key: `${channel}:${customer_id}`. */
  key: string;
  channel: SocialChannel;
  customerId: string;
  lastAt: string;
  lastPreview: string;
  lastDirection: SocialDirection;
  count: number;
}

export const PREVIEW_CHARS = 60;

export function conversationKey(channel: string, customerId: string): string {
  return `${channel}:${customerId}`;
}

/** Last 6 characters of the Meta id, enough to tell threads apart on screen. */
export function shortCustomerId(id: string): string {
  return id.length <= 6 ? id : `…${id.slice(-6)}`;
}

/** Attachment types as stored ([{type, url}]); urls are temporary and not shown. */
export function attachmentTypes(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a) => (a && typeof a === "object" ? (a as { type?: unknown }).type : undefined))
    .filter((t): t is string => typeof t === "string" && t.length > 0);
}

/**
 * One-line summary of a message for the conversation list and for a bubble
 * with no text. Plain text only: the caller renders it as a React text node.
 */
export function messagePreview(m: Pick<SocialMessageRow, "text" | "attachments" | "unsupported">, max = PREVIEW_CHARS): string {
  const text = (m.text ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  const types = attachmentTypes(m.attachments);
  if (types.length > 0) return `[${types.join(", ")}]`;
  if (m.unsupported) return "[მხარდაუჭერელი შეტყობინება]";
  return "—";
}

/**
 * Group rows by (channel, customer_id). Input order does not matter.
 * Output: newest conversation first.
 */
export function groupConversations(rows: SocialMessageRow[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const r of rows) {
    const key = conversationKey(r.channel, r.customer_id);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        channel: r.channel,
        customerId: r.customer_id,
        lastAt: r.sent_at,
        lastPreview: messagePreview(r),
        lastDirection: r.direction,
        count: 1,
      });
      continue;
    }
    cur.count += 1;
    if (Date.parse(r.sent_at) > Date.parse(cur.lastAt)) {
      cur.lastAt = r.sent_at;
      cur.lastPreview = messagePreview(r);
      cur.lastDirection = r.direction;
    }
  }
  return [...map.values()].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** Oldest → newest, stable on equal timestamps. */
export function sortThread<T extends { sent_at: string }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Date.parse(a.r.sent_at) - Date.parse(b.r.sent_at) || a.i - b.i)
    .map(({ r }) => r);
}
