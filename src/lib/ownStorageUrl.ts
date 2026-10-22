// Is this an http(s) URL of a PUBLIC object on maika.ge's own Supabase
// storage (project ykoseamefoabptuijsza)?
//
// Used by checkout (OrderDialog) and add-to-cart (useCart) to skip
// re-uploading a print file that is already stored with us — the catalog
// design page passes its print_file_url (catalog-designs bucket), and
// fetching + re-uploading a 30 MB print there used to cost ~30 s at checkout.
// The URL is then stored on the order / cart item as-is, so production keeps
// receiving the full-resolution ORIGINAL file.
//
// Deliberately narrow — anything else keeps the old upload path:
//   - data: / blob: URLs (constructor-made prints) → false
//   - other hosts, including look-alikes (…supabase.co.evil.com, user@host) → false
//   - the Image Transformation endpoint (/storage/v1/render/image/…), which
//     serves a DOWNSCALED render, never the original → false
//   - signed / authenticated object URLs → false (they expire)

export const OWN_STORAGE_HOST = "ykoseamefoabptuijsza.supabase.co";
const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";

export function isOwnStorageUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.hostname !== OWN_STORAGE_HOST) return false;
  if (parsed.port !== "" || parsed.username !== "" || parsed.password !== "") return false;
  if (!parsed.pathname.startsWith(PUBLIC_OBJECT_PATH)) return false;
  // Must name an object inside a bucket: /storage/v1/object/public/<bucket>/<path>
  const rest = parsed.pathname.slice(PUBLIC_OBJECT_PATH.length);
  const slash = rest.indexOf("/");
  return slash > 0 && slash < rest.length - 1;
}
