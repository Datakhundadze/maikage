import { supabase } from "@/integrations/supabase/client";
import type { DesignParams } from "@/hooks/useDesign";
import { COLORS } from "@/lib/catalog";

interface GenerateDesignParams {
  designParams: DesignParams;
  product: string;
  color: string;
  speed: "fast" | "quality" | "pro";
}

export interface GenerationResult {
  designImage: string;       // base64 design on white bg
  transparentImage: string;  // base64 transparent PNG
  mockupImage: string;       // base64 composited mockup
  prompt: string;
}

/**
 * Thrown when gemini-proxy returns HTTP 429 { code: "RATE_LIMITED" }. Carries
 * `requiresLogin` so callers can pick the right UX — open the login modal for
 * anon callers, or toast a slow-down message for authed ones. Never retried:
 * the cap is enforced server-side, so retrying would only hammer it.
 */
export class RateLimitError extends Error {
  requiresLogin: boolean;
  constructor(message: string, requiresLogin: boolean) {
    super(message);
    this.name = "RateLimitError";
    this.requiresLogin = requiresLogin;
  }
}

/**
 * Thrown when gemini-proxy returns HTTP 403 { code: "GENERATION_BLOCKED" } —
 * the anti-abuse block for a logged-in (non-anonymous) user over the free
 * generation limit with no paid order. Carries the server's bilingual message.
 * Never retried (the block is server-side; a paid order or contact unblocks).
 */
export class GenerationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationBlockedError";
  }
}

// Exported so the Simple-mode "with background" path can run a bare
// generate-design (skipping the transparency stage) while still reusing the
// exact same gemini-proxy invoke + RateLimitError handling. Body unchanged.
export async function callGemini(action: string, params: Record<string, any>, retries = 2): Promise<{ image: string; text: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase.functions.invoke("gemini-proxy", {
      body: { action, params },
    });

    if (error) {
      // Try to parse the error response for user-friendly messages (422 content policy, etc.)
      let errorBody: any = null;
      try {
        if (error.context && typeof error.context.json === "function") {
          errorBody = await error.context.json();
        }
      } catch { /* ignore parse errors */ }

      const userMessage = errorBody?.error || error.message || "AI request failed";

      // Rate limited (429) — short-circuit immediately, never retry (the cap
      // is server-side, so retrying would only hammer it).
      if (errorBody?.code === "RATE_LIMITED") {
        console.warn(`AI rate limited (${action})`);
        throw new RateLimitError(userMessage, errorBody.requiresLogin === true);
      }

      // Anti-abuse block (403) — short-circuit, never retry; a paid order or
      // contacting us unblocks (server-side).
      if (errorBody?.code === "GENERATION_BLOCKED") {
        console.warn(`AI generation blocked (${action})`);
        throw new GenerationBlockedError(userMessage);
      }

      // Don't retry content policy / safety errors — they'll fail every time
      const isContentBlock = userMessage.includes("content policy") || 
                             userMessage.includes("safety filters") || 
                             userMessage.includes("blocked by");
      if (isContentBlock) {
        console.error(`AI content blocked (${action}):`, userMessage);
        throw new Error(userMessage);
      }

      console.error(`AI call failed (${action}, attempt ${attempt + 1}):`, error);
      if (attempt === retries) throw new Error(userMessage);
      continue;
    }
    if (data?.code === "RATE_LIMITED") {
      console.warn(`AI rate limited (${action})`);
      throw new RateLimitError(data.error || "Rate limited", data.requiresLogin === true);
    }
    if (data?.code === "GENERATION_BLOCKED") {
      console.warn(`AI generation blocked (${action})`);
      throw new GenerationBlockedError(data.error || "Generation blocked");
    }
    if (data?.error) {
      const isContentBlock = data.error.includes("content policy") || 
                             data.error.includes("safety filters") || 
                             data.error.includes("blocked by");
      if (isContentBlock) {
        console.error(`AI content blocked (${action}):`, data.error);
        throw new Error(data.error);
      }
      console.error(`AI returned error (${action}, attempt ${attempt + 1}):`, data.error);
      if (attempt === retries) throw new Error(data.error);
      continue;
    }
    if (!data?.image) {
      console.error(`No image (${action}, attempt ${attempt + 1})`);
      if (attempt === retries) throw new Error("AI did not return an image. Please try again.");
      continue;
    }
    return { image: data.image, text: data.text || "" };
  }
  throw new Error("AI request failed after retries");
}

// Stage 2: Difference matting — convert white-bg + black-bg images to transparent PNG
function differenceMatting(whiteCanvas: HTMLCanvasElement, blackCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = whiteCanvas.width;
  const h = whiteCanvas.height;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;

  const wCtx = whiteCanvas.getContext("2d")!;
  const bCtx = blackCanvas.getContext("2d")!;
  const oCtx = outCanvas.getContext("2d")!;

  const wData = wCtx.getImageData(0, 0, w, h);
  const bData = bCtx.getImageData(0, 0, w, h);
  const oData = oCtx.createImageData(w, h);

  const wPx = wData.data;
  const bPx = bData.data;
  const oPx = oData.data;

  for (let i = 0; i < wPx.length; i += 4) {
    const wR = wPx[i], wG = wPx[i + 1], wB = wPx[i + 2];
    const bR = bPx[i], bG = bPx[i + 1], bB = bPx[i + 2];

    const dist = Math.sqrt(
      (wR - bR) ** 2 + (wG - bG) ** 2 + (wB - bB) ** 2
    );
    const alpha = 1 - dist / 441.67; // sqrt(255^2 * 3)

    if (alpha < 0.01) {
      oPx[i] = oPx[i + 1] = oPx[i + 2] = oPx[i + 3] = 0;
    } else {
      oPx[i] = Math.min(255, Math.round(bR / alpha));
      oPx[i + 1] = Math.min(255, Math.round(bG / alpha));
      oPx[i + 2] = Math.min(255, Math.round(bB / alpha));
      oPx[i + 3] = Math.round(alpha * 255);
    }
  }

  oCtx.putImageData(oData, 0, 0);
  return outCanvas;
}

// Fallback: simple white background removal for when difference matting fails
function removeWhiteBackground(canvas: HTMLCanvasElement, threshold = 240): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;

  const ctx = canvas.getContext("2d")!;
  const oCtx = outCanvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // Check if pixel is near-white
    if (r >= threshold && g >= threshold && b >= threshold) {
      // Smooth alpha based on how close to white
      const minChannel = Math.min(r, g, b);
      const alpha = Math.max(0, 1 - (minChannel - threshold) / (255 - threshold));
      px[i + 3] = Math.round(alpha * 255);
    }
  }

  oCtx.putImageData(imgData, 0, 0);
  return outCanvas;
}

// Post-process: flood-fill from image corners to remove connected white background.
// Preserves white design elements not connected to the border (e.g. white in artwork).
function removeConnectedWhiteBackground(canvas: HTMLCanvasElement, threshold = 235): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;

  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;

  const isNearWhite = (idx: number) =>
    px[idx] >= threshold && px[idx + 1] >= threshold && px[idx + 2] >= threshold;

  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  // Seed BFS from every pixel on the canvas border (top + bottom rows,
  // left + right columns). Was 4 corners only — that missed white regions
  // entering the artwork from the middle of an edge, leaving a visible
  // off-white rectangle around designs whose background only met the canvas
  // along an edge rather than a corner. BFS contiguity guarantees this
  // still only flood-fills near-white pixels reachable through a chain of
  // near-white neighbors, so non-white artwork that touches the edge is
  // safe — only edge-connected near-white regions are zeroed.
  const enqueueSeed = (seed: number) => {
    if (!visited[seed] && isNearWhite(seed * 4)) {
      visited[seed] = 1;
      queue.push(seed);
    }
  };
  for (let x = 0; x < w; x++) {
    enqueueSeed(x);                 // top row    (y = 0)
    enqueueSeed((h - 1) * w + x);   // bottom row (y = h - 1)
  }
  for (let y = 1; y < h - 1; y++) {
    enqueueSeed(y * w);             // left col   (x = 0)
    enqueueSeed(y * w + (w - 1));   // right col  (x = w - 1)
  }

  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    const x = pos % w;
    const y = Math.floor(pos / w);
    // Make this pixel transparent
    px[pos * 4 + 3] = 0;

    // 4-connected neighbors
    const neighbors = [
      x > 0     ? pos - 1 : -1,
      x < w - 1 ? pos + 1 : -1,
      y > 0     ? pos - w : -1,
      y < h - 1 ? pos + w : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && !visited[n]) {
        visited[n] = 1;
        if (isNearWhite(n * 4)) queue.push(n);
      }
    }
  }

  const oCtx = outCanvas.getContext("2d")!;
  oCtx.putImageData(imgData, 0, 0);
  return outCanvas;
}

// Check if an image is mostly one color (matting failed)
function isMostlyTransparent(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparentCount = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 10) transparentCount++;
  }
  // If more than 95% is transparent, matting likely failed
  return transparentCount / total > 0.95;
}

// Detect the realistic-mode failure pattern: matting produced partial
// alpha across most of the canvas instead of the expected
// {fully-opaque subject, fully-transparent background} split. This happens
// when Gemini 3 Pro slightly re-renders the subject between the white-bg
// and black-bg passes — per-pixel difference is moderate everywhere,
// alpha lands in a mid-band, and the result is a translucent haze that
// isMostlyTransparent doesn't catch.
function isMostlyPartialAlpha(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let partialCount = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 5 && data[i] < 250) partialCount++;
  }
  return partialCount / total > 0.7;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

// Composite transparent design onto a solid color background (used when no product photo exists)
function colorizeWhiteProduct(productImg: HTMLImageElement, colorHex: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = productImg.naturalWidth;
  canvas.height = productImg.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(productImg, 0, 0);

  const r = parseInt(colorHex.slice(1, 3), 16) / 255;
  const g = parseInt(colorHex.slice(3, 5), 16) / 255;
  const b = parseInt(colorHex.slice(5, 7), 16) / 255;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Skip fully transparent pixels (background)
    if (data[i + 3] === 0) continue;
    // Multiply blend: preserves shadows/highlights of the white t-shirt
    data[i]     = Math.round(data[i]     * r);
    data[i + 1] = Math.round(data[i + 1] * g);
    data[i + 2] = Math.round(data[i + 2] * b);
    // alpha unchanged
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function compositeMockupOnColorBg(
  designImg: HTMLImageElement,
  colorHex: string,
  coords: { x: number; y: number; scale: number; scaleY?: number },
  zone?: { x: number; y: number; scale: number; scaleY?: number },
): string {
  const SIZE = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Fill background with the selected product color
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // coords are interpreted relative to `zone` (if provided), matching how
  // DraggablePlacement renders the live preview. Falling back to canvas-
  // relative when no zone is passed keeps older callers working.
  const zoneW = zone ? SIZE * zone.scale : SIZE;
  const zoneH = zone ? SIZE * (zone.scaleY ?? zone.scale) : SIZE;
  const zoneLeft = zone ? SIZE * zone.x - zoneW / 2 : 0;
  const zoneTop = zone ? SIZE * zone.y - zoneH / 2 : 0;
  const boxW = zoneW * coords.scale;
  const boxH = zoneH * (coords.scaleY ?? coords.scale);
  const boxX = zoneLeft + zoneW * coords.x - boxW / 2;
  const boxY = zoneTop + zoneH * coords.y - boxH / 2;
  const imgAspect = designImg.naturalWidth / designImg.naturalHeight;
  const boxAspect = boxW / boxH;
  let srcX = 0, srcY = 0, srcW = designImg.naturalWidth, srcH = designImg.naturalHeight;
  if (imgAspect > boxAspect) {
    srcW = designImg.naturalHeight * boxAspect;
    srcX = (designImg.naturalWidth - srcW) / 2;
  } else {
    srcH = designImg.naturalWidth / boxAspect;
    srcY = (designImg.naturalHeight - srcH) / 2;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxW, boxH);
  ctx.clip();
  ctx.drawImage(designImg, srcX, srcY, srcW, srcH, boxX, boxY, boxW, boxH);
  ctx.restore();

  // Watermark
  ctx.globalAlpha = 0.45;
  const fontSize = Math.max(12, Math.round(SIZE * 0.025));
  ctx.font = `600 ${fontSize}px "BPG Nino Mtavruli", "Noto Sans Georgian", "Segoe UI", sans-serif`;
  ctx.fillStyle = colorHex === "#FFFFFF" || colorHex === "#FFFDD0" || colorHex === "#FFF8E7" || colorHex === "#FFD700" ? "#000000" : "#ffffff";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("maika.ge", SIZE - fontSize * 0.8, SIZE - fontSize * 0.6);
  ctx.globalAlpha = 1.0;

  return canvas.toDataURL("image/png");
}

// Stage 3: Composite design onto product photo with watermark (exported for re-compositing)
export function compositeMockup(
  productImg: HTMLImageElement,
  designImg: HTMLImageElement,
  coords: { x: number; y: number; scale: number; scaleY?: number },
  zone?: { x: number; y: number; scale: number; scaleY?: number },
): string {
  const canvas = document.createElement("canvas");
  canvas.width = productImg.naturalWidth;
  canvas.height = productImg.naturalHeight;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(productImg, 0, 0);

  // coords are interpreted relative to `zone` (if provided), matching how
  // DraggablePlacement renders the live preview. Without this alignment
  // the same coords {0.5, 0.42, 0.38} placed the design at 14% of preview
  // (zone-relative × zone size) but at 38% of canvas (canvas-relative) —
  // the generated mockup looked 2-3× bigger than the preview promised.
  const zoneW = zone ? canvas.width * zone.scale : canvas.width;
  const zoneH = zone ? canvas.height * (zone.scaleY ?? zone.scale) : canvas.height;
  const zoneLeft = zone ? canvas.width * zone.x - zoneW / 2 : 0;
  const zoneTop = zone ? canvas.height * zone.y - zoneH / 2 : 0;
  const boxW = zoneW * coords.scale;
  const boxH = zoneH * (coords.scaleY ?? coords.scale);
  const boxX = zoneLeft + zoneW * coords.x - boxW / 2;
  const boxY = zoneTop + zoneH * coords.y - boxH / 2;
  const imgAspect = designImg.naturalWidth / designImg.naturalHeight;
  const boxAspect = boxW / boxH;
  let srcX = 0, srcY = 0, srcW = designImg.naturalWidth, srcH = designImg.naturalHeight;
  if (imgAspect > boxAspect) {
    srcW = designImg.naturalHeight * boxAspect;
    srcX = (designImg.naturalWidth - srcW) / 2;
  } else {
    srcH = designImg.naturalWidth / boxAspect;
    srcY = (designImg.naturalHeight - srcH) / 2;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxW, boxH);
  ctx.clip();
  ctx.globalAlpha = 1.0;
  ctx.drawImage(designImg, srcX, srcY, srcW, srcH, boxX, boxY, boxW, boxH);
  ctx.restore();

  // Watermark
  ctx.globalAlpha = 0.45;
  const fontSize = Math.max(12, Math.round(canvas.width * 0.025));
  ctx.font = `600 ${fontSize}px "BPG Nino Mtavruli", "Noto Sans Georgian", "Segoe UI", sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("maika.ge", canvas.width - fontSize * 0.8, canvas.height - fontSize * 0.6);
  ctx.globalAlpha = 1.0;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  return canvas.toDataURL("image/png");
}

// Public entry point to the transparency-extraction pipeline used by both
// the customer studio (via runGenerationPipeline below) and the admin AI
// agent (which already has an accepted design and only needs the alpha
// PNG, not the mockup composite).
//
// Mode-aware fallback thresholds. Photoreal Gemini 3 Pro output has soft
// shadow/penumbra around the subject so "background" pixels can sit at
// RGB ≈ 210-240 (not pure white); the illustration path from Gemini 2.5
// Flash has pure-white background and benefits from the stricter
// historical defaults. Keep illustration mode untouched so the existing
// clean-matting flow doesn't regress.
//
// usedFallback=true means the result came from the white-bg removal path,
// not difference matting. Callers can surface this so the admin verifies
// the print file is acceptable.
export interface TransparencyResult {
  transparentImage: string;
  usedFallback: boolean;
}

export async function runTransparencyPipeline(
  designBase64: string,
  opts: { isRealistic: boolean },
): Promise<TransparencyResult> {
  const { isRealistic } = opts;
  const fallbackWhiteThreshold = isRealistic ? 210 : 240;
  const fallbackCornerThreshold = isRealistic ? 210 : 235;

  try {
    // Try difference matting: convert white bg to black bg, then extract alpha
    const blackBgResult = await callGemini("convert-bg-black", { image: designBase64 });
    const whiteImg = await loadImage(designBase64);
    const blackImg = await loadImage(blackBgResult.image);
    const whiteCanvas = imageToCanvas(whiteImg);
    const blackCanvas = imageToCanvas(blackImg);
    const transparentCanvas = differenceMatting(whiteCanvas, blackCanvas);

    // Validate matting result. isMostlyTransparent catches the "everything
    // collapsed to alpha=0" failure; isMostlyPartialAlpha catches the
    // realistic-mode "everything stuck at mid-band alpha" failure where the
    // subject was re-rendered between passes. Either triggers the fallback.
    const mattingFailed =
      isMostlyTransparent(transparentCanvas) ||
      isMostlyPartialAlpha(transparentCanvas);

    if (mattingFailed) {
      console.warn(
        "[Generation] Difference matting unreliable, falling back to white-bg removal",
        { isRealistic, fallbackWhiteThreshold, fallbackCornerThreshold },
      );
      const fallbackCanvas = removeConnectedWhiteBackground(
        removeWhiteBackground(whiteCanvas, fallbackWhiteThreshold),
        fallbackCornerThreshold,
      );
      return { transparentImage: fallbackCanvas.toDataURL("image/png"), usedFallback: true };
    }
    // Flood-fill to remove any residual white border the matting missed.
    // Uses the mode-aware threshold (210 for realistic so the soft shadow
    // penumbra Gemini-3-Pro adds under realistic subjects gets cleaned;
    // 235 for illustration) instead of the function default. The 4-corner
    // seed list was also widened to the full border (see
    // removeConnectedWhiteBackground) so edge-connected off-white anywhere
    // around the design — not only at the corners — is removed.
    const cleanedCanvas = removeConnectedWhiteBackground(transparentCanvas, fallbackCornerThreshold);
    return { transparentImage: cleanedCanvas.toDataURL("image/png"), usedFallback: false };
  } catch (mattingError) {
    console.warn("[Generation] Difference matting failed, using white bg removal fallback:", mattingError);
    const whiteImg = await loadImage(designBase64);
    const whiteCanvas = imageToCanvas(whiteImg);
    const fallbackCanvas = removeConnectedWhiteBackground(
      removeWhiteBackground(whiteCanvas, fallbackWhiteThreshold),
      fallbackCornerThreshold,
    );
    return { transparentImage: fallbackCanvas.toDataURL("image/png"), usedFallback: true };
  }
}

export async function runGenerationPipeline(
  params: GenerateDesignParams,
  placementCoords: { x: number; y: number; scale: number; scaleY?: number },
  productImageUrl: string | null,
  onStatusChange: (status: string) => void,
  isExactColor: boolean = true,
  placementZone?: { x: number; y: number; scale: number; scaleY?: number },
): Promise<GenerationResult> {
  // Stage 1: Generate design on white background
  onStatusChange("GENERATING_DESIGN");
  const isRealistic = /realistic|photo|რეალ/i.test(params.designParams.style || "");

  // For realistic mode: override style with explicit photorealism descriptors,
  // and force speed="pro" so the deployed edge function selects gemini-3-pro-image-preview.
  // NOTE: The deployed edge function (main branch) uses speed to pick the model,
  // and injects the style string as "ARTISTIC STYLE:" directly into the prompt.
  const adjustedDesignParams = isRealistic ? {
    ...params.designParams,
    style: "realistic hyperrealistic photographic render — ultra-detailed surface textures, NO black outlines, smooth natural color gradients, photographic lighting and shadows, NOT illustration NOT drawing NOT cartoon NOT graphic art",
  } : params.designParams;

  const designResult = await callGemini("generate-design", {
    ...adjustedDesignParams,
    product: params.product,
    color: params.color,
    speed: isRealistic ? "pro" : params.speed, // Force pro model for realistic
    isRealistic,
  });

  const designImage = designResult.image;

  // Stage 2: Background removal via difference matting with fallback
  onStatusChange("PROCESSING_TRANSPARENCY");

  const { transparentImage } = await runTransparencyPipeline(designImage, { isRealistic });

  // Stage 3: Mockup compositing
  onStatusChange("GENERATING_MOCKUP");

  // Look up the hex color for the selected product color
  const colorEntry = COLORS.find(c => c.name === params.color);
  const colorHex = colorEntry?.hex ?? "#FFFFFF";

  let mockupImage: string;
  if (productImageUrl) {
    const productImg = await loadImage(productImageUrl);
    const transparentImg = await loadImage(transparentImage);
    if (isExactColor) {
      mockupImage = compositeMockup(productImg, transparentImg, placementCoords, placementZone);
    } else {
      // Colorize the white t-shirt base image to match the selected color
      const colorizedCanvas = colorizeWhiteProduct(productImg, colorHex);
      const colorizedImg = await loadImage(colorizedCanvas.toDataURL("image/png"));
      mockupImage = compositeMockup(colorizedImg, transparentImg, placementCoords, placementZone);
    }
  } else {
    // No product photo at all — composite design onto solid color background
    const transparentImg = await loadImage(transparentImage);
    mockupImage = compositeMockupOnColorBg(transparentImg, colorHex, placementCoords, placementZone);
  }

  return {
    designImage,
    transparentImage,
    mockupImage,
    prompt: designResult.text,
  };
}

export async function upscaleImage(imageBase64: string): Promise<string> {
  const result = await callGemini("upscale", { image: imageBase64 });
  return result.image;
}

// Phase B (photo restyle): re-render an uploaded photo in an artistic style.
// `instruction` is the user-chosen style (preset or free text); the gemini-proxy
// "restyle" action wraps it in a fixed subject-preserving GUARD. Mirrors
// upscaleImage — billable, so 429 / generation-block surface via callGemini.
export async function restyleImage(imageBase64: string, instruction: string): Promise<string> {
  const result = await callGemini("restyle", { image: imageBase64, instruction });
  return result.image;
}
