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
//   6. (AI reply with a design block, deps.sketch set) the sketch image —
//      sketchFlow.ts; the reply then ends in SKETCH_NOTICE instead of the link.
//      Up to MAX_SKETCHES_PER_REPLY blocks (one per side) → one image each.
//
// DEBOUNCE. Every new inbound message starts its own run, and a run that sees
// a newer inbound message skips as "superseded" (decideAutoReply). So the
// window slides: the one answer goes DEBOUNCE_MS after the LAST message of a
// burst like „გამარჯობა" / „მინდა" / „მაიკაზე" / „წარწერა, რა ღირს?".
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
  DESIGN_LINK_LINE,
  buildHistory,
  cleanBotReply,
  decideAutoReply,
  handoffMessage,
  hasImage,
  pendingInbound,
  photoMessage,
  splitForChannel,
  type BotSendRecord,
  type ChatTurn,
  type OutRow,
  type ThreadRow,
} from "./botReply.ts";
import { planSketches, type SketchPlan } from "./sketchParse.ts";
import {
  MIN_SKETCH_BUDGET_MS,
  SKETCH_CAP_WINDOW_MS,
  MAX_SKETCHES_PER_REPLY,
  SKETCH_NOTICE,
  TESTER_CAPS,
  designCacheKey,
  runSketch,
  sketchBudgetMs,
  withinCaps,
  type SketchDeps,
} from "./sketchFlow.ts";

/** 10 s (was 4 s, owner 2026-10-31): people type in many short lines. */
export const DEBOUNCE_MS = 10_000;

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
  recordSend: (conversationKey: string, kind: "reply" | "handoff" | "photo" | "sketch", text: string) => Promise<string | null>;
  markSent: (recordId: string, messageId: string) => Promise<void>;
  askBot: (channel: Channel, conversationKey: string, history: ChatTurn[], schedule: BotSchedule) => Promise<string | null>;
  send: (channel: Channel, recipientId: string, text: string) => Promise<SendResult>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  /** DM sketch images. Absent → design blocks get the link line, as before. */
  sketch?: SketchDeps;
}

export const conversationKeyOf = (r: Pick<TriggerRow, "channel" | "page_id" | "customer_id">) =>
  `${r.channel}:${r.page_id}:${r.customer_id}`;

let tokenWarned = false;

export async function runAutoReply(row: TriggerRow, deps: AutoReplyDeps): Promise<string> {
  const key = conversationKeyOf(row);
  const runStartedAt = deps.now().getTime();
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
    const sketches: { plan: Extract<SketchPlan, { kind: "generate" | "text" }>; cached: Uint8Array | null }[] = [];
    const tester = Array.isArray(settings.allowKeys) && settings.allowKeys.includes(key);
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
      // Parse BEFORE cleanBotReply strips the fences.
      if (deps.sketch) {
        const plans = planSketches(raw, pendingInbound(thread).some(hasImage), MAX_SKETCHES_PER_REPLY);
        const wanted = plans.filter((p): p is Extract<SketchPlan, { kind: "generate" | "text" }> => p.kind !== "unsupported");
        for (const p of plans) if (p.kind === "unsupported") deps.log("info", `sketch skipped ${row.channel}: ${p.reason}`);
        if (wanted.length > 0) {
          const since = new Date(deps.now().getTime() - SKETCH_CAP_WINDOW_MS).toISOString();
          const counts = await deps.sketch.countSketches(key, since);
          const budgetMs = sketchBudgetMs(runStartedAt, deps.now().getTime());
          if (budgetMs < MIN_SKETCH_BUDGET_MS) deps.log("info", `sketch skipped ${row.channel}: no_time (${budgetMs} ms left)`);
          else {
            // Caps count the sketches of this reply too.
            const running = counts ? { ...counts } : null;
            const limits = tester ? TESTER_CAPS : undefined;
            for (const p of wanted) {
              // Same drawing as before (size / side / garment change) → no new generation.
              let cached: Uint8Array | null = null;
              if (p.kind === "generate" && deps.sketch.cacheGet) {
                const sk: SketchDeps = deps.sketch;
                cached = await designCacheKey(p, sk.hashKey).then((k) => sk.cacheGet!(k)).catch(() => null);
              }
              const capKind = p.kind === "generate" && cached ? "text" : p.kind;
              if (!withinCaps(capKind, running, limits)) {
                deps.log("info", `sketch skipped ${row.channel}: ${running ? "cap" : "count_failed"}`);
                continue;
              }
              sketches.push({ plan: p, cached });
              if (running) running[capKind]++;
            }
          }
        }
      }
      text = cleanBotReply(raw, schedule, sketches.length > 0 ? { designNotice: SKETCH_NOTICE } : undefined);
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
    if (sketches.length > 0 && deps.sketch) {
      // One image per side, in the order the bot wrote them. The link line
      // goes out at most once, after the first failure.
      let linkSent = false;
      for (const { plan, cached } of sketches) {
        // The budget was measured before the text went out; re-measure.
        const budgetMs = sketchBudgetMs(runStartedAt, deps.now().getTime());
        const need = plan.kind === "generate" && !cached ? MIN_SKETCH_BUDGET_MS : MIN_SKETCH_BUDGET_MS / 3;
        if (budgetMs < need) {
          deps.log("info", `sketch skipped ${row.channel}: no_time (${budgetMs} ms left)`);
          if (!linkSent) {
            const id = await deps.recordSend(key, "reply", DESIGN_LINK_LINE);
            if (id) {
              const res = await deps.send(row.channel, row.customer_id, DESIGN_LINK_LINE);
              if (res.ok && res.messageId) await deps.markSent(id, res.messageId);
            }
          }
          break;
        }
        const outcome = await runSketch(
          { channel: row.channel, conversationKey: key, customerId: row.customer_id, plan, budgetMs, cachedDesign: cached },
          { now: deps.now, recordSend: deps.recordSend, markSent: deps.markSent, send: deps.send, log: deps.log },
          deps.sketch,
          { linkOnFailure: !linkSent },
        );
        if (outcome !== "sent") linkSent = true;
      }
    }
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
