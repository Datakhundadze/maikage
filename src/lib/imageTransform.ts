import type { SyntheticEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

// Helpers for serving resized/re-encoded images via Supabase Image
// Transformations (the /render/image/public endpoint) instead of full-res
// originals. Frontend-only, works on already-uploaded files — no re-upload.
//
// Safe fallback: a transformed <img> uses imgFallbackToOriginal on error to
// swap to the plain (untransformed) URL once, so any path/plan/render edge
// case degrades to the original image instead of a broken tile.

export interface ImageTransform {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
}

/** Plain public URL (no transform) — the onError fallback. */
export function publicImageUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Resized/re-encoded public URL (WebP when the browser supports it). */
export function transformedImageUrl(bucket: string, path: string, transform: ImageTransform): string {
  return supabase.storage.from(bucket).getPublicUrl(path, { transform }).data.publicUrl;
}

/** <img onError> handler: swap to the untransformed original ONCE (guarded
 *  against an infinite error loop if the original also fails to load). */
export function imgFallbackToOriginal(e: SyntheticEvent<HTMLImageElement>, originalUrl: string): void {
  const img = e.currentTarget;
  if (img.dataset.fellBack === "1") return;
  img.dataset.fellBack = "1";
  if (img.src !== originalUrl) img.src = originalUrl;
}
