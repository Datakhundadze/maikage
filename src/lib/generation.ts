import { supabase } from "@/integrations/supabase/client";
import type { DesignParams } from "@/hooks/useDesign";
import { COLORS } from "@/lib/catalog";

interface GenerateDesignParams {
  designParams: DesignParams;
  product: string;
  color: string;
  speed: "fast" | "quality";
}

export interface GenerationResult {
  designImage: string;       // base64 design on white bg
  transparentImage: string;  // base64 transparent PNG
  mockupImage: string;       // base64 composited mockup
  prompt: string;
}

async function callGemini(action: string, params: Record<string, any>, retries = 2): Promise<{ image: string; text: string }> {
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

  // Seed BFS from all four corners
  for (const seed of [0, w - 1, (h - 1) * w, (h - 1) * w + w - 1]) {
    if (!visited[seed] && isNearWhite(seed * 4)) {
      visited[seed] = 1;
      queue.push(seed);
    }
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
  coords: { x: number; y: number; scale: number }
): string {
  const SIZE = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Fill background with the selected product color
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Place design using same coord system as compositeMockup
  const designWidth = SIZE * coords.scale;
  const designHeight = (designImg.naturalHeight / designImg.naturalWidth) * designWidth;
  const designX = SIZE * coords.x - designWidth / 2;
  const designY = SIZE * coords.y - designHeight / 2;
  ctx.drawImage(designImg, designX, designY, designWidth, designHeight);

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
  coords: { x: number; y: number; scale: number }
): string {
  const canvas = document.createElement("canvas");
  canvas.width = productImg.naturalWidth;
  canvas.height = productImg.naturalHeight;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(productImg, 0, 0);

  const designWidth = canvas.width * coords.scale;
  const designHeight = (designImg.naturalHeight / designImg.naturalWidth) * designWidth;
  const designX = canvas.width * coords.x - designWidth / 2;
  const designY = canvas.height * coords.y - designHeight / 2;

  ctx.globalAlpha = 1.0;
  ctx.drawImage(designImg, designX, designY, designWidth, designHeight);

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

export async function runGenerationPipeline(
  params: GenerateDesignParams,
  placementCoords: { x: number; y: number; scale: number },
  productImageUrl: string | null,
  onStatusChange: (status: string) => void,
  isExactColor: boolean = true
): Promise<GenerationResult> {
  // Stage 1: Generate design on white background
  onStatusChange("GENERATING_DESIGN");
  const designResult = await callGemini("generate-design", {
    ...params.designParams,
    product: params.product,
    color: params.color,
    speed: params.speed,
  });

  const designImage = designResult.image;

  // Stage 2: Background removal via difference matting with fallback
  onStatusChange("PROCESSING_TRANSPARENCY");

  let transparentImage: string;
  try {
    // Try difference matting: convert white bg to black bg, then extract alpha
    const blackBgResult = await callGemini("convert-bg-black", { image: designImage });
    const whiteImg = await loadImage(designImage);
    const blackImg = await loadImage(blackBgResult.image);
    const whiteCanvas = imageToCanvas(whiteImg);
    const blackCanvas = imageToCanvas(blackImg);
    const transparentCanvas = differenceMatting(whiteCanvas, blackCanvas);

    // Validate matting result — if mostly transparent, fallback to simple removal
    if (isMostlyTransparent(transparentCanvas)) {
      console.warn("[Generation] Difference matting produced mostly transparent result, falling back to white bg removal");
      const fallbackCanvas = removeConnectedWhiteBackground(removeWhiteBackground(whiteCanvas));
      transparentImage = fallbackCanvas.toDataURL("image/png");
    } else {
      // Flood-fill to remove any residual white border the matting missed
      const cleanedCanvas = removeConnectedWhiteBackground(transparentCanvas);
      transparentImage = cleanedCanvas.toDataURL("image/png");
    }
  } catch (mattingError) {
    console.warn("[Generation] Difference matting failed, using white bg removal fallback:", mattingError);
    const whiteImg = await loadImage(designImage);
    const whiteCanvas = imageToCanvas(whiteImg);
    const fallbackCanvas = removeConnectedWhiteBackground(removeWhiteBackground(whiteCanvas));
    transparentImage = fallbackCanvas.toDataURL("image/png");
  }

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
      mockupImage = compositeMockup(productImg, transparentImg, placementCoords);
    } else {
      // Colorize the white t-shirt base image to match the selected color
      const colorizedCanvas = colorizeWhiteProduct(productImg, colorHex);
      const colorizedImg = await loadImage(colorizedCanvas.toDataURL("image/png"));
      mockupImage = compositeMockup(colorizedImg, transparentImg, placementCoords);
    }
  } else {
    // No product photo at all — composite design onto solid color background
    const transparentImg = await loadImage(transparentImage);
    mockupImage = compositeMockupOnColorBg(transparentImg, colorHex, placementCoords);
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
