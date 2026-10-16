// Orchestration for the DESIGN cutout paths (add-only). Kept out of SimplePage
// so the decision logic is unit-testable with injected model/key functions.

import type { ChromaKeyResult } from "@/lib/chromaKey";

/**
 * Same threshold, same meaning as handleRemoveBgPhoto's: below this share of
 * the frame keyed as backdrop, the model did not return a green backdrop and
 * the "cutout" is the input unchanged.
 */
export const MIN_KEYED_FRACTION = 0.02;

export interface DesignCutoutDeps {
  /** chromaKeyGreenDesign in production. */
  key: (greenImage: string) => Promise<ChromaKeyResult>;
  /** isolateDesign (gemini-proxy "isolate-design") in production. */
  isolate: (image: string) => Promise<string>;
}

export interface DesignCutoutResult {
  /** Transparent PNG, or null when both the edit and the fallback failed to key. */
  image: string | null;
  keyedFraction: number;
  /** true when the first result did not key and isolate-design ran on it. */
  usedFallback: boolean;
}

/**
 * Key an edit-image-cutout result; if the model ignored the green instruction
 * (keyed < MIN_KEYED_FRACTION), run isolate-design ON THAT EDIT RESULT — so the
 * customer's requested edit is kept — and key again. One fallback, never more:
 * each attempt is a paid pro-tier call.
 */
export async function keyDesignCutout(greenImage: string, deps: DesignCutoutDeps): Promise<DesignCutoutResult> {
  const first = await deps.key(greenImage);
  if (first.keyedFraction >= MIN_KEYED_FRACTION) {
    return { image: first.image, keyedFraction: first.keyedFraction, usedFallback: false };
  }
  const isolated = await deps.isolate(greenImage);
  const second = await deps.key(isolated);
  if (second.keyedFraction >= MIN_KEYED_FRACTION) {
    return { image: second.image, keyedFraction: second.keyedFraction, usedFallback: true };
  }
  return { image: null, keyedFraction: second.keyedFraction, usedFallback: true };
}

/**
 * Draw an image onto an opaque WHITE canvas and return it as PNG.
 *
 * The white-removal transparency pipeline (runTransparencyPipeline, unchanged)
 * was built for designs on clean white. A layer placed from the AI chat is
 * usually ALREADY transparent, and transparent pixels are not white — handing
 * it over as-is would give the matting step an undefined backdrop. Flattening
 * first makes the input exactly what that pipeline expects.
 */
export async function flattenOnWhite(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}
