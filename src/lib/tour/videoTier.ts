// Which copy of the walk video to stream (/showroom). The walk plays at 1.4×
// and jumps between files, so it needs about 1.4 × the file's bitrate:
//   4k   3840×1920, ≤ 11 Mbps  → wants ~25 Mbps
//   hd   2560×1280, ≤ 5 Mbps   → wants ~11 Mbps
//   lite 1920×960,  ≤ 3 Mbps   → anything slower
// Measured once per browser session with a small download from the same
// storage (David's laptop, 2026-11-07: ~8–9 Mbps — the 4K copy stalled
// for seconds at every jump).

import type { WalkPart } from "./walkTrack";

export type VideoTier = "4k" | "hd" | "lite";

export const TIER_MBPS = { "4k": 25, hd: 11 } as const;

/** Tier for a measured speed (Mbps; null = unknown). Phones/tablets never get 4k. */
export function pickTier(mbps: number | null, phone: boolean): VideoTier {
  if (mbps === null) return "hd";
  if (!phone && mbps >= TIER_MBPS["4k"]) return "4k";
  if (mbps >= TIER_MBPS.hd) return "hd";
  return "lite";
}

/** The file base for a part in a tier, falling back to the next better copy that exists. */
export function partBase(part: WalkPart, tier: VideoTier): string {
  if (tier === "lite") return part.liteBase ?? part.mobileBase ?? part.base;
  if (tier === "hd") return part.mobileBase ?? part.base;
  return part.base;
}

const KEY = "maika.tour.mbps";

export function cachedMbps(): number | null {
  try {
    const v = Number(window.sessionStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Download speed (Mbps) from `url`: reads up to `bytes` of it, but stops at
 * `timeoutMs` and counts what arrived by then (a slow line is answered in
 * time too). null if nothing could be read. Cached for the session.
 */
export async function measureMbps(url: string, bytes = 1_500_000, timeoutMs = 3500): Promise<number | null> {
  const ctl = new AbortController();
  const t0 = performance.now();
  let got = 0;
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal: ctl.signal, cache: "no-store" });
    const reader = res.body?.getReader();
    if (!reader) return null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
    }
  } catch {
    // aborted at the time limit (or failed): use what arrived
  } finally {
    window.clearTimeout(timer);
  }
  const sec = (performance.now() - t0) / 1000;
  if (got < 50_000 || sec <= 0) return null;
  const mbps = (got * 8) / 1e6 / sec;
  try {
    window.sessionStorage.setItem(KEY, mbps.toFixed(2));
  } catch {
    // private mode: measured again next time
  }
  return mbps;
}
