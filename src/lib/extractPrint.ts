// The print alone, off a photo of a READY garment (website chat, 2026-11-13).
//
// A customer attaches a photo of a printed hoodie and writes "put this
// lettering on a blue hoodie". Placing the photo prints a hoodie on a hoodie,
// and background removal keeps the whole hoodie. The Messenger bot has had the
// answer since 2026-11-01 (gemini-proxy extract-print-gpt: GPT Image redraws
// the print flat on a magenta key); this is the website's door to the same
// thing — gemini-proxy "extract-print-web", billable like background removal.
//
// PURE of the constructor: no state, no toast, no quota gate. The caller owns
// those (SimplePage.handleExtractPrint), so a later caller — a sketch drawn
// inside the chat itself — can use the same function.
import { keyOutRgba } from "@/lib/flagKey";
import { callGemini } from "@/lib/generation";

/** Long side sent to the model (it returns 1024²; more only costs upload). */
export const EXTRACT_SEND_MAX = 1600;
/** Below this share of keyed-out pixels the model did not put the print on the key colour. */
export const EXTRACT_MIN_KEYED = 0.02;
/** Below this share of remaining pixels nothing but the key colour came back. */
export const EXTRACT_MIN_PRINT = 0.002;

export class ExtractPrintError extends Error {
  constructor(public code: "no_key" | "empty") {
    super(code);
    this.name = "ExtractPrintError";
  }
}

export interface KeyedPrint {
  /** Tight box of what is left (pixels). */
  x: number;
  y: number;
  w: number;
  h: number;
  keyedShare: number;
  printShare: number;
}

/**
 * Key the magenta out of RGBA bytes (in place) and measure what is left.
 * Pure — tested without a canvas. Throws ExtractPrintError when the result is
 * not a print on a key: the caller must then leave the customer's photo alone.
 */
export function keyPrintRgba(d: Uint8ClampedArray, width: number, height: number): KeyedPrint {
  keyOutRgba(d);
  let keyed = 0;
  let left = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const a = d[(y * width + x) * 4 + 3];
      if (a === 0) keyed++;
      if (a > 40) {
        left++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  const n = Math.max(1, width * height);
  const keyedShare = keyed / n;
  const printShare = left / n;
  if (keyedShare < EXTRACT_MIN_KEYED) throw new ExtractPrintError("no_key");
  if (printShare < EXTRACT_MIN_PRINT || x1 < x0 || y1 < y0) throw new ExtractPrintError("empty");
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, keyedShare, printShare };
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("image load failed"));
    i.src = src;
  });
}

/** The photo as a JPEG data URL, long side ≤ EXTRACT_SEND_MAX (on white: no alpha in JPEG). */
async function forSending(photo: string): Promise<string> {
  const img = await load(photo);
  const k = Math.min(1, EXTRACT_SEND_MAX / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

/**
 * One paid call (≈ $0.15): the garment photo → its print alone, transparent
 * PNG data URL, trimmed to the print. Throws RateLimitError (from callGemini)
 * and ExtractPrintError; never returns the photo unchanged.
 */
export async function extractPrintFromPhoto(photo: string): Promise<string> {
  const { image } = await callGemini("extract-print-web", { image: await forSending(photo) });
  const img = await load(image);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const box = keyPrintRgba(data.data, c.width, c.height);
  g.putImageData(data, 0, 0);
  const pad = Math.round(Math.max(box.w, box.h) * 0.02);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(c.width - x, box.w + 2 * pad);
  const h = Math.min(c.height - y, box.h + 2 * pad);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, w, h);
  return out.toDataURL("image/png");
}
