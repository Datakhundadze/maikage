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
//      text → Noto Sans Georgian Bold, or photo → the customer's own photo
//      from the private social-uploads bucket (≤ PHOTO_MAX_SIDE, optional
//      local removeWhite; no AI, $0); then the product photo, tint, fit,
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
import {
  KEY_COLOR_HEX,
  buildFlagGenerateParams,
  buildGenerateParams,
  isFlagBlock,
  type RenderPlan,
  type SketchPlan,
} from "./sketchParse.ts";
import { TEXT_COLORS } from "./catalogSnapshot.ts";
import {
  downscaleBy,
  drawContained,
  flattenOnWhite,
  renderTextImage,
  resample,
  keyOutColor,
  keyOutWhite,
  tintLuminance,
  trimTransparent,
  type FontLike,
} from "./sketchRaster.ts";

export { SKETCH_NOTICE };
/**
 * Max sketches from one reply: two sides of one drawing / lettering, or one
 * per customer photo (2026-10-31: up to 5 photos at once).
 */
export const MAX_SKETCHES_PER_REPLY = 5;

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

/** A customer-photo sketch has its own marker and counts as a mockup (no AI cost). */
export const SKETCH_MARKER = { generate: "sketch:generate", text: "sketch:mockup", photo: "sketch:photo" } as const;

export type SketchKind = "generate" | "text";
export interface SketchCounts { generate: number; text: number }

/** Count the 24 h sketch rows by marker (photo sketches count as text / mockup). */
export function countSketchRows(rows: { text: string | null }[]): SketchCounts {
  let generate = 0, text = 0;
  for (const r of rows) {
    if (r.text === SKETCH_MARKER.generate) generate++;
    else if (r.text === SKETCH_MARKER.text || r.text === SKETCH_MARKER.photo) text++;
  }
  return { generate, text };
}

/** Which cap a plan counts toward: only a fresh generation is "generate". */
export function capKindOf(plan: RenderPlan, cached: boolean): SketchKind {
  return plan.kind === "generate" && !cached ? "generate" : "text";
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
  /**
   * A customer photo from the PRIVATE social-uploads bucket, by its stored
   * path (service role). Absent → photo sketches fail to the link line.
   */
  downloadUpload?: (path: string) => Promise<Uint8Array | null>;
}

/**
 * Same drawing → same key: a size / side / product change re-uses the design
 * instead of paying for it again (owner 2026-10-31). Garment colour is part of
 * the key — the generator gets it.
 */
export async function designCacheKey(plan: Extract<SketchPlan, { kind: "generate" }>, hash: (s: string) => Promise<string>): Promise<string> {
  const p = isFlagBlock(plan.block) ? buildFlagGenerateParams(plan.block, plan.target) : buildGenerateParams(plan.block, plan.target);
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
  plan: RenderPlan;
  budgetMs: number;
  /** A design already generated for the same params (see designCacheKey). */
  cachedDesign?: Uint8Array | null;
  /**
   * Product canvases already prepared in this reply (by photo URL + tint), so
   * five photos on the same shirt decode the product PNG once. Optional.
   */
  productCache?: Map<string, RgbaImage>;
  /** Pixel time spent so far in this reply (ms), added to by renderSketch. */
  cpu?: { ms: number };
}

/**
 * The edge CPU limit is 2 s per request and the whole bot run is one request
 * (waitUntil). Once a reply's sketches have spent this much pixel time
 * (decode / prepare / compose / encode, measured), no further sketch starts —
 * the rest get the link line. ≈ 0.25–0.4 s per photo measured locally, so
 * 3–4 photos fit; the text reply, JSON and TLS need the rest.
 */
export const PIXEL_BUDGET_MS = 1_200;

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
  // A customer photo is placed exactly like a drawing.
  if (plan.kind === "generate" || plan.kind === "photo") {
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

/** The prepared product canvas; from `cache` (a copy) when this reply already made it. */
async function productCanvas(
  img: ProductImage,
  deps: SketchDeps,
  left: () => number,
  cache: Map<string, RgbaImage> | undefined,
  spend: (since: number) => void,
  now: () => number,
): Promise<RgbaImage> {
  const key = `${img.url}|${img.tintHex ?? ""}`;
  const hit = cache?.get(key);
  if (hit) return { width: hit.width, height: hit.height, data: new Uint8ClampedArray(hit.data) };
  const photoBytes = await deps.fetchImage(img.url, Math.min(20_000, left()));
  if (!photoBytes) throw new SketchError("product_photo_fetch");
  const t0 = now();
  const canvas = prepareProduct(await decodeImage(photoBytes, deps), img);
  cache?.set(key, { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.data) });
  spend(t0);
  return canvas;
}

// ── the customer's own photo (add-only, 2026-10-31) ─────────────────────────

/**
 * Long side of a customer photo before any per-pixel work. The print box on a
 * 1024 px sketch is at most ~900 px, so nothing visible is lost, and the key /
 * trim / fit passes stay small (edge CPU limit: 2 s per request).
 */
export const PHOTO_MAX_SIDE = 1200;
/** Decoded photos above this are refused rather than processed (memory / CPU). */
export const PHOTO_MAX_PIXELS = 24_000_000;

/**
 * Customer photo → the design layer: downscale to PHOTO_MAX_SIDE, key out
 * near-white when the block asked for it ("removeWhite"), crop transparent
 * padding (a PNG logo with alpha). A plain white background is NOT removed on
 * its own, even on a dark garment: the sketch shows what would be printed.
 */
export function preparePhoto(photo: RgbaImage, opts: { removeWhite?: boolean } = {}): RgbaImage {
  if (!(photo.width > 0 && photo.height > 0) || photo.width * photo.height > PHOTO_MAX_PIXELS) {
    throw new SketchError("photo_too_large");
  }
  // Integer block shrink (one cheap pass): long side ≤ PHOTO_MAX_SIDE. The
  // final fit into the print box is drawContained's area-average, as for a drawing.
  const long = Math.max(photo.width, photo.height);
  const img = downscaleBy(photo, Math.ceil(long / PHOTO_MAX_SIDE));
  if (opts.removeWhite) keyOutWhite(img);
  return trimTransparent(img);
}

/** Steps 2 of the flow: the finished JPEG bytes. Throws SketchError. */
export async function renderSketch(ctx: SketchContext, deps: SketchDeps, deadline: number, now: () => number): Promise<Uint8Array> {
  const left = () => Math.max(1000, deadline - now());
  const img = findProductImage(ctx.plan.target);
  if (!img) throw new SketchError("no_product_photo");
  // Pixel time (decode / prepare / compose / encode) → ctx.cpu, see PIXEL_BUDGET_MS.
  const spend = (since: number) => { if (ctx.cpu) ctx.cpu.ms += Math.max(0, now() - since); };

  // Start the slow part first; the photo downloads meanwhile.
  const designP: Promise<RgbaImage[]> = (async () => {
    if (ctx.plan.kind === "generate") {
      const flag = isFlagBlock(ctx.plan.block);
      const keyed = async (bytes: Uint8Array) => {
        const t0 = now();
        const img = await decodeImage(bytes, deps);
        if (flag) keyOutColor(img, KEY_COLOR_HEX);
        spend(t0);
        return img;
      };
      if (ctx.cachedDesign) return [await keyed(ctx.cachedDesign)];
      const params = flag
        ? buildFlagGenerateParams(ctx.plan.block, ctx.plan.target)
        : buildGenerateParams(ctx.plan.block, ctx.plan.target);
      const png = await deps.generateDesign(ctx.channel, ctx.conversationKey, params, left());
      if (!png) throw new SketchError("generate_failed");
      if (deps.cachePut) {
        const plan = ctx.plan;
        designCacheKey(plan, deps.hashKey).then((k) => deps.cachePut!(k, png)).catch(() => {});
      }
      return [await keyed(png)];
    }
    if (ctx.plan.kind === "photo") {
      if (!deps.downloadUpload) throw new SketchError("photo_download_unavailable");
      const bytes = await deps.downloadUpload(ctx.plan.path);
      if (!bytes) throw new SketchError("photo_download");
      const t0 = now();
      const layer = preparePhoto(await decodeImage(bytes, deps), { removeWhite: ctx.plan.block.removeWhite === true });
      spend(t0);
      return [layer];
    }
    return [];
  })();
  // Marked handled now: if the photo step throws first, a later rejection of
  // the design must not surface as an unhandled rejection in the isolate.
  designP.catch(() => {});
  const fontP = ctx.plan.kind === "text" ? deps.loadFont().catch(() => null) : Promise.resolve(null);
  const canvas = await productCanvas(img, deps, left, ctx.productCache, spend, now);
  const boxes = sketchBoxes(ctx.plan, img, canvas.width, canvas.height);

  if (ctx.plan.kind === "generate" || ctx.plan.kind === "photo") {
    const [design] = await designP;
    const t0 = now();
    drawContained(canvas, ctx.plan.kind === "generate" ? trimTransparent(design) : design, boxes[0]);
    const jpeg = deps.encodeJpeg(canvas, SKETCH_JPEG_QUALITY);
    spend(t0);
    return jpeg;
  } else {
    const font = await fontP;
    if (!font) throw new SketchError("font_unavailable");
    const hex = textHexFor(ctx.plan.block.textColor, img.garmentHex);
    const parts = ctx.plan.block.placement === "jersey-back"
      ? [ctx.plan.block.text, ctx.plan.block.number]
      : [ctx.plan.block.text];
    const t0 = now();
    parts.forEach((t, i) => {
      if (!t || !boxes[i]) return;
      const glyphs = renderTextImage(font, t, hex, boxes[i].w, boxes[i].h);
      if (!glyphs) throw new SketchError("text_render");
      drawContained(canvas, glyphs, boxes[i]);
    });
    const jpeg = deps.encodeJpeg(canvas, SKETCH_JPEG_QUALITY);
    spend(t0);
    return jpeg;
  }
}

/**
 * Steps 1–5. Returns the outcome for the log ("sent" or a failure reason).
 * Never throws; on failure the customer gets DESIGN_LINK_LINE.
 */
export async function runSketch(
  ctx: SketchContext,
  base: SketchBaseDeps,
  deps: SketchDeps,
  opts: { linkOnFailure?: boolean; onSent?: (url: string, messageId: string | null) => void } = {},
): Promise<string> {
  const startedAt = base.now().getTime();
  const deadline = startedAt + ctx.budgetMs;
  const now = () => base.now().getTime();
  let timedOut = false;
  let sendingImage = false;
  // DM orders (add-only, 2026-11-01): the sent sketch's URL / mid for the draft.
  let sentUrl = "";
  let sentMid: string | null = null;

  const work = (async (): Promise<string> => {
    // A cached design costs nothing: it counts as a mockup, not a generation.
    const marker = ctx.plan.kind === "photo"
      ? SKETCH_MARKER.photo
      : ctx.plan.kind === "generate" && ctx.cachedDesign ? SKETCH_MARKER.text : SKETCH_MARKER[ctx.plan.kind];
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
    sentUrl = url;
    sentMid = res.messageId ?? null;
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
    if (opts.onSent && sentUrl) {
      try { opts.onSent(sentUrl, sentMid); } catch { /* the draft is best-effort */ }
    }
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

