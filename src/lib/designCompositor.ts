import type { DesignStateSide } from "@/lib/designState";
import { getDesignStateTexts } from "@/lib/designState";

// Renders a print-quality PNG from a saved DesignStateSide. Used by the
// admin "Regenerate print file" button when the customer's checkout-time
// upload failed (transparent_image_url is NULL on the order) or when the
// admin needs a fresh render after a code fix.
//
// Mirrors compositeDesignOnly in SimplePage.tsx — kept as a separate
// implementation because that one is driven by the live editor state
// while this one reads from the persisted JSONB column. They share no
// runtime, but the rendering math must stay in sync; see the test plan
// in commit notes for parity verification steps.
//
// Output is sized to the full t-shirt canvas (4000×4000) — see
// compositeDesignOnly's banner comment for the resolution decision.

const DEFAULT_PRINT_SIZE = 4000;

async function ensureFontReady(fontFamily: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    const first = fontFamily.split(",")[0].replace(/['"]/g, "").trim();
    if (first) await document.fonts.load(`bold 80px "${first}"`);
    await document.fonts.ready;
  } catch {
    /* fonts API best-effort */
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${url}`));
    img.src = url;
  });
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  fontFamily: string,
  color: string,
  maxFontSize: number,
) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const MIN_FONT_SIZE = Math.max(8, maxFontSize * 0.1);
  let fontSize = maxFontSize;
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  let widest = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > widest) widest = w;
  }
  if (widest > maxWidth && widest > 0) {
    fontSize = Math.max(MIN_FONT_SIZE, fontSize * (maxWidth / widest));
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
  }

  const lineHeight = fontSize * 1.25;
  const totalHeight = lineHeight * lines.length;
  const startY = cy - totalHeight / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, startY + i * lineHeight, maxWidth);
  }
}

export async function compositePrintFileFromDesignState(
  side: DesignStateSide,
  options: { canvasWidth?: number } = {},
): Promise<Blob | null> {
  const hasPhotos = side.photos.some((p) => p.url);
  // Backward-compat: old orders have a single `text`, new orders have `texts`.
  const texts = getDesignStateTexts(side).filter((t) => t.content.trim().length > 0);
  const hasText = texts.length > 0;
  if (!hasPhotos && !hasText) return null;

  for (const t of texts) await ensureFontReady(t.font);

  // Print canvas = full mockup-canvas area (square, matches the 800×800
  // source mockups) so a re-rendered design includes every layer the
  // customer placed, including those outside the saved zone.
  const PRINT_SIZE = options.canvasWidth ?? DEFAULT_PRINT_SIZE;
  const canvasW = PRINT_SIZE;
  const canvasH = PRINT_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Zone in print-canvas pixels. design_state.zone is in canvas-fraction
  // (x/y = center, width/height = size); reproject through the print
  // canvas so photo.x/y/scale (zone-relative) map back to canvas pixels.
  const printZoneW = canvasW * side.zone.width;
  const printZoneH = canvasH * side.zone.height;
  const printZoneX = canvasW * side.zone.x - printZoneW / 2;
  const printZoneY = canvasH * side.zone.y - printZoneH / 2;

  // Photos in z_order ascending (matches upload order).
  const sortedPhotos = [...side.photos].sort((a, b) => a.z_order - b.z_order);
  for (const photo of sortedPhotos) {
    if (!photo.url) continue;
    try {
      const img = await loadImage(photo.url);
      const winW = printZoneW * photo.scale;
      const winH = printZoneH * photo.scaleY;
      const winCx = printZoneX + printZoneW * photo.x;
      const winCy = printZoneY + printZoneH * photo.y;
      const winX = winCx - winW / 2;
      const winY = winCy - winH / 2;

      // Crop semantics: when source_scale / source_offset_x/y are
      // present, render the source at its absolute position in zone
      // coordinates, clipped to the window. Legacy orders (fields
      // missing) fall through to the cover-fit center-crop below so
      // they render exactly as they did at order time.
      if (
        photo.source_scale !== undefined &&
        photo.source_offset_x !== undefined &&
        photo.source_offset_y !== undefined &&
        photo.source_scale > 0 &&
        img.naturalWidth > 0 &&
        img.naturalHeight > 0
      ) {
        const naturalAspect = img.naturalWidth / img.naturalHeight;
        const srcW_canvas = printZoneW * photo.source_scale;
        const srcH_canvas = srcW_canvas / naturalAspect;
        const srcCx_canvas = winCx + printZoneW * photo.source_offset_x;
        const srcCy_canvas = winCy + printZoneH * photo.source_offset_y;
        const srcX_canvas = srcCx_canvas - srcW_canvas / 2;
        const srcY_canvas = srcCy_canvas - srcH_canvas / 2;

        const destX = Math.max(srcX_canvas, winX);
        const destY = Math.max(srcY_canvas, winY);
        const destR = Math.min(srcX_canvas + srcW_canvas, winX + winW);
        const destB = Math.min(srcY_canvas + srcH_canvas, winY + winH);
        const destW = destR - destX;
        const destH = destB - destY;
        if (destW <= 0 || destH <= 0) continue;

        const sxFrac = (destX - srcX_canvas) / srcW_canvas;
        const syFrac = (destY - srcY_canvas) / srcH_canvas;
        const swFrac = destW / srcW_canvas;
        const shFrac = destH / srcH_canvas;
        const sx = sxFrac * img.naturalWidth;
        const sy = syFrac * img.naturalHeight;
        const sw = swFrac * img.naturalWidth;
        const sh = shFrac * img.naturalHeight;

        if (photo.rotation) {
          ctx.save();
          ctx.translate(winCx, winCy);
          ctx.rotate((photo.rotation * Math.PI) / 180);
          ctx.drawImage(img, sx, sy, sw, sh, destX - winCx, destY - winCy, destW, destH);
          ctx.restore();
        } else {
          ctx.drawImage(img, sx, sy, sw, sh, destX, destY, destW, destH);
        }
        continue;
      }

      // Legacy cover-fit (no source state stored).
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const boxAspect = winH > 0 ? winW / winH : 1;
      let srcX = 0;
      let srcY = 0;
      let srcW = img.naturalWidth;
      let srcH = img.naturalHeight;
      if (imgAspect > boxAspect) {
        srcW = img.naturalHeight * boxAspect;
        srcX = (img.naturalWidth - srcW) / 2;
      } else {
        srcH = img.naturalWidth / boxAspect;
        srcY = (img.naturalHeight - srcH) / 2;
      }
      if (photo.rotation) {
        ctx.save();
        ctx.translate(winCx, winCy);
        ctx.rotate((photo.rotation * Math.PI) / 180);
        ctx.drawImage(img, srcX, srcY, srcW, srcH, -winW / 2, -winH / 2, winW, winH);
        ctx.restore();
      } else {
        ctx.drawImage(img, srcX, srcY, srcW, srcH, winX, winY, winW, winH);
      }
    } catch (e) {
      console.warn(`[designCompositor] photo skipped:`, e);
    }
  }

  // Draw EVERY text element (multi-text). A dropped text = wrong product.
  for (const t of texts) {
    const tx = printZoneX + printZoneW * t.x;
    const ty = printZoneY + printZoneH * t.y;
    const maxTextWidth = Math.min(canvasW * 0.95, tx * 2, (canvasW - tx) * 2);
    const fontPx = Math.round(canvasW * 0.1);
    if (t.rotation) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate((t.rotation * Math.PI) / 180);
      drawTextBlock(ctx, t.content, 0, 0, maxTextWidth, t.font, t.color, fontPx);
      ctx.restore();
    } else {
      drawTextBlock(ctx, t.content, tx, ty, maxTextWidth, t.font, t.color, fontPx);
    }
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
