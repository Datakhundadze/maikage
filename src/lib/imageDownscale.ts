// Canvas downscale for data URLs, shared by the try-on stash and the /chat
// photo attachment.
//
// Extracted verbatim from TryOnModal (where it was module-private) so both
// callers use one implementation. Same signature, same defaults (1200px long
// edge, JPEG quality 0.8), same best-effort contract — it NEVER throws,
// returning the original string if the image fails to load, a 2D context is
// unavailable, or encoding fails. Callers rely on that: this is a size
// optimisation, never a hard requirement.
//
// ⚠️ TRANSPARENCY SURVIVES NOW. This used to emit JPEG unconditionally, and
// JPEG has no alpha channel — a fresh canvas's backing store is transparent
// BLACK, so a customer's transparent logo came out of here on a solid black
// rectangle and went onto the garment that way. The source's pixels decide
// the output format: any transparency → PNG, fully opaque → JPEG as before.

/**
 * True when any pixel on the canvas is not fully opaque.
 *
 * BY PIXEL, NOT BY MIME TYPE — deliberately. A PNG export of an opaque
 * photograph carries an alpha channel that is 255 everywhere; keying on the
 * container would re-encode it as PNG at ~14× the JPEG payload for nothing.
 * Only pixels can say whether there is anything to preserve.
 *
 * Early exit on the first such pixel, so the images that pay the full scan
 * are exactly the opaque ones — where it is a single sequential pass over
 * ~4MB for a 1024px canvas, well under a frame. Alpha sits at byte 3 of each
 * RGBA quad.
 */
function canvasHasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 255) return true;
  }
  return false;
}

export async function downscaleDataUrl(dataUrl: string, maxEdge = 1200, quality = 0.8): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    // PNG takes NO quality argument — passing one anyway would be read as
    // "lossy PNG at 0.8", which is not a thing; the parameter is simply
    // ignored for image/png, so it is not passed at all. `quality` remains
    // exactly what it always was: the JPEG quality for opaque sources.
    return canvasHasTransparency(ctx, w, h)
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}
