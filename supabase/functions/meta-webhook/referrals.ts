// Ad / link referrals — which ad (or m.me / ig.me link) opened a conversation.
//
// ADD-ONLY companion to handler.ts. Pure parsing lives here (no Deno, no
// supabase-js) so vitest can drive it; index.ts supplies the real writer into
// public.social_ad_referrals. Nothing here changes how social_messages rows
// are built or stored, and nothing here can change the HTTP answer to Meta:
// recordReferrals() swallows and logs every error.
//
// SHAPES (Meta's documented webhook formats):
//   Messenger, standalone `messaging_referrals` event (existing thread, m.me
//     link, or ad click on a thread that already exists):
//       messaging[]: { sender:{id}, recipient:{id}, timestamp, referral:{…} }
//   Messenger, click-to-Messenger ad + first message (needs BOTH the `messages`
//     and `messaging_referrals` page subscriptions):
//       messaging[]: { …, message:{ mid, text, referral:{…} } }
//     Some deliveries carry it as messaging[].referral beside `message`; both
//     are read and de-duplicated.
//   Messenger, Get Started / postback from an ad:
//       messaging[]: { …, postback:{ title, payload, referral:{…} } }
//   Instagram (`object: "instagram"`): messaging[].referral (ig.me link,
//     `messaging_referral` field) and messaging[].message.referral (ad, source
//     "ADS", type "OPEN_THREAD", ad_id, ads_context_data).
//   referral: { ref?, ad_id?, source?, type?, referer_uri?,
//               ads_context_data?: { ad_title, photo_url?, video_url?, post_id,
//                                    product_id?, flow_id? },
//               product?: { id } }   (Shops product-detail referral)
//
// IDENTITY. channel / page_id / customer_id are derived EXACTLY as handler.ts
// derives them for an inbound (non-echo) message: channel from body.object,
// page_id = entry[].id ?? recipient.id, customer_id = sender.id. The table's
// conversation_key is GENERATED (channel:page_id:customer_id) from those
// three, the same expression social_messages uses, so the two always join.
//
// ECHOES are skipped: an echo is the page's own message and its sender is the
// page, not the customer.

import { redactPii } from "./redactPii.ts";

export type ReferralChannel = "messenger" | "instagram";

export interface SocialAdReferralRow {
  channel: ReferralChannel;
  page_id: string;
  customer_id: string;
  ad_id: string | null;
  source: string | null;
  type: string | null;
  ref: string | null;
  ad_title: string | null;
  /** The referral object, sanitised (see sanitizeRaw). */
  raw: Record<string, unknown>;
  /** ISO 8601, from messaging[].timestamp (epoch ms). */
  occurred_at: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
/** ad_id / post_id can arrive as a string or (rarely) a number; keep it as text. */
const idStr = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

function channelFor(object: unknown): ReferralChannel | null {
  if (object === "page") return "messenger";
  if (object === "instagram") return "instagram";
  return null;
}

/** Keys never kept in `raw`, at any depth. */
const SECRET_KEY_RE = /token|secret|password|signature|access_key|api_key/i;

/**
 * Copy a referral for the `raw` column: JSON values only, no secret-looking
 * keys, referer_uri without its query string / fragment (a site URL can carry
 * session or tracking tokens), free text (ad_title) through redactPii. Depth
 * capped so a hostile payload cannot blow the stack.
 */
function sanitizeRaw(v: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitizeRaw(x, depth + 1));
  if (isObj(v)) {
    const out: Json = {};
    for (const [k, val] of Object.entries(v)) {
      if (SECRET_KEY_RE.test(k)) continue;
      if (k === "referer_uri" && typeof val === "string") out[k] = val.split(/[?#]/)[0];
      else if (k === "ad_title" && typeof val === "string") out[k] = redactPii(val);
      else out[k] = sanitizeRaw(val, depth + 1);
    }
    return out;
  }
  return null;
}

function toRow(
  channel: ReferralChannel,
  pageId: string,
  customerId: string,
  occurredAt: string,
  referral: Json,
): SocialAdReferralRow {
  const ctx = isObj(referral.ads_context_data) ? referral.ads_context_data : null;
  const adTitle = ctx ? str(ctx.ad_title) : null;
  return {
    channel,
    page_id: pageId,
    customer_id: customerId,
    ad_id: idStr(referral.ad_id),
    source: str(referral.source),
    type: str(referral.type),
    // `ref` is a code WE put in the ad or the m.me / ig.me link (Meta allows
    // only [A-Za-z0-9_=-]); it is kept verbatim because redactPii would mask a
    // 9+ digit run inside it and destroy the attribution it exists for.
    ref: str(referral.ref),
    ad_title: adTitle === null ? null : redactPii(adTitle),
    raw: sanitizeRaw(referral) as Json,
    occurred_at: occurredAt,
  };
}

/**
 * Every referral in a webhook delivery, as rows for social_ad_referrals.
 * Pure and total: never throws, ignores anything it cannot read. Within one
 * delivery, rows with the same (conversation, ad_id, occurred_at) — the
 * table's unique key — are collapsed to the first.
 */
export function extractReferrals(body: unknown): SocialAdReferralRow[] {
  const rows: SocialAdReferralRow[] = [];
  if (!isObj(body)) return rows;
  const channel = channelFor(body.object);
  if (!channel || !Array.isArray(body.entry)) return rows;

  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.messaging)) continue;
    const entryId = str(entry.id);
    for (const ev of entry.messaging) {
      if (!isObj(ev)) continue;
      const message = isObj(ev.message) ? ev.message : null;
      if (message && message.is_echo === true) continue;

      const candidates: Json[] = [];
      if (isObj(ev.referral)) candidates.push(ev.referral);
      if (message && isObj(message.referral)) candidates.push(message.referral);
      if (isObj(ev.postback) && isObj(ev.postback.referral)) candidates.push(ev.postback.referral);
      if (candidates.length === 0) continue;

      const senderId = str(isObj(ev.sender) ? ev.sender.id : null);
      const recipientId = str(isObj(ev.recipient) ? ev.recipient.id : null);
      const ts = typeof ev.timestamp === "number" && Number.isFinite(ev.timestamp) ? ev.timestamp : null;
      // Same rule as handler.ts for an inbound message. No sender id (e.g. a
      // chat-plugin `user_ref`) → no conversation to attach it to.
      if (!senderId || ts === null) continue;
      const pageId = entryId ?? recipientId;
      if (!pageId) continue;
      const occurredAt = new Date(ts).toISOString();

      for (const ref of candidates) rows.push(toRow(channel, pageId, senderId, occurredAt, ref));
    }
  }

  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${referralConversationKey(r)}|${r.ad_id ?? ""}|${r.occurred_at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The value Postgres generates for conversation_key (both tables). */
export function referralConversationKey(r: Pick<SocialAdReferralRow, "channel" | "page_id" | "customer_id">): string {
  return `${r.channel}:${r.page_id}:${r.customer_id}`;
}

/**
 * Best-effort: extract and hand to the writer. Any error (parse or write) is
 * logged and swallowed — the webhook's answer to Meta must not depend on it.
 */
export async function recordReferrals(
  body: unknown,
  storeReferrals: (rows: SocialAdReferralRow[]) => Promise<void>,
  log: (level: "info" | "warn" | "error", msg: string) => void,
): Promise<void> {
  try {
    const rows = extractReferrals(body);
    if (rows.length === 0) return;
    await storeReferrals(rows);
    const ads = rows.filter((r) => r.ad_id !== null || r.source === "ADS").length;
    log("info", `referrals seen=${rows.length} ads=${ads}`);
  } catch (e) {
    log("warn", `referral record failed (ignored): ${e instanceof Error ? e.message : String(e)}`);
  }
}
