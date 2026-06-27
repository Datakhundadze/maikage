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

// Render a text string to a TIGHT raster canvas (sized to the glyph box). Kept
// in sync with renderTextRasterCanvas in SimplePage.tsx so the print-file
// render matches the editor preview + the order mockup exactly.
function renderTextRasterCanvas(
  content: string,
  fontFamily: string,
  color: string,
  fontSize: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return null;
  measureCtx.font = `bold ${fontSize}px ${fontFamily}`;
  let widest = 0;
  for (const line of lines) {
    const w = measureCtx.measureText(line).width;
    if (w > widest) widest = w;
  }
  const lineHeight = fontSize * 1.25;
  const pad = Math.ceil(fontSize * 0.18);
  const w = Math.max(1, Math.ceil(widest) + pad * 2);
  const h = Math.max(1, Math.ceil(lineHeight * lines.length) + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  const startY = pad + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], w / 2, startY + i * lineHeight);
  }
  return canvas;
}

// Contain-fit a text raster into a window box (canvas px) at (winCx, winCy),
// honouring rotation. `storedAspect` (DesignStateText.naturalAspect) is used
// when present; legacy orders without it fall back to the freshly-rendered
// raster's own aspect. Mirrors drawTextContained in SimplePage.tsx.
function drawTextContained(
  ctx: CanvasRenderingContext2D,
  content: string,
  fontFamily: string,
  color: string,
  fontSize: number,
  winCx: number,
  winCy: number,
  winW: number,
  winH: number,
  rotationDeg: number,
  storedAspect?: number,
): void {
  const raster = renderTextRasterCanvas(content, fontFamily, color, fontSize);
  if (!raster || winW <= 0 || winH <= 0) return;
  const rasterAspect = storedAspect && storedAspect > 0 ? storedAspect : raster.width / raster.height;
  const boxAspect = winW / winH;
  let drawW: number;
  let drawH: number;
  if (rasterAspect >= boxAspect) {
    drawW = winW;
    drawH = winW / rasterAspect;
  } else {
    drawH = winH;
    drawW = winH * rasterAspect;
  }
  if (rotationDeg) {
    ctx.save();
    ctx.translate(winCx, winCy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(raster, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  } else {
    ctx.drawImage(raster, winCx - drawW / 2, winCy - drawH / 2, drawW, drawH);
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

  // Draw EVERY text element (multi-text) via the window-box contain-fit — the
  // box the user sized (scale × scaleY) at x/y — so the print file matches the
  // editor preview + the order mockup. A dropped/mis-sized text = wrong product.
  for (const t of texts) {
    const winW = printZoneW * t.scale;
    const winH = printZoneH * (t.scaleY ?? t.scale);
    const winCx = printZoneX + printZoneW * t.x;
    const winCy = printZoneY + printZoneH * t.y;
    drawTextContained(
      ctx, t.content, t.font, t.color, Math.round(canvasW * 0.3),
      winCx, winCy, winW, winH, t.rotation ?? 0, t.naturalAspect,
    );
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
