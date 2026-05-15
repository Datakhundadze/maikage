import { supabase } from "@/integrations/supabase/client";

export interface UploadResult {
  publicUrl: string;
}

/**
 * Upload a Blob to Supabase Storage with one retry on failure. Throws on
 * the second failure so callers can abort the checkout instead of
 * silently writing NULL for transparent_image_url / front_mockup_url and
 * shipping an unfulfillable order to the admin panel.
 *
 * The previous behavior was a single attempt that returned null on error,
 * which produced paid orders with no print file when storage had a
 * transient failure (RLS, network, payload size).
 */
export async function uploadBlobWithRetry(
  bucket: string,
  path: string,
  blob: Blob,
  options: { contentType?: string; upsert?: boolean } = {},
): Promise<UploadResult> {
  const contentType = options.contentType || blob.type || "image/png";
  const upsert = options.upsert ?? true;
  let lastMessage = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType, upsert });
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return { publicUrl: data.publicUrl };
    }
    lastMessage = error.message || String(error);
    console.warn(`[upload] attempt ${attempt}/2 failed for ${path}: ${lastMessage}`);
    if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Upload failed for ${path} after 2 attempts: ${lastMessage}`);
}

/** Convert a data URL to a Blob without going through fetch (smaller code path). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
