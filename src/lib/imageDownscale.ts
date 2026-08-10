// Canvas downscale for data URLs, shared by the try-on stash and the /chat
// photo attachment.
//
// Extracted verbatim from TryOnModal (where it was module-private) so both
// callers use one implementation. Behaviour is unchanged: same signature, same
// defaults (1200px long edge, JPEG quality 0.8), same best-effort contract —
// it NEVER throws, returning the original string if the image fails to load,
// a 2D context is unavailable, or encoding fails. Callers rely on that: this
// is a size optimisation, never a hard requirement.
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
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}
