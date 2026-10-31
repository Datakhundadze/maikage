// Social auto-reply — the run for ONE freshly stored inbound message. Every
// side effect comes in through `deps`, so vitest drives the whole flow with
// fakes; index.ts supplies the real Supabase / gemini-proxy / Graph API ones.
//
// ORDER (cheapest first, so a disabled bot costs one single-row read):
//   1. settings + schedule          off → return
//   2. wait DEBOUNCE_MS             a burst of messages gets ONE answer
//   3. read: handoff row, last 8 messages, outbound rows + bot sends (12 h)
//   4. decideAutoReply (botReply.ts)
//   5. handoff / photo / AI reply → record → send → write the mid back
//
// The bot's text is recorded in social_bot_replies BEFORE the Graph call, so
// its echo is recognised even if it lands first (see isBotEcho). The message
// itself reaches social_messages through the normal echo path only — one row.
//
// Never throws: every failure is logged by status / code and the run ends.

import type { Channel } from "./handler.ts";
import type { BotSchedule } from "./botSchedule.ts";
import { isScheduleActive } from "./botSchedule.ts";
import {
  buildHistory,
  cleanBotReply,
  decideAutoReply,
  handoffMessage,
  photoMessage,
  splitForChannel,
  type BotSendRecord,
  type ChatTurn,
  type OutRow,
  type ThreadRow,
} from "./botReply.ts";

export const DEBOUNCE_MS = 4000;

export interface TriggerRow {
  channel: Channel;
  page_id: string;
  customer_id: string;
  meta_message_id: string;
  text: string | null;
  sent_at: string;
}

/** ok → messageId (may be null); not ok → HTTP status (0 = network) and Graph error code. */
export interface SendResult {
  ok: boolean;
  messageId?: string | null;
  status?: number;
  code?: string;
}

export interface AutoReplyDeps {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  tokenSet: boolean;
  /** allowKeys: when non-empty, the bot answers ONLY these conversation keys (testing). */
  loadSettings: () => Promise<{ enabled: boolean; schedule: string; allowKeys?: string[] } | null>;
  isHandedOff: (conversationKey: string) => Promise<boolean>;
  insertHandoff: (conversationKey: string, reason: string) => Promise<void>;
  /** Last `limit` messages, oldest-first. */
  loadThread: (conversationKey: string, limit: number) => Promise<ThreadRow[]>;
  loadOutRows: (conversationKey: string, sinceIso: string) => Promise<OutRow[]>;
  loadBotSends: (conversationKey: string, sinceIso: string) => Promise<BotSendRecord[]>;
  /** Insert a send record (text redacted by the caller's implementation); returns its id. */
  recordSend: (conversationKey: string, kind: "reply" | "handoff" | "photo", text: string) => Promise<string | null>;
  markSent: (recordId: string, messageId: string) => Promise<void>;
  askBot: (channel: Channel, conversationKey: string, history: ChatTurn[], schedule: BotSchedule) => Promise<string | null>;
  send: (channel: Channel, recipientId: string, text: string) => Promise<SendResult>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

export const conversationKeyOf = (r: Pick<TriggerRow, "channel" | "page_id" | "customer_id">) =>
  `${r.channel}:${r.page_id}:${r.customer_id}`;

let tokenWarned = false;

export async function runAutoReply(row: TriggerRow, deps: AutoReplyDeps): Promise<string> {
  const key = conversationKeyOf(row);
  try {
    const settings = await deps.loadSettings();
    if (!settings || settings.enabled !== true) return "disabled";
    if (!isScheduleActive(settings.schedule, deps.now())) return "outside_schedule";
    if (Array.isArray(settings.allowKeys) && settings.allowKeys.length > 0 && !settings.allowKeys.includes(key)) {
      return "not_allowlisted";
    }
    if (!deps.tokenSet) {
      if (!tokenWarned) {
        tokenWarned = true;
        deps.log("error", "auto-reply: META_PAGE_TOKEN not set — bot is enabled but cannot send; skipping");
      }
      return "no_token";
    }
    const schedule = settings.schedule as BotSchedule;

    await deps.sleep(DEBOUNCE_MS);

    const now = deps.now();
    const sinceIso = new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString();
    const [handedOff, thread, outRows, botSends] = await Promise.all([
      deps.isHandedOff(key),
      deps.loadThread(key, 8),
      deps.loadOutRows(key, sinceIso),
      deps.loadBotSends(key, sinceIso),
    ]);

    const decision = decideAutoReply({
      settings, now, handedOff, outRows, botSends, tokenSet: deps.tokenSet,
      trigger: { meta_message_id: row.meta_message_id, sent_at: row.sent_at },
      thread,
    });
    if (decision.action === "skip") {
      deps.log("info", `auto-reply skip ${row.channel}: ${decision.reason}`);
      return decision.reason;
    }

    let kind: "reply" | "handoff" | "photo";
    let text: string;
    if (decision.action === "handoff") {
      await deps.insertHandoff(key, "customer_asked");
      kind = "handoff";
      text = handoffMessage(schedule);
    } else if (decision.action === "photo") {
      kind = "photo";
      text = photoMessage(schedule);
    } else {
      const history = buildHistory(thread, 8);
      if (history.length === 0) return "empty_history";
      const raw = await deps.askBot(row.channel, key, history, schedule);
      if (raw === null) return "bot_failed";
      kind = "reply";
      text = cleanBotReply(raw, schedule);
    }

    let sent = 0;
    for (const chunk of splitForChannel(text, row.channel)) {
      const recordId = await deps.recordSend(key, kind, chunk);
      if (!recordId) {
        // Without the record its echo would look like an operator's reply and
        // silence the bot for 12 h; sending nothing is the cleaner failure.
        deps.log("error", `auto-reply: send record failed, not sending (${row.channel})`);
        return "record_failed";
      }
      const res = await deps.send(row.channel, row.customer_id, chunk);
      if (!res.ok) {
        deps.log("error", `auto-reply send failed ${row.channel}: status=${res.status} code=${res.code}`);
        return "send_failed";
      }
      sent++;
      if (res.messageId) await deps.markSent(recordId, res.messageId);
    }
    deps.log("info", `auto-reply sent ${row.channel}: ${kind} (${sent} message${sent === 1 ? "" : "s"})`);
    return kind;
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : "error";
    deps.log("error", `auto-reply failed (ignored): ${scrubSecrets(msg).slice(0, 200)}`);
    return "error";
  }
}

/** Belt and braces: the token travels in a header, never a URL, but scrub anyway. */
export function scrubSecrets(s: string): string {
  return s.replace(/(access_token=)[^&\s"']+/gi, "$1***").replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***");
}

/** Test hook: the "log once" flag is module state. */
export function _resetTokenWarning(): void {
  tokenWarned = false;
}
