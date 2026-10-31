// Social auto-reply — the run for ONE freshly stored inbound message. Every
// side effect comes in through `deps`, so vitest drives the whole flow with
// fakes; index.ts supplies the real Supabase / gemini-proxy / Graph API ones.
//
// ORDER (cheapest first, so a disabled bot costs one single-row read):
//   1. settings + schedule          off → return
//   2. wait DEBOUNCE_MS             a burst of messages gets ONE answer
//   3. read: handoff row, last 8 messages, outbound rows + bot sends (12 h);
//      a burst photo not yet in social-uploads → wait PHOTO_MIRROR_WAIT_MS once
//   4. decideAutoReply (botReply.ts)
//   5. handoff / AI reply → record → send → write the mid back. Photos go to
//      the AI as „[ფოტო N]"; only if that call fails, the fixed photoMessage.
//   6. (AI reply with a design block, deps.sketch set) the sketch image —
//      sketchFlow.ts; the reply then ends in SKETCH_NOTICE instead of the link.
//      Up to MAX_SKETCHES_PER_REPLY blocks (one per side for a drawing /
//      lettering, one per photo + side for "photo": N) → one image each.
//   7. DM ORDERS (deps.order, add-only 2026-11-01, orderFlow.ts): a phone /
//      email of the trigger message → the draft (before the debounce); the
//      draft's sketches → a note in the history; every sent sketch → a draft
//      item; a ```maika-order block → the texts orderFlow writes (summary,
//      missing info, or the created order + bank transfer details).
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
  buildHistoryWithPhotos,
  cleanBotReply,
  decideAutoReply,
  handoffMessage,
  pendingInbound,
  photoMessage,
  splitForChannel,
  type BotSendRecord,
  type ChatTurn,
  type OutRow,
  type ThreadRow,
} from "./botReply.ts";
import { planSketches, type RenderPlan } from "./sketchParse.ts";
import type { RgbaImage } from "./pngDecode.ts";
import {
  MIN_SKETCH_BUDGET_MS,
  SKETCH_CAP_WINDOW_MS,
  MAX_SKETCHES_PER_REPLY,
  PIXEL_BUDGET_MS,
  SKETCH_NOTICE,
  TESTER_CAPS,
  capKindOf,
  designCacheKey,
  runSketch,
  sketchBudgetMs,
  withinCaps,
  type SketchDeps,
} from "./sketchFlow.ts";
import { hasContacts, type CapturedContacts } from "./orderContacts.ts";
import { isStale, orderStatusNote, sketchesNote, withDraftNote } from "./orderDraft.ts";
import {
  ORDER_FAILED_TEXT,
  recordSketches,
  runOrderBlock,
  saveContacts,
  type OrderDeps,
  type OrderRun,
  type SentSketch,
} from "./orderFlow.ts";

/** 10 s (was 4 s, owner 2026-10-31): people type in many short lines. */
export const DEBOUNCE_MS = 10_000;
/**
 * A pending photo not yet copied to social-uploads (index.ts does that in the
 * background) cannot be placed. Wait this long once and re-read the thread.
 */
export const PHOTO_MIRROR_WAIT_MS = 4_000;

/** An inbound image of the burst whose copy to our storage may still land. */
function awaitingMirror(thread: ThreadRow[]): boolean {
  return pendingInbound(thread).some((r) =>
    Array.isArray(r.attachments) &&
    r.attachments.some((a) => a && a.type === "image" && a.stored !== true && a.purged !== true && typeof a.url === "string" && a.url !== "")
  );
}

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
  /** opts.orders: the DM order rules are on (the draft table is readable). */
  askBot: (channel: Channel, conversationKey: string, history: ChatTurn[], schedule: BotSchedule, opts?: { orders?: boolean }) => Promise<string | null>;
  send: (channel: Channel, recipientId: string, text: string) => Promise<SendResult>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  /** DM sketch images. Absent → design blocks get the link line, as before. */
  sketch?: SketchDeps;
  /**
   * DM orders (orderFlow.ts, add-only 2026-11-01). Absent, or the draft table
   * unreadable → no draft, no order rules for the model: exactly as before.
   */
  order?: OrderDeps;
}

/** In-memory extras of the trigger row that are never stored on it. */
export interface TriggerExtras {
  /** Phone / email from the RAW text (orderContacts.ts); never logged. */
  contacts?: CapturedContacts;
}

export const conversationKeyOf = (r: Pick<TriggerRow, "channel" | "page_id" | "customer_id">) =>
  `${r.channel}:${r.page_id}:${r.customer_id}`;

let tokenWarned = false;

export async function runAutoReply(row: TriggerRow, deps: AutoReplyDeps, extras: TriggerExtras = {}): Promise<string> {
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

    // A phone / email in THIS message → the draft, before the debounce (a
    // newer message supersedes this run, but must not lose the number).
    if (deps.order && hasContacts(extras.contacts)) {
      const saved = await saveContacts(key, row.channel, deps.now(), extras.contacts, deps.order).catch(() => "error");
      deps.log("info", `order draft contacts ${row.channel}: ${saved}`);
    }

    await deps.sleep(DEBOUNCE_MS);

    const now = deps.now();
    const sinceIso = new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString();
    const [handedOff, firstThread, outRows, botSends] = await Promise.all([
      deps.isHandedOff(key),
      deps.loadThread(key, 8),
      deps.loadOutRows(key, sinceIso),
      deps.loadBotSends(key, sinceIso),
    ]);
    let thread = firstThread;
    if (deps.sketch && awaitingMirror(thread)) {
      await deps.sleep(PHOTO_MIRROR_WAIT_MS);
      thread = await deps.loadThread(key, 8);
    }

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
    let texts: string[];
    const sketches: { plan: RenderPlan; cached: Uint8Array | null }[] = [];
    // A block of this reply got no sketch (unsupported / cap): when others do,
    // the link line still goes out once, after them.
    let owedLink = false;
    const tester = Array.isArray(settings.allowKeys) && settings.allowKeys.includes(key);
    const { turns: history, photos } = buildHistoryWithPhotos(thread, 8);
    // DM orders: the open draft's sketches (and order) go to the model as a
    // note on our side of the history. Unreadable draft table → orders off.
    let ordersOn = false;
    let askHistory = history;
    if (deps.order && decision.action === "reply" && history.length > 0) {
      const d = await deps.order.loadDraft(key).catch((): "error" => "error");
      if (d !== "error") {
        ordersOn = true;
        if (d && !isStale(d, now)) {
          askHistory = withDraftNote(history, [sketchesNote(d.items ?? []), orderStatusNote(d)].filter((s) => s !== "").join("\n"));
        }
      }
    }
    // AI call failed while photos wait for an answer → the old fixed
    // „ფოტო მივიღეთ" (an operator will look) instead of silence.
    const raw = decision.action === "reply" && history.length > 0
      ? await (ordersOn
        ? deps.askBot(row.channel, key, askHistory, schedule, { orders: true })
        : deps.askBot(row.channel, key, askHistory, schedule))
      : null;
    // DM orders: a maika-order block → the reply texts are written by
    // orderFlow from computed numbers; the model's own prose is not sent.
    const orderRun = raw !== null && ordersOn && deps.order
      ? await runOrderBlock(raw, { conversationKey: key, channel: row.channel, now: deps.now(), log: deps.log }, deps.order)
        .catch((e: unknown): OrderRun => {
          deps.log("error", `order step failed: ${e instanceof Error ? e.name : "error"}`);
          return { messages: [ORDER_FAILED_TEXT], outcome: "order_error" };
        })
      : null;
    if (orderRun) deps.log("info", `order step ${row.channel}: ${orderRun.outcome}`);
    if (decision.action === "handoff") {
      await deps.insertHandoff(key, "customer_asked");
      kind = "handoff";
      texts = [handoffMessage(schedule)];
    } else if (history.length === 0) {
      return "empty_history";
    } else if (raw === null && photos.pending.length > 0) {
      kind = "photo";
      texts = [photoMessage(schedule)];
    } else if (raw === null) {
      return "bot_failed";
    } else if (orderRun) {
      kind = "reply";
      texts = orderRun.messages;
    } else {
      kind = "reply";
      // Parse BEFORE cleanBotReply strips the fences.
      if (deps.sketch) {
        const plans = planSketches(raw, photos, MAX_SKETCHES_PER_REPLY);
        const wanted = plans.filter((p): p is RenderPlan => p.kind !== "unsupported");
        for (const p of plans) {
          if (p.kind !== "unsupported") continue;
          deps.log("info", `sketch skipped ${row.channel}: ${p.reason}`);
          owedLink = true;
        }
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
              const capKind = capKindOf(p, cached !== null);
              if (!withinCaps(capKind, running, limits)) {
                deps.log("info", `sketch skipped ${row.channel}: ${running ? "cap" : "count_failed"}`);
                owedLink = true;
                continue;
              }
              sketches.push({ plan: p, cached });
              if (running) running[capKind]++;
            }
          }
        }
      }
      texts = [cleanBotReply(raw, schedule, sketches.length > 0 ? { designNotice: SKETCH_NOTICE } : undefined)];
    }

    let sent = 0;
    for (const chunk of texts.flatMap((t) => splitForChannel(t, row.channel))) {
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
      const sendLinkOnce = async (): Promise<void> => {
        if (linkSent) return;
        linkSent = true;
        const id = await deps.recordSend(key, "reply", DESIGN_LINK_LINE);
        if (id) {
          const res = await deps.send(row.channel, row.customer_id, DESIGN_LINK_LINE);
          if (res.ok && res.messageId) await deps.markSent(id, res.messageId);
        }
      };
      const productCache = new Map<string, RgbaImage>();
      const cpu = { ms: 0 };
      // DM orders: every sketch that went out → the draft (after the loop).
      const sentSketches: SentSketch[] = [];
      for (const { plan, cached } of sketches) {
        // The budget was measured before the text went out; re-measure.
        const budgetMs = sketchBudgetMs(runStartedAt, deps.now().getTime());
        const need = plan.kind === "generate" && !cached ? MIN_SKETCH_BUDGET_MS : MIN_SKETCH_BUDGET_MS / 3;
        const outOfCpu = cpu.ms >= PIXEL_BUDGET_MS;
        if (budgetMs < need || outOfCpu) {
          deps.log("info", `sketch skipped ${row.channel}: ${outOfCpu ? `cpu_budget (${cpu.ms} ms spent)` : `no_time (${budgetMs} ms left)`}`);
          await sendLinkOnce();
          break;
        }
        const outcome = await runSketch(
          { channel: row.channel, conversationKey: key, customerId: row.customer_id, plan, budgetMs, cachedDesign: cached, productCache, cpu },
          { now: deps.now, recordSend: deps.recordSend, markSent: deps.markSent, send: deps.send, log: deps.log },
          deps.sketch,
          {
            linkOnFailure: !linkSent,
            onSent: (url: string, messageId: string | null): void => { sentSketches.push({ plan, url, messageId }); },
          },
        );
        if (outcome !== "sent") linkSent = true;
      }
      if (owedLink) await sendLinkOnce();
      if (ordersOn && deps.order && sentSketches.length > 0) {
        const sk: SketchDeps = deps.sketch;
        for (const s of sentSketches) {
          if (s.plan.kind === "generate") s.cacheKey = await designCacheKey(s.plan, sk.hashKey).catch((): undefined => undefined);
        }
        const r = await recordSketches(key, row.channel, deps.now(), sentSketches, deps.order, deps.log)
          .catch((): string => "error");
        deps.log("info", `order draft sketches ${row.channel}: ${r}`);
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
