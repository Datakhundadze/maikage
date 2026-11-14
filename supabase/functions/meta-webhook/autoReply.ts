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
//      "photo": N + "extract": true (a ready garment, 2026-11-01) → GPT
//      recreates the print from the photo; cached per photo, generate cap.
//   7. DM ORDERS (deps.order, add-only 2026-11-01, orderFlow.ts): a phone /
//      email of the trigger message → the draft (before the debounce); the
//      draft's sketches → a note in the history; every sent sketch → a draft
//      item; a ```maika-order block → the texts orderFlow writes (summary,
//      missing info, or the created order + bank transfer details).
//   8. RECEIPTS (deps.receipt, add-only 2026-11-01, receiptFlow.ts): with an
//      order waiting for the transfer, a new image of the burst is read as a
//      receipt BEFORE the model; a receipt → the code's reply, no model call.
//   9. PHOTO BLOCK NUDGE (add-only, 2026-11-02): photos went to the model and
//      its reply has no block at all → ONE follow-up faq-chat call for the
//      block(s) only (photoBlockNudge); its blocks are appended to the reply.
//      "photo" + "printColor" → the extracted print redrawn in that colour.
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
  ASKS_FOR_MODELS_RE,
  DESIGN_LINK_LINE,
  HANDOFF_REASON_SKETCH_CAP,
  buildHistoryWithPhotos,
  cleanBotReply,
  decideAutoReply,
  handoffMessage,
  introMessage,
  pendingInbound,
  photoMessage,
  sketchCapMessage,
  splitForChannel,
  type BotSendRecord,
  type ChatTurn,
  type OutRow,
  type ThreadRow,
} from "./botReply.ts";
import { planSketches, type RenderPlan } from "./sketchParse.ts";
import { isJpeg, isPng, type RgbaImage } from "./pngDecode.ts";
import {
  MIN_SKETCH_BUDGET_MS,
  SKETCH_CAP_WINDOW_MS,
  MAX_SKETCHES_PER_REPLY,
  PIXEL_BUDGET_MS,
  SKETCH_NOTICE,
  TESTER_CAPS,
  capKindOf,
  designCacheKey,
  extractCacheKey,
  isExtractPlan,
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
import type { OrderDraft } from "./orderDraft.ts";
import { runReceiptStep, type ReceiptDeps, type ReceiptRun } from "./receiptFlow.ts";
import { receiptSourcePaths } from "./receiptCheck.ts";

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
  askBot: (channel: Channel, conversationKey: string, history: ChatTurn[], schedule: BotSchedule, opts?: { orders?: boolean; images?: string[] }) => Promise<string | null>;
  send: (channel: Channel, recipientId: string, text: string) => Promise<SendResult>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  /** DM sketch images. Absent → design blocks get the link line, as before. */
  sketch?: SketchDeps;
  /**
   * DM orders (orderFlow.ts, add-only 2026-11-01). Absent, or the draft table
   * unreadable → no draft, no order rules for the model: exactly as before.
   */
  order?: OrderDeps;
  /**
   * Bank-transfer receipts (receiptFlow.ts, add-only 2026-11-01). Needs
   * `order`. Absent → an image after the order goes to the model as before.
   */
  receipt?: ReceiptDeps;
  /**
   * INTRO (add-only, owner 2026-11-14): true → the bot's first send to a
   * conversation (no bot send in the 13 h window) is preceded by
   * introMessage. Never before the handoff text. Absent → as before.
   */
  introOnFirstReply?: boolean;
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
    if ((deps.sketch || deps.receipt) && awaitingMirror(thread)) {
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
    // A PAID sketch (fresh drawing / print extraction) refused by the cap
    // (owner 2026-11-01): the cap text instead of the link line, once per
    // reply, and a handoff to the operator.
    let capHit = false;
    const tester = Array.isArray(settings.allowKeys) && settings.allowKeys.includes(key);
    const { turns: history, photos } = buildHistoryWithPhotos(thread, 8);
    // DM orders: the open draft's sketches (and order) go to the model as a
    // note on our side of the history. Unreadable draft table → orders off.
    let ordersOn = false;
    let askHistory = history;
    let openDraft: OrderDraft | null = null;
    if (deps.order && decision.action === "reply" && history.length > 0) {
      const d = await deps.order.loadDraft(key).catch((): "error" => "error");
      if (d !== "error") {
        ordersOn = true;
        openDraft = d;
        if (d && !isStale(d, now)) {
          askHistory = withDraftNote(history, [sketchesNote(d.items ?? []), orderStatusNote(d)].filter((s) => s !== "").join("\n"));
        }
      }
    }
    // RECEIPT (add-only, 2026-11-01): an order waiting for the transfer and a
    // new image in this burst → read it as a receipt first. A receipt gets
    // the reply receiptFlow writes and the model is not asked; anything else
    // (no image, not a receipt, cap, failure) → the normal reply below.
    let receiptRun: ReceiptRun | null = null;
    const receiptPhotos: Set<string> = openDraft ? receiptSourcePaths(openDraft.receipt) : new Set<string>();
    if (deps.receipt && deps.order && openDraft) {
      const od: OrderDraft = openDraft;
      const r = await runReceiptStep(
        { conversationKey: key, channel: row.channel, now: deps.now(), schedule, thread, draft: od, log: deps.log },
        deps.order,
        deps.receipt,
      ).catch((e: unknown): ReceiptRun => {
        deps.log("error", `receipt step failed: ${e instanceof Error ? e.name : "error"}`);
        return { messages: null, outcome: "receipt_error" };
      });
      if (r.outcome !== "no_order") deps.log("info", `receipt step ${row.channel}: ${r.outcome}`);
      if (r.messages && r.messages.length > 0) receiptRun = r;
    }
    // DM PHOTOS TO THE MODEL (owner 2026-11-01): the customer's photos of this
    // burst go to faq-chat as images, so the answer is about what they show.
    let images: string[] = [];
    let visionNumbers: number[] = [];
    // One download per photo per run: the vision step and the photo sketches share it.
    const downloaded = new Map<string, Promise<Uint8Array | null>>();
    const rawDownload: ((path: string) => Promise<Uint8Array | null>) | undefined = deps.sketch?.downloadUpload;
    const memoDownload = (path: string): Promise<Uint8Array | null> => {
      if (!rawDownload) return Promise.resolve(null);
      let p = downloaded.get(path);
      if (!p) { p = rawDownload(path); downloaded.set(path, p); }
      return p;
    };
    if (receiptRun === null && decision.action === "reply" && history.length > 0 && rawDownload) {
      const v = await visionImages(photos, receiptPhotos, memoDownload);
      images = v.images;
      visionNumbers = v.numbers;
      if (v.numbers.length > 0) askHistory = withAttachedNote(askHistory, v.numbers);
    }
    const askOpts: { orders?: boolean; images?: string[] } = {
      ...(ordersOn ? { orders: true } : {}),
      ...(images.length > 0 ? { images } : {}),
    };
    // AI call failed while photos wait for an answer → the old fixed
    // „ფოტო მივიღეთ" (an operator will look) instead of silence.
    const firstRaw = receiptRun === null && decision.action === "reply" && history.length > 0
      ? await (Object.keys(askOpts).length > 0
        ? deps.askBot(row.channel, key, askHistory, schedule, askOpts)
        : deps.askBot(row.channel, key, askHistory, schedule))
      : null;
    // PHOTO BLOCK NUDGE (add-only, 2026-11-02): the model saw the burst's
    // photos but wrote no block at all (owner test: „ამოვიღებთ…" and nothing
    // sent) → ONE more faq-chat call asking for the block(s) only. Never on a
    // handoff / receipt / order path (no maika-order block, no order waiting).
    const orderWaiting = openDraft !== null && orderStatusNote(openDraft) !== "";
    const raw = firstRaw !== null && decision.action === "reply" && receiptRun === null && !orderWaiting &&
        needsPhotoBlockNudge(firstRaw, visionNumbers)
      ? await photoBlockNudge(
        firstRaw,
        askHistory,
        visionNumbers,
        (h: ChatTurn[]): Promise<string | null> => deps.askBot(row.channel, key, h, schedule, askOpts),
        (msg: string): void => deps.log("info", `${msg} (${row.channel})`),
      )
      : firstRaw;
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
    } else if (receiptRun && receiptRun.messages) {
      kind = "reply";
      texts = receiptRun.messages;
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
        // A photo already taken as a bank receipt is never placed on a product.
        const plans = planSketches(raw, photos, MAX_SKETCHES_PER_REPLY)
          .filter((p) => !(p.kind === "photo" && receiptPhotos.has(p.path)));
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
              } else if (isExtractPlan(p) && deps.sketch.cacheGet) {
                // Same photo's print extracted before → re-use it (no GPT call).
                const sk: SketchDeps = deps.sketch;
                const path: string = p.path;
                cached = await extractCacheKey(path, sk.hashKey, p.block.printColor, p.block.editPrompt)
                  .then((k: string): Promise<Uint8Array | null> => sk.cacheGet!(k))
                  .catch((): null => null);
              }
              const capKind = capKindOf(p, cached !== null);
              if (!withinCaps(capKind, running, limits)) {
                deps.log("info", `sketch skipped ${row.channel}: ${running ? "cap" : "count_failed"}`);
                if (running && capKind === "generate") capHit = true;
                else owedLink = true;
                continue;
              }
              sketches.push({ plan: p, cached });
              if (running) running[capKind]++;
            }
          }
        }
      }
      texts = [cleanBotReply(
        raw,
        schedule,
        {
          ...(sketches.length > 0
            ? { designNotice: SKETCH_NOTICE }
            : capHit ? { designNotice: sketchCapMessage(schedule) } : {}),
          allowPriceList: pendingInbound(thread).some((r) => typeof r.text === "string" && ASKS_FOR_MODELS_RE.test(r.text)),
        },
      )];
    }

    // INTRO (add-only, owner 2026-11-14): first bot send in this conversation
    // within the window → the introduction goes out first, as its own message.
    if (deps.introOnFirstReply === true && kind !== "handoff" && botSends.length === 0) {
      texts = [introMessage(schedule), ...texts];
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
    if (capHit) {
      await deps.insertHandoff(key, HANDOFF_REASON_SKETCH_CAP);
      deps.log("info", `auto-reply handoff ${row.channel}: ${HANDOFF_REASON_SKETCH_CAP}`);
    }
    if (sketches.length > 0 && deps.sketch) {
      // One image per side, in the order the bot wrote them. The link line
      // goes out at most once, after the first failure.
      let linkSent = false;
      // Cap reached → the cap text takes the link line's place (once).
      const followLine = capHit ? sketchCapMessage(schedule) : DESIGN_LINK_LINE;
      const sendLinkOnce = async (): Promise<void> => {
        if (linkSent) return;
        linkSent = true;
        const id = await deps.recordSend(key, "reply", followLine);
        if (id) {
          const res = await deps.send(row.channel, row.customer_id, followLine);
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
        const need = capKindOf(plan, cached !== null) === "generate" ? MIN_SKETCH_BUDGET_MS : MIN_SKETCH_BUDGET_MS / 3;
        const outOfCpu = cpu.ms >= PIXEL_BUDGET_MS;
        if (budgetMs < need || outOfCpu) {
          deps.log("info", `sketch skipped ${row.channel}: ${outOfCpu ? `cpu_budget (${cpu.ms} ms spent)` : `no_time (${budgetMs} ms left)`}`);
          await sendLinkOnce();
          break;
        }
        const outcome = await runSketch(
          { channel: row.channel, conversationKey: key, customerId: row.customer_id, plan, budgetMs, cachedDesign: cached, productCache, cpu },
          { now: deps.now, recordSend: deps.recordSend, markSent: deps.markSent, send: deps.send, log: deps.log },
          rawDownload ? { ...deps.sketch, downloadUpload: memoDownload } : deps.sketch,
          {
            linkOnFailure: !linkSent && !capHit,
            onSent: (url: string, messageId: string | null): void => { sentSketches.push({ plan, url, messageId }); },
          },
        );
        if (outcome !== "sent" && !capHit) linkSent = true;
      }
      if (owedLink || capHit) await sendLinkOnce();
      if (ordersOn && deps.order && sentSketches.length > 0) {
        const sk: SketchDeps = deps.sketch;
        for (const s of sentSketches) {
          if (s.plan.kind === "generate") s.cacheKey = await designCacheKey(s.plan, sk.hashKey).catch((): undefined => undefined);
          else if (isExtractPlan(s.plan)) s.cacheKey = await extractCacheKey(s.plan.path, sk.hashKey, s.plan.block.printColor, s.plan.block.editPrompt).catch((): undefined => undefined);
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

// ── DM photos for the model (add-only, 2026-11-01) ──────────────────────────

export const MAX_VISION_IMAGES = 4;
/** Larger originals are skipped (gemini-proxy caps a data URL at 8 MB of base64). */
export const MAX_VISION_BYTES = 4_000_000;

function bytesToBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * The burst's photos (not receipts), as data URLs of the stored originals — no
 * decode, so no CPU cost. numbers[i] is the „[ფოტო N]" of images[i].
 */
export async function visionImages(
  photos: { paths: (string | null)[]; pending: number[] },
  receiptPaths: Set<string>,
  download: (path: string) => Promise<Uint8Array | null>,
): Promise<{ images: string[]; numbers: number[] }> {
  const images: string[] = [];
  const numbers: number[] = [];
  for (const n of photos.pending) {
    if (images.length >= MAX_VISION_IMAGES) break;
    const path = photos.paths[n - 1];
    if (!path || receiptPaths.has(path)) continue;
    const bytes = await download(path).catch((): null => null);
    if (!bytes || bytes.length > MAX_VISION_BYTES) continue;
    const mime = isJpeg(bytes) ? "image/jpeg" : isPng(bytes) ? "image/png" : null;
    if (!mime) continue;
    images.push(`data:${mime};base64,${bytesToBase64(bytes)}`);
    numbers.push(n);
  }
  return { images, numbers };
}

// ── photo block nudge (add-only, 2026-11-02) ───────────────────────────────
//
// The model SAW the customer's photos (params.images) and answered in prose
// only — no maika-mockup, so no sketch went out although the prose promised
// one. One follow-up call: the same history + our reply + this server turn,
// with the same images (gemini-proxy attaches them to the LAST user turn,
// i.e. this one). Only the design fences of the answer are kept and appended
// to the first reply, whose prose is what the customer reads.
//
// chat_logs: faq-chat logs this turn as a "user" row of the same session_id
// (admin-only; starts with „[სისტემა:"). It never re-enters a DM history —
// the history is built from social_messages, and this text is never sent.

export const PHOTO_BLOCK_NUDGE =
  "[სისტემა: ეს შეტყობინება მომხმარებელს არ ეგზავნება. თუ მომხმარებელს ამ ფოტო(ებ)ის დაბეჭდვა სურს, " +
  "ახლა დაწერე მხოლოდ maika-mockup ბლოკ(ებ)ი ამ ფოტოებისთვის წესების მიხედვით (\"photo\": N; " +
  "\"extract\": true, თუ ფოტო ბეჭდვისთვის მზა სუფთა ნახატი არ არის; \"printColor\", თუ პრინტი სხვა ფერის უნდა). " +
  "პროდუქტი, ტანსაცმლის ფერი და მხარე აიღე ამ ფოტოდან და ამ შეტყობინებების სიტყვებიდან — არასოდეს ისტორიის " +
  "ადრინდელი, სხვა მოთხოვნიდან, თუ მომხმარებელი თავად არ მიუთითებს მასზე. თუ ბეჭდვა არ სურს — დაწერე მხოლოდ NONE.]";

const ANY_BLOCK_RE = /```maika-(?:mockup|generate|order)/;
const DESIGN_FENCE_RE = /```maika-(?:mockup|generate)\s*[\s\S]*?```/g;

/** Photos went to the model and its reply has no mockup / generate / order block. */
export function needsPhotoBlockNudge(raw: string, visionNumbers: readonly number[]): boolean {
  return visionNumbers.length > 0 && !ANY_BLOCK_RE.test(String(raw ?? ""));
}

/** The closed maika-mockup / maika-generate fences of a text, prose dropped. */
export function designFences(text: string): string[] {
  return String(text ?? "").match(DESIGN_FENCE_RE) ?? [];
}

/** History for the follow-up: the tail of the first call's history + our reply + the server turn. */
export function nudgeHistory(history: ChatTurn[], reply: string, numbers: readonly number[]): ChatTurn[] {
  // faq-chat keeps the last 8 turns: 6 + 2, starting on a customer turn.
  const tail = history.slice(-6);
  while (tail.length > 0 && tail[0].role !== "user") tail.shift();
  const note = numbers.length > 0 ? `\n[თანდართული: ${numbers.map((n) => `ფოტო ${n}`).join(", ")}]` : "";
  return [
    ...tail,
    { role: "assistant", content: reply.slice(0, 1000) },
    { role: "user", content: PHOTO_BLOCK_NUDGE + note },
  ];
}

/**
 * ONE follow-up call. Blocks in the answer → the first reply + those blocks;
 * NONE / no block / failure → the first reply unchanged. Logged either way.
 */
export async function photoBlockNudge(
  firstRaw: string,
  history: ChatTurn[],
  numbers: readonly number[],
  ask: (history: ChatTurn[]) => Promise<string | null>,
  log: (msg: string) => void,
): Promise<string> {
  const answer = await ask(nudgeHistory(history, firstRaw, numbers)).catch((): null => null);
  if (answer === null) {
    log("photo block nudge: failed (1 extra faq-chat call)");
    return firstRaw;
  }
  const fences = designFences(answer);
  if (fences.length === 0) {
    log("photo block nudge: none (1 extra faq-chat call)");
    return firstRaw;
  }
  log(`photo block nudge: ${fences.length} block${fences.length === 1 ? "" : "s"} added (1 extra faq-chat call)`);
  return `${firstRaw.trimEnd()}\n\n${fences.join("\n")}`;
}

/** Tell the model which „[ფოტო N]" the attached images are, on the last user turn. */
export function withAttachedNote(history: ChatTurn[], numbers: number[]): ChatTurn[] {
  const at = history.map((t) => t.role).lastIndexOf("user");
  if (at === -1 || numbers.length === 0) return history;
  const note = `[თანდართული: ${numbers.map((n) => `ფოტო ${n}`).join(", ")}]`;
  return history.map((t, i) => (i === at ? { ...t, content: `${t.content}\n${note}` } : t));
}
