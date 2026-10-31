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
// No follow-up text after the image (owner, 2026-10-31: it was noise).
// Any failure or the overall timeout → DESIGN_LINK_LINE (unless opts.linkOnFailure
// is false — a second sketch of the same reply), reason logged.
//
// TIME. One overall budget: min(SKETCH_TIMEOUT_MS, what is left of
// WALL_CLOCK_BUDGET_MS since the run started). Supabase's wall-clock limit is
// 150 s on the Free plan and 400 s on paid plans, and waitUntil does not extend
// it; the run has already spent the debounce and the faq-chat call. CPU: the
// limit is 2 s per request; pixel work here is ≈ 0.3–0.6 s (measured locally).

import { DESIGN_LINK_LINE, SKETCH_NOTICE } from "./botReply.ts";
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
  trimTransparent,
  type FontLike,
} from "./sketchRaster.ts";

export { SKETCH_NOTICE };
/** Max sketches from one reply (two sides of one product today). */
export const MAX_SKETCHES_PER_REPLY = 2;

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

/** Test conversations (social_bot_settings.allow_keys) get roomier caps. */
export const TESTER_CAPS = { generate: 20, text: 50 } as const;

export function withinCaps(
  kind: SketchKind,
  counts: SketchCounts | null,
  limits: { generate: number; text: number } = { generate: MAX_GENERATE_SKETCHES, text: MAX_TEXT_SKETCHES },
): boolean {
  if (!counts) return false; // unreadable → fail closed, send the link
  return kind === "generate" ? counts.generate < limits.generate : counts.text < limits.text;
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
  /** Generated-design cache (PNG by params hash). Optional; absent → always generate. */
  cacheGet?: (key: string) => Promise<Uint8Array | null>;
  cachePut?: (key: string, png: Uint8Array) => Promise<void>;
}

/**
 * Same drawing → same key: a size / side / product change re-uses the design
 * instead of paying for it again (owner 2026-10-31). Garment colour is part of
 * the key — the generator gets it.
 */
export async function designCacheKey(plan: Extract<SketchPlan, { kind: "generate" }>, hash: (s: string) => Promise<string>): Promise<string> {
  const p = buildGenerateParams(plan.block, plan.target);
  const keyed = { c: p.character, s: p.style, t: p.text, r: p.isRealistic, b: p.transparent ?? true, col: p.color };
  return (await hash(JSON.stringify(keyed))).slice(0, 40);
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
  /** A design already generated for the same params (see designCacheKey). */
  cachedDesign?: Uint8Array | null;
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

/**
 * Sketch-only size factors (owner 2026-10-31: the site's print zone looked tiny
 * on a DM sketch). A big back print (A3, the +15 option) is ~1.3× the zone on
 * the photos; „უფრო დიდი" (size "large") adds 1.3× more for a drawing and 1.6×
 * for lettering. The site's own mockup is unchanged.
 */
export const BACK_DRAWING_FACTOR = 1.3;
export const LARGE_DRAWING_FACTOR = 1.3;
export const LARGE_TEXT_FACTOR = 1.6;

/** Grow a box around its centre, kept inside the w×h image. */
export function scaleBox(b: Box, f: number, w: number, h: number): Box {
  if (f === 1) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const nw = Math.min(b.w * f, w * 0.9), nh = Math.min(b.h * f, h * 0.9);
  const x = Math.min(Math.max(0, cx - nw / 2), w - nw);
  const y = Math.min(Math.max(0, cy - nh / 2), h - nh);
  return { x, y, w: nw, h: nh };
}

/** Boxes (in output pixels) the design / lettering go into. */
export function sketchBoxes(plan: SketchContext["plan"], img: ProductImage, w: number, h: number): Box[] {
  const large = plan.block.size === "large";
  if (plan.kind === "generate") {
    const base = placementBox(img.zone, designCoords(plan.block.placement), w, h);
    const unplaced = !plan.block.placement || plan.block.placement === "center";
    const f = (unplaced && plan.target.side === "back" ? BACK_DRAWING_FACTOR : 1) * (large ? LARGE_DRAWING_FACTOR : 1);
    return [scaleBox(base, f, w, h)];
  }
  if (plan.block.placement === "jersey-back") {
    const boxes = [placementBox(img.zone, JERSEY_NAME_COORDS, w, h)];
    if (plan.block.number) boxes.push(placementBox(img.zone, JERSEY_NUMBER_COORDS, w, h));
    return boxes;
  }
  return [scaleBox(placementBox(img.zone, textCoords(plan.block.placement, plan.target.product), w, h), large ? LARGE_TEXT_FACTOR : 1, w, h)];
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
      if (ctx.cachedDesign) return [await decodeImage(ctx.cachedDesign, deps)];
      const params = buildGenerateParams(ctx.plan.block, ctx.plan.target);
      const png = await deps.generateDesign(ctx.channel, ctx.conversationKey, params, left());
      if (!png) throw new SketchError("generate_failed");
      if (deps.cachePut) {
        const plan = ctx.plan;
        designCacheKey(plan, deps.hashKey).then((k) => deps.cachePut!(k, png)).catch(() => {});
      }
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
    drawContained(canvas, trimTransparent(design), boxes[0]);
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
export async function runSketch(
  ctx: SketchContext,
  base: SketchBaseDeps,
  deps: SketchDeps,
  opts: { linkOnFailure?: boolean } = {},
): Promise<string> {
  const startedAt = base.now().getTime();
  const deadline = startedAt + ctx.budgetMs;
  const now = () => base.now().getTime();
  let timedOut = false;
  let sendingImage = false;

  const work = (async (): Promise<string> => {
    // A cached design costs nothing: it counts as a mockup, not a generation.
    const marker = ctx.plan.kind === "generate" && ctx.cachedDesign ? SKETCH_MARKER.text : SKETCH_MARKER[ctx.plan.kind];
    const recordId = await base.recordSend(ctx.conversationKey, "sketch", marker);
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
    base.log("info", `sketch sent ${ctx.channel}: ${ctx.plan.kind} in ${now() - startedAt} ms`);
    return "sent";
  }
  base.log("warn", `sketch failed ${ctx.channel} (${ctx.plan.kind}): ${outcome}`);
  if (opts.linkOnFailure !== false) await sendText(ctx, base, DESIGN_LINK_LINE);
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

