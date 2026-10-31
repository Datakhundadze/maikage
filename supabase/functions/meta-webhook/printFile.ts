// DM orders — the transparent print file for one side of an ordered item.
//
// What the site stores in orders.transparent_image_url is the design alone,
// on transparency, at print resolution. Here, per side kind:
//
//   generate  the design from the cache (designs/social-sketches/cache/<key>.png,
//             the very PNG the sketch used). Not a flag → the PNG as it is
//             (GPT already returned it transparent; zero pixel work). A flag →
//             decode, key out the magenta (as the sketch did), trim, PNG.
//   text      the lettering rendered on transparency with the sketch font,
//             PRINT_TEXT_WIDTH px wide (jersey: name over number), PNG.
//   photo     the customer's photo from the PRIVATE social-uploads bucket.
//             No removeWhite → the original bytes as they are (JPEG / PNG,
//             zero pixel work). removeWhite → (≤ PRINT_PHOTO_DECODE_MAX_PIXELS,
//             read from the header) decode, key out the white, trim, PNG;
//             a bigger photo is left to the operator ("photo_too_heavy").
//
// CPU. The edge limit is 2 s per request and the whole bot run is one
// request. Pixel work (decode / key / text raster / PNG encode) is measured
// into `cpu.ms`; once PRINT_PIXEL_BUDGET_MS is spent, a side that would need
// pixel work is skipped with reason "cpu_budget" and the order row keeps the
// mockup and the source (prompt / text / photo path in the draft) so the
// operator exports the file — never a failed order because of a print file.
//
// Upload: public "designs" bucket, social-orders/<sha256(cart_id)[0..32]>/
// item<N>-<side>.<ext>, upsert (a resumed confirmation writes the same path).

import { decodePng, isJpeg, isPng, type RgbaImage } from "./pngDecode.ts";
import { encodePng } from "./pngEncode.ts";
import {
  createImage,
  downscaleBy,
  keyOutColor,
  keyOutWhite,
  renderTextImage,
  trimTransparent,
  drawOver,
  type FontLike,
} from "./sketchRaster.ts";
import { KEY_COLOR_HEX } from "./sketchParse.ts";
import { findProductImage } from "./sketchLayout.ts";
import { textHexFor } from "./sketchFlow.ts";
import type { DraftItem, DraftSide, Side } from "./orderDraft.ts";

export const PRINT_BUCKET = "designs";
export const PRINT_PREFIX = "social-orders";
export const PRINT_TEXT_WIDTH = 2400;
export const PRINT_PHOTO_MAX_SIDE = 4000;
export const PRINT_PIXEL_BUDGET_MS = 1_000;
/** Decoded customer photos above this are not processed here (memory / CPU). */
export const PRINT_PHOTO_MAX_PIXELS = 24_000_000;
/**
 * removeWhite photos are decoded only up to this size (header check first):
 * a bigger one is left to the operator ("photo_too_heavy"), the source path
 * stays on the draft. Bench (Node): text 2400 px ≈ 0.05–0.2 s, flag 1024² ≈
 * 0.17 s, white key + PNG of 12 MP ≈ 0.3 s — plus the JPEG decode.
 */
export const PRINT_PHOTO_DECODE_MAX_PIXELS = 4_000_000;

/** Width × height from a PNG IHDR or a JPEG SOF marker, without decoding. null = unknown. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (isPng(b) && b.length >= 24) {
    const u = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { w: u(16), h: u(20) };
  }
  if (!isJpeg(b)) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    const len = (b[o + 2] << 8) | b[o + 3];
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8] };
    }
    o += 2 + len;
  }
  return null;
}

export interface PrintDeps {
  now: () => number;
  loadFont: () => Promise<FontLike | null>;
  decodeJpeg: (bytes: Uint8Array) => RgbaImage;
  cacheGet?: (key: string) => Promise<Uint8Array | null>;
  downloadUpload?: (path: string) => Promise<Uint8Array | null>;
  /** Public bucket upload (upsert); the public URL or null. */
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<string | null>;
  hashKey: (s: string) => Promise<string>;
  /** Optional override of the PNG encoder (tests). */
  encodePng?: (img: RgbaImage) => Promise<Uint8Array>;
}

export type PrintOutcome = { url: string } | { skipped: string };

class PrintSkip extends Error {
  constructor(readonly reason: string) { super(reason); }
}

/** The folder of one order's print files. */
export async function printFolder(cartId: string, hashKey: (s: string) => Promise<string>): Promise<string> {
  return `${PRINT_PREFIX}/${(await hashKey(`print:${cartId}`)).slice(0, 32)}`;
}

export function printPath(folder: string, item: number, side: Side, ext: "png" | "jpg"): string {
  return `${folder}/item${item}-${side}.${ext}`;
}

async function decodeAny(bytes: Uint8Array, deps: PrintDeps): Promise<RgbaImage> {
  if (isPng(bytes)) return await decodePng(bytes);
  if (isJpeg(bytes)) return deps.decodeJpeg(bytes);
  throw new PrintSkip("image_format");
}

/** The lettering alone on transparency, PRINT_TEXT_WIDTH wide. Exported for tests. */
export function renderPrintText(font: FontLike, s: DraftSide, hex: string, width = PRINT_TEXT_WIDTH): RgbaImage {
  const name = (s.text ?? "").trim();
  const num = (s.number ?? "").trim();
  if (s.placement === "jersey-back" && num) {
    // Jersey: the name over the number, both centred (the sketch's two boxes).
    const top = name ? renderTextImage(font, name, hex, width, Math.round(width * 0.25)) : null;
    const bottom = renderTextImage(font, num, hex, Math.round(width * 0.6), Math.round(width * 0.7));
    if (!bottom) throw new PrintSkip("text_render");
    const gap = top ? Math.round(width * 0.06) : 0;
    const w = Math.max(top?.width ?? 0, bottom.width);
    const out = createImage(w, (top?.height ?? 0) + gap + bottom.height);
    if (top) drawOver(out, top, Math.round((w - top.width) / 2), 0);
    drawOver(out, bottom, Math.round((w - bottom.width) / 2), (top?.height ?? 0) + gap);
    return out;
  }
  const img = renderTextImage(font, name, hex, width, width);
  if (!img) throw new PrintSkip("text_render");
  return img;
}

async function render(item: DraftItem, side: Side, s: DraftSide, deps: PrintDeps, cpu: { ms: number }): Promise<{ bytes: Uint8Array; ext: "png" | "jpg"; type: string }> {
  const encode = deps.encodePng ?? encodePng;
  const pixels = async <T>(work: () => Promise<T>): Promise<T> => {
    if (cpu.ms >= PRINT_PIXEL_BUDGET_MS) throw new PrintSkip("cpu_budget");
    const t0 = deps.now();
    try {
      return await work();
    } finally {
      cpu.ms += Math.max(0, deps.now() - t0);
    }
  };

  if (s.kind === "generate") {
    if (!s.cacheKey || !deps.cacheGet) throw new PrintSkip("no_design_source");
    const png = await deps.cacheGet(s.cacheKey);
    if (!png || !isPng(png)) throw new PrintSkip("design_not_cached");
    if (!s.flag) return { bytes: png, ext: "png", type: "image/png" };
    return await pixels(async () => {
      const img = await decodePng(png);
      keyOutColor(img, KEY_COLOR_HEX);
      return { bytes: await encode(trimTransparent(img)), ext: "png" as const, type: "image/png" };
    });
  }

  if (s.kind === "photo") {
    if (!s.photoPath || !deps.downloadUpload) throw new PrintSkip("no_photo_source");
    const bytes = await deps.downloadUpload(s.photoPath);
    if (!bytes) throw new PrintSkip("photo_download");
    if (!s.removeWhite) {
      if (isPng(bytes)) return { bytes, ext: "png", type: "image/png" };
      if (isJpeg(bytes)) return { bytes, ext: "jpg", type: "image/jpeg" };
      throw new PrintSkip("image_format");
    }
    // Decoding is the expensive part (jpeg-js ≈ 0.1 s per megapixel): read
    // the size from the header first and leave big photos to the operator.
    const dims = imageSize(bytes);
    if (!dims || dims.w * dims.h > PRINT_PHOTO_DECODE_MAX_PIXELS) throw new PrintSkip("photo_too_heavy");
    return await pixels(async () => {
      const img = await decodeAny(bytes, deps);
      if (img.width * img.height > PRINT_PHOTO_MAX_PIXELS) throw new PrintSkip("photo_too_large");
      const small = downscaleBy(img, Math.ceil(Math.max(img.width, img.height) / PRINT_PHOTO_MAX_SIDE));
      keyOutWhite(small);
      return { bytes: await encode(trimTransparent(small)), ext: "png" as const, type: "image/png" };
    });
  }

  const font = await deps.loadFont().catch(() => null);
  if (!font) throw new PrintSkip("font_unavailable");
  const garment = findProductImage({ product: item.product, subProduct: item.subProduct, color: item.color, side });
  const hex = textHexFor(s.textColor, garment?.garmentHex ?? null);
  return await pixels(async () => ({ bytes: await encode(renderPrintText(font, s, hex)), ext: "png" as const, type: "image/png" }));
}

/** One side's print file → uploaded URL, or the reason it was skipped. Never throws. */
export async function makePrintFile(
  folder: string,
  itemNo: number,
  item: DraftItem,
  side: Side,
  deps: PrintDeps,
  cpu: { ms: number },
): Promise<PrintOutcome> {
  const s = item.sides[side];
  if (!s) return { skipped: "no_side" };
  try {
    const out = await render(item, side, s, deps, cpu);
    const url = await deps.upload(printPath(folder, itemNo, side, out.ext), out.bytes, out.type);
    return url ? { url } : { skipped: "upload_failed" };
  } catch (e) {
    return { skipped: e instanceof PrintSkip ? e.reason : e instanceof Error ? e.name : "error" };
  }
}
