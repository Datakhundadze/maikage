// Social auto-reply bot — every decision and text transform, with NO Deno and
// NO supabase-js, so vitest covers it directly. autoReply.ts wires these to the
// database, gemini-proxy and the Graph API.

import type { Channel, SocialAttachment } from "./handler.ts";
import { isScheduleActive, type BotSchedule } from "./botSchedule.ts";

/** Send API `metadata` marker. Messenger echoes carry it back (message_echoes). */
export const BOT_METADATA = "maika-bot";

/** A human took over if an operator wrote in the conversation this recently. */
export const HUMAN_TAKEOVER_MS = 12 * 60 * 60 * 1000;
/** Cost / loop bound: at most this many bot messages per conversation per window. */
export const MAX_BOT_MESSAGES_PER_WINDOW = 25;
/** How close a stored echo's time must be to a bot send for a text match. */
export const ECHO_TEXT_MATCH_MS = 10 * 60 * 1000;
/** Rough cap for one bot answer (Messenger allows 2000 chars). */
export const MAX_REPLY_CHARS = 1000;
/** Instagram: "text must be UTF-8 and 1000 bytes or less". */
export const IG_MAX_BYTES = 1000;

export const CHAT_LINK = "https://maika.ge/chat";
export const DESIGN_LINK_LINE = `დიზაინის სანახავად: ${CHAT_LINK}`;

/** The reply's last line when a sketch image follows (sketchFlow.ts). */
export const SKETCH_NOTICE = "ესკიზს ვამზადებ, ცოტა ხანში აქვე გამოგიგზავნით 🎨";
/**
 * Texts the bot itself sent around a sketch (incl. the retired follow-up). They
 * are stripped from the history and from the model's answer: left in, the model
 * copied them, wrote "I'm preparing a sketch" with no block, and nothing came.
 */
export const SKETCH_SYSTEM_LINES = [
  SKETCH_NOTICE,
  "ესკიზი 👆 შესაცვლელად ან შესაკვეთად მოგვწერეთ.",
] as const;
const IMAGE_TAG = "[ფოტო]";

/** Remove the sketch system lines and the history's image tag from a text. */
export function stripSketchSystemText(text: string): string {
  let t = text;
  for (const line of SKETCH_SYSTEM_LINES) t = t.split(line).join("");
  t = t.split(IMAGE_TAG).join("");
  // Meta can drop or swap the emoji; also catch the lines without it.
  t = t.replace(/ესკიზს ვამზადებ,? ცოტა ხანში აქვე გამოგიგზავნით\s*\S{0,2}/g, "")
    .replace(/ესკიზი\s*\S{0,2}\s*შესაცვლელად ან შესაკვეთად მოგვწერეთ\.?/g, "");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const HANDOFF_RE = /ოპერატორ|operator|ადამიან|human|ცოცხალ/i;

export function wantsHuman(text: string | null | undefined): boolean {
  return typeof text === "string" && HANDOFF_RE.test(text);
}

// ── fixed texts ────────────────────────────────────────────────────────────

const WORKING_HOURS = "სამუშაო საათებში (ორშ–პარ 11:00–19:00, შაბ 11:00–18:00)";

/** When the operator is back, in the words of the schedule. */
function operatorBack(schedule: BotSchedule): string {
  return schedule === "sunday" ? "ორშაბათს, 11:00-დან" : WORKING_HOURS;
}

export function handoffMessage(schedule: BotSchedule): string {
  return `კარგი, ოპერატორს გადავეცი 🙌 ის გიპასუხებთ ${operatorBack(schedule)}.`;
}

export function photoMessage(schedule: BotSchedule): string {
  return `ფოტო მივიღეთ, მადლობა 📷 ოპერატორი ნახავს და გიპასუხებთ ${operatorBack(schedule)}. ` +
    `თუ დიზაინის ნახვა ახლავე გინდათ, ატვირთეთ ფოტო აქ: ${CHAT_LINK}`;
}

export function emptyReplyFallback(schedule: BotSchedule): string {
  return `ამ კითხვაზე ოპერატორი გიპასუხებთ ${operatorBack(schedule)}. ოპერატორთან დასაკავშირებლად დაწერეთ „ოპერატორი".`;
}

// ── echoes: bot or human? ──────────────────────────────────────────────────

export interface OutRow {
  meta_message_id: string;
  text: string | null;
  sent_at: string;
  /** Needed only to recognise the bot's own sketch image echoes (no text). */
  attachments?: SocialAttachment[] | null;
}

/** An image-only echo this close to a recorded 'sketch' send is the bot's own. */
export const SKETCH_ECHO_MS = 2 * 60 * 1000;

/** No text, and at least one image attachment. */
export function isImageOnly(row: Pick<OutRow, "text" | "attachments">): boolean {
  const noText = row.text === null || row.text.trim() === "";
  return noText && Array.isArray(row.attachments) && row.attachments.length > 0 &&
    row.attachments.every((a) => a && a.type === "image");
}

export interface BotSendRecord {
  meta_message_id: string | null;
  text: string | null;
  kind: string;
  created_at: string;
}

/**
 * Is this outbound (echo) row one of the bot's own sends?
 *  1. its mid is a Send API message_id the bot recorded, or
 *  2. its text equals a bot send's text (both redacted the same way) and the
 *     two times are within ECHO_TEXT_MATCH_MS. The bot records its text BEFORE
 *     calling Meta, so this also covers the echo landing before the mid is
 *     written back, and an Instagram echo whose mid differs from the Send API's.
 *  3. it is an image-only echo within SKETCH_ECHO_MS of a 'sketch' send.
 */
export function isBotEcho(row: OutRow, sends: BotSendRecord[]): boolean {
  const t = Date.parse(row.sent_at);
  for (const s of sends) {
    if (s.meta_message_id && s.meta_message_id === row.meta_message_id) return true;
    if (row.text !== null && s.text !== null && row.text === s.text) {
      const st = Date.parse(s.created_at);
      if (Number.isFinite(t) && Number.isFinite(st) && Math.abs(t - st) <= ECHO_TEXT_MATCH_MS) return true;
    }
  }
  // 3. A sketch image echo has no text to match. If its mid was not written
  //    back (yet) or differs (Instagram), an image-only echo within
  //    SKETCH_ECHO_MS of a recorded 'sketch' send is the bot's own.
  if (isImageOnly(row) && Number.isFinite(t)) {
    for (const s of sends) {
      if (s.kind !== "sketch") continue;
      const st = Date.parse(s.created_at);
      if (Number.isFinite(st) && Math.abs(t - st) <= SKETCH_ECHO_MS) return true;
    }
  }
  return false;
}

/**
 * Meta Business Suite automations (instant reply, away message, location
 * reply) come back as echoes too. They are not an operator taking over, so
 * they must not silence the bot. Matched on stable fragments of their text.
 */
const META_AUTOMATION_FRAGMENTS = [
  "maika.ge-ის გუნდი მალე გიპასუხებთ",
  "დაგვიკავშირდით არასამუშაო დროს",
  "ახლა არასამუშაო დროა",
  "ოპერატორი უახლოეს სამუშაო საათებში",
];
export function isMetaAutomationEcho(text: string | null): boolean {
  if (!text) return false;
  return META_AUTOMATION_FRAGMENTS.some((f) => text.includes(f));
}

/** An operator wrote in this conversation within HUMAN_TAKEOVER_MS. */
export function humanTookOver(outRows: OutRow[], sends: BotSendRecord[], now: Date): boolean {
  const since = now.getTime() - HUMAN_TAKEOVER_MS;
  return outRows.some((r) => Date.parse(r.sent_at) >= since && !isBotEcho(r, sends) && !isMetaAutomationEcho(r.text));
}

// ── the decision ───────────────────────────────────────────────────────────

export interface ThreadRow {
  meta_message_id: string;
  direction: "in" | "out";
  text: string | null;
  attachments: SocialAttachment[] | null;
  unsupported: boolean;
  sent_at: string;
}

export const hasImage = (r: Pick<ThreadRow, "attachments">) =>
  Array.isArray(r.attachments) && r.attachments.some((a) => a && a.type === "image");

/** Should this freshly stored row be looked at by the bot at all? */
export function isBotCandidate(r: { direction: string; unsupported: boolean; text: string | null; attachments: SocialAttachment[] | null }): boolean {
  if (r.direction !== "in" || r.unsupported) return false;
  return (typeof r.text === "string" && r.text.trim() !== "") || hasImage(r);
}

/**
 * Inbound messages after the last outbound one — the customer's current
 * "burst" (people often send three short messages, or a photo then a question).
 * `thread` is oldest-first.
 */
export function pendingInbound(thread: ThreadRow[]): ThreadRow[] {
  let lastOut = -1;
  // A Meta Business Suite automation (instant reply / away message) is not an
  // answer to the customer: the bot still owes one after it.
  thread.forEach((r, i) => { if (r.direction === "out" && !isMetaAutomationEcho(r.text)) lastOut = i; });
  return thread.slice(lastOut + 1).filter((r) => r.direction === "in");
}

export interface DecideInput {
  settings: { enabled: boolean; schedule: unknown } | null;
  now: Date;
  handedOff: boolean;
  /** Outbound rows of the conversation within (at least) HUMAN_TAKEOVER_MS. */
  outRows: OutRow[];
  /** The bot's own sends in the conversation within (at least) HUMAN_TAKEOVER_MS. */
  botSends: BotSendRecord[];
  tokenSet: boolean;
  /** The row that triggered this run. */
  trigger: { meta_message_id: string; sent_at: string };
  /** Last messages of the conversation, oldest-first (includes the trigger). */
  thread: ThreadRow[];
}

export type Decision =
  | { action: "skip"; reason: string }
  | { action: "handoff" }
  | { action: "photo" }
  | { action: "reply" };

export function decideAutoReply(i: DecideInput): Decision {
  if (!i.settings || i.settings.enabled !== true) return { action: "skip", reason: "disabled" };
  if (!isScheduleActive(i.settings.schedule, i.now)) return { action: "skip", reason: "outside_schedule" };
  if (i.handedOff) return { action: "skip", reason: "handed_off" };
  if (humanTookOver(i.outRows, i.botSends, i.now)) return { action: "skip", reason: "human_active" };
  if (!i.tokenSet) return { action: "skip", reason: "no_token" };

  // A newer customer message exists: its own run answers the whole burst.
  const trigAt = Date.parse(i.trigger.sent_at);
  if (i.thread.some((r) => r.direction === "in" && r.meta_message_id !== i.trigger.meta_message_id && Date.parse(r.sent_at) > trigAt)) {
    return { action: "skip", reason: "superseded" };
  }

  const since = i.now.getTime() - HUMAN_TAKEOVER_MS;
  const recentSends = i.botSends.filter((s) => Date.parse(s.created_at) >= since);
  if (recentSends.length >= MAX_BOT_MESSAGES_PER_WINDOW) return { action: "skip", reason: "cap" };

  const pending = pendingInbound(i.thread);
  if (pending.length === 0) return { action: "skip", reason: "nothing_pending" };
  if (pending.some((r) => wantsHuman(r.text))) return { action: "handoff" };
  if (pending.some(hasImage)) {
    // One "photo received" per window is enough; after that, text still gets answers.
    const photoSent = recentSends.some((s) => s.kind === "photo");
    const pendingText = pending.some((r) => typeof r.text === "string" && r.text.trim() !== "");
    if (!photoSent) return { action: "photo" };
    if (!pendingText) return { action: "skip", reason: "photo_already_acknowledged" };
  }
  return { action: "reply" };
}

// ── history for faq-chat ───────────────────────────────────────────────────

export interface ChatTurn { role: "user" | "assistant"; content: string }

/** Last messages (oldest-first) → faq-chat turns: in → user, out → assistant. */
export function buildHistory(thread: ThreadRow[], max = 8): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const r of thread.filter((r) => !(r.direction === "out" && isMetaAutomationEcho(r.text))).slice(-max)) {
    // Our side: no image tag and no sketch system lines (see SKETCH_SYSTEM_LINES).
    if (r.direction === "out") {
      const content = stripSketchSystemText(typeof r.text === "string" ? r.text : "");
      if (content) turns.push({ role: "assistant", content: content.slice(0, 1000) });
      continue;
    }
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const content = text ? (hasImage(r) ? `${text} ${IMAGE_TAG}` : text) : (hasImage(r) ? IMAGE_TAG : "");
    if (!content) continue;
    turns.push({ role: r.direction === "in" ? "user" : "assistant", content: content.slice(0, 1000) });
  }
  // faq-chat answers the last user turn; never end on our own message.
  while (turns.length > 0 && turns[turns.length - 1].role !== "user") turns.pop();
  return turns;
}

// ── cleaning the bot's answer for a DM ─────────────────────────────────────

const FENCE_RE = /```maika-([a-z0-9_-]+)[^\n]*\n?[\s\S]*?(```|$)/gi;

/**
 * Strip every ```maika-*``` block (meant for the website widget) and the
 * markdown a DM cannot render. If a mockup / generate block was removed, add
 * one line pointing to the chat where the design can be seen — or, with
 * opts.designNotice (a sketch image will follow), that line instead. Cap the length.
 * The proxy already ran fixBankAccounts / sanitizeReply on this text.
 */
export function cleanBotReply(
  raw: string,
  schedule: BotSchedule = "sunday",
  opts?: { designNotice?: string },
): string {
  let hadDesign = false;
  let text = String(raw ?? "").replace(FENCE_RE, (_m, kind: string) => {
    const k = kind.toLowerCase();
    if (k === "mockup" || k === "generate") hadDesign = true;
    return "";
  });
  text = stripSketchSystemText(text)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => (sameLink(label, url) ? url : `${label}: ${url}`))
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A sketch image is on its way (sketchFlow.ts): say so instead of the link.
  const link = hadDesign && opts?.designNotice
    ? opts.designNotice
    : hadDesign && !text.includes("maika.ge/chat") ? DESIGN_LINK_LINE : "";
  const budget = MAX_REPLY_CHARS - (link ? link.length + 1 : 0);
  text = capText(text, budget);
  if (!text) text = emptyReplyFallback(schedule);
  return link ? `${text}\n${link}` : text;
}

/** "[maika.ge/chat](https://maika.ge/chat)" → just the URL, not "label: url". */
function sameLink(label: string, url: string): boolean {
  const bare = (u: string) => u.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  return bare(label) === bare(url);
}

/** Cut at a sentence / line end before `max` characters, else at a space. */
export function capText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  const cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  const at = cut > max * 0.5 ? cut + 1 : Math.max(head.lastIndexOf(" "), Math.floor(max * 0.5));
  return head.slice(0, at).trimEnd() + "…";
}

const utf8 = new TextEncoder();
const bytes = (s: string) => utf8.encode(s).length;

/**
 * Split for the channel's limit. Messenger: one message. Instagram: chunks of
 * at most IG_MAX_BYTES UTF-8 bytes (Georgian letters are 3 bytes each, so a
 * 1000-character answer is ~3 chunks), cut at line, then word boundaries.
 */
export function splitForChannel(text: string, channel: Channel): string[] {
  if (channel !== "instagram" || bytes(text) <= IG_MAX_BYTES) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest && bytes(rest) > IG_MAX_BYTES) {
    const chars = Array.from(rest);
    let n = 0;
    let b = 0;
    while (n < chars.length && b + bytes(chars[n]) <= IG_MAX_BYTES) { b += bytes(chars[n]); n++; }
    const head = chars.slice(0, n).join("");
    let cut = head.lastIndexOf("\n");
    if (cut < head.length * 0.4) cut = head.lastIndexOf(" ");
    if (cut < head.length * 0.4) cut = head.length;
    out.push(head.slice(0, cut).trim());
    rest = rest.slice(head.slice(0, cut).length).trim();
  }
  if (rest) out.push(rest);
  return out.filter((s) => s.length > 0);
}

// ── Graph API send body ────────────────────────────────────────────────────

/**
 * Messenger: `metadata` is a documented Send API field and comes back on the
 * echo. Instagram's send docs do not list it, so it is left out there (an
 * unknown field is a risk of a 400) and the bot relies on social_bot_replies.
 */
export function sendBody(channel: Channel, recipientId: string, text: string): Record<string, unknown> {
  const message: Record<string, unknown> = { text };
  if (channel === "messenger") message.metadata = BOT_METADATA;
  return { recipient: { id: recipientId }, messaging_type: "RESPONSE", message };
}

/**
 * A sketch image by URL (Graph Send API attachment). Messenger: is_reusable
 * false and the metadata marker, both documented Send API fields. Instagram's
 * send docs show only {type: "image", payload: {url}} (png / jpeg, ≤ 8 MB), so
 * nothing else is added there.
 */
export function sendImageBody(channel: Channel, recipientId: string, url: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { url };
  if (channel === "messenger") payload.is_reusable = false;
  const message: Record<string, unknown> = { attachment: { type: "image", payload } };
  if (channel === "messenger") message.metadata = BOT_METADATA;
  return { recipient: { id: recipientId }, messaging_type: "RESPONSE", message };
}
