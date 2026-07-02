// Rewrites a Supabase public-storage URL to the Image Transformation
// endpoint so DISPLAY surfaces load a downscaled render instead of the
// full-resolution original:
//
//   .../storage/v1/object/public/<bucket>/<path>
//     → .../storage/v1/render/image/public/<bucket>/<path>?width=..&quality=..
//
// Width-only resize preserves aspect ratio (height scales proportionally),
// so canvas composites keep identical geometry — only pixel density drops.
//
// ⚠️ Display-only. The ORDER path (the production print file stored on the
// order row and the checkout mockup build) must keep the original stored
// URL — never run it through this helper.
//
// Anything that isn't a Supabase public-object URL (data:, blob:, external
// hosts, already-transformed URLs) passes through unchanged, so callers can
// apply this unconditionally.

const PUBLIC_OBJECT_MARKER = "/storage/v1/object/public/";
const RENDER_MARKER = "/storage/v1/render/image/public/";

export interface DisplayTransform {
  width: number;
  quality?: number;
}

export function transformedDisplayUrl(url: string, { width, quality = 65 }: DisplayTransform): string {
  if (!url) return url;
  const idx = url.indexOf(PUBLIC_OBJECT_MARKER);
  if (idx === -1) return url;
  const rewritten = url.slice(0, idx) + RENDER_MARKER + url.slice(idx + PUBLIC_OBJECT_MARKER.length);
  const sep = rewritten.includes("?") ? "&" : "?";
  return `${rewritten}${sep}width=${width}&quality=${quality}`;
}
