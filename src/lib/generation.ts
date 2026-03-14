import { supabase } from "@/integrations/supabase/client";
import type { DesignParams } from "@/hooks/useDesign";

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
      console.error(`AI call failed (${action}, attempt ${attempt + 1}):`, error);
      if (attempt === retries) throw new Error(error.message || "AI request failed");
      continue;
    }
    if (data?.error) {
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

// Stage 3: Composite design onto product photo (exported for re-compositing)
export function compositeMockup(
  productImg: HTMLImageElement,
  designImg: HTMLImageElement,
  coords: { x: number; y: number; scale: number }
): string {
  const canvas = document.createElement("canvas");
  canvas.width = productImg.naturalWidth;
  canvas.height = productImg.naturalHeight;
  const ctx = canvas.getContext("2d")!;

  // Draw product
  ctx.drawImage(productImg, 0, 0);

  // Calculate design placement
  const designWidth = canvas.width * coords.scale;
  const designHeight = (designImg.naturalHeight / designImg.naturalWidth) * designWidth;
  const designX = canvas.width * coords.x - designWidth / 2;
  const designY = canvas.height * coords.y - designHeight / 2;

  // Draw design
  ctx.globalAlpha = 1.0;
  ctx.drawImage(designImg, designX, designY, designWidth, designHeight);

  return canvas.toDataURL("image/png");
}

export async function runGenerationPipeline(
  params: GenerateDesignParams,
  placementCoords: { x: number; y: number; scale: number },
  productImageUrl: string | null,
  onStatusChange: (status: string) => void
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

  // Stage 2: Background removal via difference matting
  onStatusChange("PROCESSING_TRANSPARENCY");

  // Convert white bg to black bg
  const blackBgResult = await callGemini("convert-bg-black", { image: designImage });

  // Load both images and apply difference matting
  const whiteImg = await loadImage(designImage);
  const blackImg = await loadImage(blackBgResult.image);
  const whiteCanvas = imageToCanvas(whiteImg);
  const blackCanvas = imageToCanvas(blackImg);
  const transparentCanvas = differenceMatting(whiteCanvas, blackCanvas);
  const transparentImage = transparentCanvas.toDataURL("image/png");

  // Stage 3: Mockup compositing
  onStatusChange("GENERATING_MOCKUP");

  let mockupImage: string;
  if (productImageUrl) {
    const productImg = await loadImage(productImageUrl);
    const transparentImg = await loadImage(transparentImage);
    mockupImage = compositeMockup(productImg, transparentImg, placementCoords);
  } else {
    // No product image yet — use transparent design as mockup placeholder
    mockupImage = transparentImage;
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
