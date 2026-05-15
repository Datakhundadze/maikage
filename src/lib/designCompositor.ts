import type { DesignStateSide } from "@/lib/designState";

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

const DEFAULT_PRINT_SIZE = 3000;

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
  const hasText = !!side.text && side.text.content.trim().length > 0;
  if (!hasPhotos && !hasText) return null;

  if (hasText && side.text) await ensureFontReady(side.text.font);

  const PRINT_SIZE = options.canvasWidth ?? DEFAULT_PRINT_SIZE;
  // Match compositeDesignOnly's aspect computation: zone.height /
  // zone.width is the aspect, and the canvas IS the zone.
  const aspect = side.zone.width > 0 ? side.zone.height / side.zone.width : 1;
  const canvasW = PRINT_SIZE;
  const canvasH = Math.round(PRINT_SIZE * aspect);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Photos in z_order ascending (matches upload order).
  const sortedPhotos = [...side.photos].sort((a, b) => a.z_order - b.z_order);
  for (const photo of sortedPhotos) {
    if (!photo.url) continue;
    try {
      const img = await loadImage(photo.url);
      const boxW = canvasW * photo.scale;
      const boxH = canvasH * photo.scaleY;
      const boxX = canvasW * photo.x - boxW / 2;
      const boxY = canvasH * photo.y - boxH / 2;
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const boxAspect = boxH > 0 ? boxW / boxH : 1;
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
        ctx.translate(boxX + boxW / 2, boxY + boxH / 2);
        ctx.rotate((photo.rotation * Math.PI) / 180);
        ctx.drawImage(img, srcX, srcY, srcW, srcH, -boxW / 2, -boxH / 2, boxW, boxH);
        ctx.restore();
      } else {
        ctx.drawImage(img, srcX, srcY, srcW, srcH, boxX, boxY, boxW, boxH);
      }
    } catch (e) {
      console.warn(`[designCompositor] photo skipped:`, e);
    }
  }

  if (hasText && side.text) {
    const t = side.text;
    const tx = canvasW * t.x;
    const ty = canvasH * t.y;
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
