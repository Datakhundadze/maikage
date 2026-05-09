// Off-screen mockup compositing for the catalog detail page. Mirrors the
// pixel-multiply tint logic in ProductPreview's colorizeImage so a Sol's
// Pink/Khaki/etc. catalog mockup matches the live preview.
//
// Why not reuse ProductPreview's canvas? It's a private ref inside the
// component (no toDataURL hook). Studio uses runGenerationPipeline, Simple
// uses compositeSide — neither fits a transparent PNG that already exists on
// disk. So we build a focused helper here.

import {
  catalog,
  COLORS,
  type ProductType,
  type ProductColor,
  type ProductView,
} from "@/lib/catalog";

interface CompositeArgs {
  printFileUrl: string;
  productName: string;
  subProduct: string;
  color: string;
  view: ProductView;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// Luminance-based RGB multiply on the current canvas pixels. Identical to
// ProductPreview.colorizeImage so the order mockup matches the live preview.
function tintCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, hex: string) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const target = hexToRgb(hex);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const t = lum / 255;
    data[i] = Math.round(target.r * t);
    data[i + 1] = Math.round(target.g * t);
    data[i + 2] = Math.round(target.b * t);
  }
  ctx.putImageData(imageData, 0, 0);
}

export async function compositeDesignOnProduct(args: CompositeArgs): Promise<string | null> {
  const { printFileUrl, productName, subProduct, color, view } = args;

  const imageResult = catalog.findImageForColor(
    productName as ProductType,
    subProduct,
    color as ProductColor,
    view,
  );
  const baseImageUrl = imageResult?.entry.imageUrl;
  if (!baseImageUrl) return null;

  try {
    const baseImg = await loadImage(baseImageUrl);
    const printImg = await loadImage(printFileUrl);

    const canvas = document.createElement("canvas");
    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(baseImg, 0, 0);

    if (!imageResult.isExact) {
      const colorEntry = COLORS.find((c) => c.name === color);
      const hex = colorEntry?.hex ?? "#FFFFFF";
      // Pure black on a white photo crushes shading flat; soften like ProductPreview.
      const effectiveHex = color === "Black" ? "#1a1a1a" : hex;
      tintCanvas(canvas, ctx, effectiveHex);
    }

    const zone = imageResult.entry.placementZone;
    const zoneW = (zone.scale ?? 1) * canvas.width;
    const zoneH = (zone.scaleY ?? zone.scale ?? 1) * canvas.height;
    const zoneX = (zone.x ?? 0.5) * canvas.width - zoneW / 2;
    const zoneY = (zone.y ?? 0.5) * canvas.height - zoneH / 2;

    // Contain-fit the print inside the zone box, preserving aspect ratio.
    const printAR = printImg.naturalWidth / printImg.naturalHeight;
    const zoneAR = zoneW / zoneH;
    const drawW = printAR > zoneAR ? zoneW : zoneH * printAR;
    const drawH = printAR > zoneAR ? zoneW / printAR : zoneH;
    const drawX = zoneX + (zoneW - drawW) / 2;
    const drawY = zoneY + (zoneH - drawH) / 2;

    ctx.drawImage(printImg, drawX, drawY, drawW, drawH);

    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("[compositeDesignOnProduct]", e);
    return null;
  }
}
