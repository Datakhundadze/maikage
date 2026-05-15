// Once-per-session WebP support detection. Used by catalog.ts so the
// mockup base images that ship in /public/products/ are loaded as .webp
// (small) on modern browsers and fall back to .png (large but
// universally supported) on the rare browser that doesn't decode WebP.
//
// The check runs the first time it's called — toDataURL with a tiny
// canvas returns a "data:image/webp" prefix iff the engine can encode
// WebP, which is a reliable proxy for decoding support.

let cached: boolean | null = null;

export function supportsWebP(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") {
    cached = false;
    return false;
  }
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    cached = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * Swap the file extension on a /public asset path to .webp when the
 * current browser supports it. Returns the original URL otherwise.
 * No-op for data URLs, http(s) URLs to third-party origins, paths that
 * already end in .webp, and any path outside the recognized list.
 */
export function preferWebP(url: string): string {
  if (!url) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  // Third-party (Supabase storage) URLs come back unchanged — those
  // assets aren't pre-converted by our build script.
  if (/^https?:\/\//i.test(url)) return url;
  if (!supportsWebP()) return url;
  const m = url.match(/\.(png|jpe?g)(\?[^#]*)?(#.*)?$/i);
  if (!m) return url;
  return url.replace(/\.(png|jpe?g)(?=\?|#|$)/i, ".webp");
}
