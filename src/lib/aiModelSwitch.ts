// Which image model the photo actions use (2026-10-22).
//
// After the admin "AI მოდელების ტესტი" comparison, photo background removal and
// photo restyle moved from Gemini 3 Pro Image to GPT Image (gemini-proxy
// actions "isolate-subject-gpt" and "restyle-gpt"): same or better result at
// roughly a quarter of the cost. The Gemini actions are still deployed and
// untouched — set a flag to false to go back, nothing else needs to change.
export const USE_GPT_PHOTO_BG = true;
export const USE_GPT_RESTYLE = true;

// The main AI design generator (2026-10-30): runGenerationPipeline tries
// gemini-proxy "generate-design-gpt" (GPT Image 2.5 Sunburst) first. It returns
// a real transparent PNG in one call, so the convert-bg-black matte is skipped
// — ~$0.14 per design against up to $0.72 on Gemini. A/B on 10 real prompts:
// GPT 6, Gemini 3, tie 1. Any failure (error, no image, no real alpha) falls
// back to the untouched Gemini generate-design → transparency pipeline. Set to
// false to go back to Gemini only, nothing else needs to change.
export const USE_GPT_GENERATE = true;

/**
 * Share of pixels that are (partly) transparent, 0..1, sampled on a ≤256 px
 * copy. The GPT background removal returns a real transparent PNG, so this is
 * its success check — the counterpart of chromaKeyGreen's keyedFraction for
 * the Gemini green-screen path. Returns 0 when the image cannot be read.
 */
export async function transparentShare(dataUrl: string): Promise<number> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = dataUrl;
    await img.decode();
    const w = Math.max(1, Math.min(256, img.naturalWidth));
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let t = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) t++;
    return t / (w * h);
  } catch {
    return 0;
  }
}
