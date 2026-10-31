// DM sketch — render the design on the product and send it as an image.
//
// Runs inside runAutoReply, which index.ts already runs in the background
// (EdgeRuntime.waitUntil), right after the text reply went out. Every side
// effect comes in through `deps`, so vitest drives the flow with fakes.
//
// FLOW (the text reply, ending in SKETCH_NOTICE, has already been sent):
//   1. record a 'sketch' row (text = SKETCH_MARKER[kind]) — counts toward the
//      caps from this moment, even if the render fails later (cost bound)
//   2. render: generate → gemini-proxy generate-design-gpt (≈ $0.14), or
//      text → Noto Sans Georgian Bold; then the product photo, tint, fit,
//      JPEG ≈ 1024 px wide, quality 85
//   3. upload to the public "designs" bucket, social-sketches/<hash>/<ts>.jpg
//   4. Graph Send API image attachment; the mid is written back to the row
//   5. SKETCH_FOLLOWUP text
// Any failure or the overall timeout → DESIGN_LINK_LINE, reason logged.
//
// TIME. One overall budget: min(SKETCH_TIMEOUT_MS, what is left of
// WALL_CLOCK_BUDGET_MS since the run started). Supabase's wall-clock limit is
// 150 s on the Free plan and 400 s on paid plans, and waitUntil does not extend
// it; the run has already spent the debounce and the faq-chat call. CPU: the
// limit is 2 s per request; pixel work here is ≈ 0.3–0.6 s (measured locally).

import { DESIGN_LINK_LINE } from "./botReply.ts";
import type { Channel } from "./handler.ts";
import { decodePng, isJpeg, isPng, type RgbaImage } from "./pngDecode.ts";
import {
  JERSEY_NAME_COORDS,
  JERSEY_NUMBER_COORDS,
  contrastingTextColorHex,
  designCoords,
  findProductImage,
  outputSize,
  placementBox,
  textCoords,
  type Box,
  type ProductImage,
} from "./sketchLayout.ts";
import { buildGenerateParams, type SketchPlan } from "./sketchParse.ts";
import { TEXT_COLORS } from "./catalogSnapshot.ts";
import {
  drawContained,
  flattenOnWhite,
  renderTextImage,
  resample,
  tintLuminance,
  type FontLike,
} from "./sketchRaster.ts";

export const SKETCH_NOTICE = "ესკიზს ვამზადებ, ცოტა ხანში აქვე გამოგიგზავნით 🎨";
export const SKETCH_FOLLOWUP = "ესკიზი 👆 შესაცვლელად ან შესაკვეთად მოგვწერეთ.";

export const SKETCH_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_GENERATE_SKETCHES = 3;
export const MAX_TEXT_SKETCHES = 10;
export const SKETCH_TIMEOUT_MS = 90_000;
/** Below the Free plan's 150 s wall clock, with room for the link line. */
export const WALL_CLOCK_BUDGET_MS = 140_000;
/** Less than this left → do not start (a GPT design takes ~20–60 s). */
export const MIN_SKETCH_BUDGET_MS = 30_000;
export const SKETCH_WIDTH = 1024;
export const SKETCH_JPEG_QUALITY = 85;

export const SKETCH_MARKER = { generate: "sketch:generate", text: "sketch:mockup" } as const;

export type SketchKind = "generate" | "text";
export interface SketchCounts { generate: number; text: number }

/** Count the 24 h sketch rows by marker. */
export function countSketchRows(rows: { text: string | null }[]): SketchCounts {
  let generate = 0, text = 0;
  for (const r of rows) {
    if (r.text === SKETCH_MARKER.generate) generate++;
    else if (r.text === SKETCH_MARKER.text) text++;
  }
  return { generate, text };
}

export function withinCaps(kind: SketchKind, counts: SketchCounts | null): boolean {
  if (!counts) return false; // unreadable → fail closed, send the link
  return kind === "generate" ? counts.generate < MAX_GENERATE_SKETCHES : counts.text < MAX_TEXT_SKETCHES;
}

export function sketchBudgetMs(runStartedAtMs: number, nowMs: number): number {
  return Math.min(SKETCH_TIMEOUT_MS, runStartedAtMs + WALL_CLOCK_BUDGET_MS - nowMs);
}

export interface SendResultLike { ok: boolean; messageId?: string | null; status?: number; code?: string }

export interface SketchDeps {
  countSketches: (conversationKey: string, sinceIso: string) => Promise<SketchCounts | null>;
  /** generate-design-gpt, server to server; the PNG bytes or null. */
  generateDesign: (channel: Channel, conversationKey: string, params: Record<string, unknown>, timeoutMs: number) => Promise<Uint8Array | null>;
  fetchImage: (url: string, timeoutMs: number) => Promise<Uint8Array | null>;
  loadFont: () => Promise<FontLike | null>;
  decodeJpeg: (bytes: Uint8Array) => RgbaImage;
  encodeJpeg: (img: RgbaImage, quality: number) => Uint8Array;
  /** Upload to the public bucket; the public URL or null. */
  upload: (path: string, bytes: Uint8Array) => Promise<string | null>;
  hashKey: (conversationKey: string) => Promise<string>;
  sendImage: (channel: Channel, recipientId: string, url: string) => Promise<SendResultLike>;
}

export interface SketchBaseDeps {
  now: () => Date;
  recordSend: (conversationKey: string, kind: "reply" | "sketch", text: string) => Promise<string | null>;
  markSent: (recordId: string, messageId: string) => Promise<void>;
  send: (channel: Channel, recipientId: string, text: string) => Promise<SendResultLike>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface SketchContext {
  channel: Channel;
  conversationKey: string;
  customerId: string;
  plan: Extract<SketchPlan, { kind: "generate" | "text" }>;
  budgetMs: number;
}

class SketchError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

export async function decodeImage(bytes: Uint8Array, deps: Pick<SketchDeps, "decodeJpeg">): Promise<RgbaImage> {
  if (isPng(bytes)) return await decodePng(bytes);
  if (isJpeg(bytes)) return deps.decodeJpeg(bytes);
  throw new SketchError("image_format");
}

/** The product photo at SKETCH_WIDTH, tinted if needed, on white. */
export function prepareProduct(photo: RgbaImage, img: ProductImage, width = SKETCH_WIDTH): RgbaImage {
  if (img.tintHex) tintLuminance(photo, img.tintHex);
  const size = outputSize(photo.width, photo.height, width);
  const out = resample(photo, size.w, size.h);
  flattenOnWhite(out);
  return out;
}

/** Boxes (in output pixels) the design / lettering go into. */
export function sketchBoxes(plan: SketchContext["plan"], img: ProductImage, w: number, h: number): Box[] {
  if (plan.kind === "generate") return [placementBox(img.zone, designCoords(plan.block.placement), w, h)];
  if (plan.block.placement === "jersey-back") {
    const boxes = [placementBox(img.zone, JERSEY_NAME_COORDS, w, h)];
    if (plan.block.number) boxes.push(placementBox(img.zone, JERSEY_NUMBER_COORDS, w, h));
    return boxes;
  }
  return [placementBox(img.zone, textCoords(plan.block.placement, plan.target.product), w, h)];
}

export function textHexFor(textColor: string | undefined, garmentHex: string | null): string {
  const named = textColor ? TEXT_COLORS.find((c) => c.name === textColor)?.hex : undefined;
  return named ?? contrastingTextColorHex(garmentHex);
}

/** Steps 2 of the flow: the finished JPEG bytes. Throws SketchError. */
export async function renderSketch(ctx: SketchContext, deps: SketchDeps, deadline: number, now: () => number): Promise<Uint8Array> {
  const left = () => Math.max(1000, deadline - now());
  const img = findProductImage(ctx.plan.target);
  if (!img) throw new SketchError("no_product_photo");

  // Start the slow part first; the photo downloads meanwhile.
  const designP: Promise<RgbaImage[]> = (async () => {
    if (ctx.plan.kind === "generate") {
      const params = buildGenerateParams(ctx.plan.block, ctx.plan.target);
      const png = await deps.generateDesign(ctx.channel, ctx.conversationKey, params, left());
      if (!png) throw new SketchError("generate_failed");
      return [await decodeImage(png, deps)];
    }
    return [];
  })();
  // Marked handled now: if the photo step throws first, a later rejection of
  // the design must not surface as an unhandled rejection in the isolate.
  designP.catch(() => {});
  const fontP = ctx.plan.kind === "text" ? deps.loadFont().catch(() => null) : Promise.resolve(null);
  const photoBytes = await deps.fetchImage(img.url, Math.min(20_000, left()));
  if (!photoBytes) throw new SketchError("product_photo_fetch");
  const canvas = prepareProduct(await decodeImage(photoBytes, deps), img);
  const boxes = sketchBoxes(ctx.plan, img, canvas.width, canvas.height);

  if (ctx.plan.kind === "generate") {
    const [design] = await designP;
    drawContained(canvas, design, boxes[0]);
  } else {
    const font = await fontP;
    if (!font) throw new SketchError("font_unavailable");
    const hex = textHexFor(ctx.plan.block.textColor, img.garmentHex);
    const parts = ctx.plan.block.placement === "jersey-back"
      ? [ctx.plan.block.text, ctx.plan.block.number]
      : [ctx.plan.block.text];
    parts.forEach((t, i) => {
      if (!t || !boxes[i]) return;
      const glyphs = renderTextImage(font, t, hex, boxes[i].w, boxes[i].h);
      if (!glyphs) throw new SketchError("text_render");
      drawContained(canvas, glyphs, boxes[i]);
    });
  }
  return deps.encodeJpeg(canvas, SKETCH_JPEG_QUALITY);
}

/**
 * Steps 1–5. Returns the outcome for the log ("sent" or a failure reason).
 * Never throws; on failure the customer gets DESIGN_LINK_LINE.
 */
export async function runSketch(ctx: SketchContext, base: SketchBaseDeps, deps: SketchDeps): Promise<string> {
  const startedAt = base.now().getTime();
  const deadline = startedAt + ctx.budgetMs;
  const now = () => base.now().getTime();
  let timedOut = false;
  let sendingImage = false;

  const work = (async (): Promise<string> => {
    const recordId = await base.recordSend(ctx.conversationKey, "sketch", SKETCH_MARKER[ctx.plan.kind]);
    if (!recordId) throw new SketchError("record_failed");
    const jpeg = await renderSketch(ctx, deps, deadline, now);
    if (timedOut) throw new SketchError("timeout");
    const hash = (await deps.hashKey(ctx.conversationKey)).slice(0, 32);
    const url = await deps.upload(`social-sketches/${hash}/${now()}.jpg`, jpeg);
    if (!url) throw new SketchError("upload_failed");
    if (timedOut) throw new SketchError("timeout");
    sendingImage = true;
    const res = await deps.sendImage(ctx.channel, ctx.customerId, url);
    if (!res.ok) throw new SketchError(`image_send_failed status=${res.status} code=${res.code}`);
    if (res.messageId) await base.markSent(recordId, res.messageId);
    return "sent";
  })();

  let outcome: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), Math.max(0, deadline - now())); });
    const first = await Promise.race([work, timeout]);
    if (first === "timeout") {
      timedOut = true;
      // Already handing the image to Meta: let that finish rather than
      // sending the link line next to a picture that is about to arrive.
      outcome = sendingImage ? await work : "timeout";
      if (!sendingImage) work.catch(() => {});
    } else {
      outcome = first;
    }
  } catch (e) {
    outcome = e instanceof SketchError
      ? e.reason
      : e instanceof Error ? `${e.name}: ${e.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 120)}` : "error";
  } finally {
    clearTimeout(timer);
  }

  if (outcome === "sent") {
    await sendText(ctx, base, SKETCH_FOLLOWUP);
    base.log("info", `sketch sent ${ctx.channel}: ${ctx.plan.kind} in ${now() - startedAt} ms`);
    return "sent";
  }
  base.log("warn", `sketch failed ${ctx.channel} (${ctx.plan.kind}): ${outcome}`);
  await sendText(ctx, base, DESIGN_LINK_LINE);
  return outcome;
}

async function sendText(ctx: SketchContext, base: SketchBaseDeps, text: string): Promise<boolean> {
  const id = await base.recordSend(ctx.conversationKey, "reply", text);
  if (!id) {
    base.log("error", `sketch: send record failed, not sending (${ctx.channel})`);
    return false;
  }
  const res = await base.send(ctx.channel, ctx.customerId, text);
  if (!res.ok) {
    base.log("error", `sketch text send failed ${ctx.channel}: status=${res.status} code=${res.code}`);
    return false;
  }
  if (res.messageId) await base.markSent(id, res.messageId);
  return true;
}
