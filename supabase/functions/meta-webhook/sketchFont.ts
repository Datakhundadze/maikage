// Noto Sans Georgian Bold for DM text sketches — fetched once per isolate.
//
// SOURCE. The static TTF (v2.005, SIL OFL) as packaged in the npm package
// @expo-google-fonts/noto-sans-georgian@0.4.3, served by two public npm CDNs
// at an exact, immutable version. The font covers Georgian (Mkhedruli) AND
// basic Latin, digits and punctuation, so mixed lettering needs no fallback.
//
// INTEGRITY. The bytes must hash to FONT_SHA256 (computed from the npm tarball
// the CDNs serve); anything else is rejected and the next URL is tried. A
// failed load is not cached, so a CDN hiccup costs one sketch, not the isolate.

import type { FontLike } from "./sketchRaster.ts";

export const FONT_URLS = [
  "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-georgian@0.4.3/700Bold/NotoSansGeorgian_700Bold.ttf",
  "https://unpkg.com/@expo-google-fonts/noto-sans-georgian@0.4.3/700Bold/NotoSansGeorgian_700Bold.ttf",
];
export const FONT_SHA256 = "4570253cfb7d734286d56ab3ecff6e4ef2cfe9d77c37dc9e739360da89dccc15";
export const FONT_BYTES = 62896;

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FontLoaderDeps {
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
  parse: (buffer: ArrayBuffer) => FontLike;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

let cached: Promise<FontLike | null> | null = null;

/** The parsed font, or null. Concurrent callers share one fetch. */
export function loadSketchFont(deps: FontLoaderDeps): Promise<FontLike | null> {
  if (cached) return cached;
  const p = (async () => {
    for (const url of FONT_URLS) {
      const bytes = await deps.fetchBytes(url).catch(() => null);
      if (!bytes) {
        deps.log("warn", `sketch font: fetch failed (${new URL(url).host})`);
        continue;
      }
      if ((await sha256Hex(bytes)) !== FONT_SHA256) {
        deps.log("warn", `sketch font: hash mismatch (${new URL(url).host}, ${bytes.length} bytes)`);
        continue;
      }
      try {
        const copy = bytes.slice().buffer;
        return deps.parse(copy);
      } catch (e) {
        deps.log("warn", `sketch font: parse failed: ${e instanceof Error ? e.name : "error"}`);
      }
    }
    return null;
  })();
  cached = p;
  p.then((f) => { if (!f && cached === p) cached = null; });
  return p;
}

/** Test hook. */
export function _resetSketchFont(): void {
  cached = null;
}
