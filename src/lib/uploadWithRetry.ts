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
 *
 * ⚠️ upsert DEFAULTS TO FALSE (was true until 2026-09-24). An upsert upload
 * is an INSERT … ON CONFLICT at the storage layer, and under row-level
 * security Postgres refuses that statement unless the caller ALSO has a
 * SELECT policy covering the row — even when no conflict happens. Anonymous
 * customers have INSERT-only policies on order-originals/ (since June, when
 * its SELECT became admin-only — every OrderDialog original upload has
 * silently failed since) and, after migration 20260924110000, on
 * cart-items/ and order-mockups/ too. A plain INSERT needs only the INSERT
 * policy. Every customer-side path here is unique per call (a fresh UUID in
 * the folder or file name), so nothing legitimate ever overwrote anyway.
 * The admin's "regenerate print file" writes a deterministic path and
 * passes upsert: true explicitly; admins hold the matching UPDATE + SELECT
 * policies.
 */
/**
 * Storage reports an upload onto an existing key (with upsert: false) as a
 * duplicate. Message wording has varied across storage-api versions, so match
 * loosely; the status code is 409 when present.
 */
function isDuplicateError(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  if (String(error.statusCode ?? "") === "409") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("already exists") || m.includes("duplicate");
}

export async function uploadBlobWithRetry(
  bucket: string,
  path: string,
  blob: Blob,
  options: { contentType?: string; upsert?: boolean } = {},
): Promise<UploadResult> {
  const contentType = options.contentType || blob.type || "image/png";
  const upsert = options.upsert ?? false;
  let lastMessage = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType, upsert });
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return { publicUrl: data.publicUrl };
    }
    // upsert: false and "already exists":
    //   - on attempt 1 it means someone ELSE created the path first. Refuse
    //     at once — retrying would only see the same file and could mistake
    //     it for ours. This refusal is the point of upsert: false.
    //   - on attempt 2, after attempt 1 failed WITHOUT an answer (network,
    //     timeout), it means attempt 1 reached storage and only its response
    //     was lost. Every customer-side path carries a per-call random UUID,
    //     so nobody else could have written it in between: it is our own
    //     file, and the upload succeeded.
    if (!upsert && isDuplicateError(error)) {
      if (attempt === 1) {
        throw new Error(`Upload refused for ${path}: path already exists`);
      }
      console.warn(`[upload] ${path} already existed on retry — treating attempt 1 as delivered`);
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
