// Photos from Messenger / Instagram DMs → our own PRIVATE storage, and their
// removal after RETENTION_DAYS. No Deno APIs and no supabase-js here, so
// vitest drives it with in-memory fakes; index.ts supplies the real I/O.
//
// WHY. Meta's attachment URLs are temporary and stop working within days, so
// the admin "შეტყობინებები" tab could only show a paperclip. The webhook now
// downloads each IMAGE once, right after its message row is first stored, into
// the private "social-uploads" bucket (admins read it through signed URLs, like
// chat-uploads), and records the object path on the attachment itself:
//
//   attachments: [{ type: "image", url, path: "messenger/2026-10/<mid>-0.jpg", stored: true }]
//
// RETENTION. Customer photos are personal data and are only useful while the
// order is live. purgeExpired() removes stored photos of messages older than
// RETENTION_DAYS from storage and rewrites the attachment as
//   { type: "image", url: null, purged: true }
// so the admin tab can say the photo was deleted instead of showing nothing.
// Message TEXT is not touched by this.
//
// BEST EFFORT. Every step logs and moves on. A failed download leaves the
// attachment exactly as before (type + temporary url), which is what the tab
// showed until now. Nothing here can change the webhook's answer to Meta.

import type { Channel, SocialAttachment } from "./handler.ts";

export const SOCIAL_UPLOAD_BUCKET = "social-uploads";
export const RETENTION_DAYS = 90;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Rows handled per purge pass; the pass repeats on later deliveries. */
export const PURGE_BATCH = 50;

export type Log = (level: "info" | "warn" | "error", msg: string) => void;

export interface MirrorRow {
  channel: Channel;
  meta_message_id: string;
  sent_at: string;
  attachments: SocialAttachment[];
}

export interface FetchedImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface MediaDeps {
  /** Download a Meta attachment URL. null on any failure, non-image or oversize. */
  fetchImage: (url: string) => Promise<FetchedImage | null>;
  /** Upload without overwrite. "exists" means an earlier attempt already stored it. */
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<"ok" | "exists" | "error">;
  /** Replace the attachments array of one row. */
  patchAttachments: (metaMessageId: string, attachments: SocialAttachment[]) => Promise<boolean>;
  log: Log;
}

export interface PurgeDeps {
  /** Rows sent before `cutoffIso` that still hold at least one stored photo. */
  listExpired: (cutoffIso: string, limit: number) => Promise<{ meta_message_id: string; attachments: SocialAttachment[] }[]>;
  /** Delete storage objects. */
  remove: (paths: string[]) => Promise<boolean>;
  patchAttachments: (metaMessageId: string, attachments: SocialAttachment[]) => Promise<boolean>;
  log: Log;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

/** File extension for an image content type, or null for anything that is not a picture we keep. */
export function extForContentType(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return EXT_BY_TYPE[base] ?? null;
}

/** Storage-safe piece of a Meta message id (they can carry `=`, `+`, `/`). */
export function safeKey(mid: string): string {
  return mid.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "msg";
}

/** <channel>/<yyyy-mm of sent_at>/<mid>-<index>.<ext> */
export function objectPath(channel: Channel, mid: string, sentAtIso: string, index: number, ext: string): string {
  const month = /^\d{4}-\d{2}/.test(sentAtIso) ? sentAtIso.slice(0, 7) : "unknown";
  return `${channel}/${month}/${safeKey(mid)}-${index}.${ext}`;
}

/** Indexes of attachments that are images with a live URL and are not stored yet. */
export function mirrorTargets(attachments: SocialAttachment[]): number[] {
  const out: number[] = [];
  attachments.forEach((a, i) => {
    if (a && a.type === "image" && typeof a.url === "string" && a.url.startsWith("https://") && !a.stored && !a.purged) out.push(i);
  });
  return out;
}

/** Copy one row's images into storage and record their paths. Returns how many were stored. */
export async function mirrorRowImages(row: MirrorRow, deps: MediaDeps): Promise<number> {
  const targets = mirrorTargets(row.attachments);
  if (targets.length === 0) return 0;
  const next = row.attachments.map((a) => ({ ...a }));
  let stored = 0;
  for (const i of targets) {
    const img = await deps.fetchImage(next[i].url as string);
    if (!img) {
      deps.log("warn", `photo ${row.meta_message_id}#${i}: download failed or not an image — left as link`);
      continue;
    }
    const ext = extForContentType(img.contentType);
    if (!ext || img.bytes.byteLength === 0 || img.bytes.byteLength > MAX_IMAGE_BYTES) {
      deps.log("warn", `photo ${row.meta_message_id}#${i}: skipped (${img.contentType}, ${img.bytes.byteLength} bytes)`);
      continue;
    }
    const path = objectPath(row.channel, row.meta_message_id, row.sent_at, i, ext);
    const res = await deps.upload(path, img.bytes, img.contentType.split(";")[0].trim());
    if (res === "error") {
      deps.log("warn", `photo ${row.meta_message_id}#${i}: upload failed`);
      continue;
    }
    next[i] = { ...next[i], path, stored: true };
    stored += 1;
  }
  if (stored === 0) return 0;
  const ok = await deps.patchAttachments(row.meta_message_id, next);
  if (!ok) {
    deps.log("error", `photo ${row.meta_message_id}: stored ${stored} file(s) but could not record the path`);
    return 0;
  }
  return stored;
}

/** The attachments array after its stored photos are deleted. */
export function purgedAttachments(attachments: SocialAttachment[]): SocialAttachment[] {
  return attachments.map((a) => (a && a.stored ? { type: a.type, url: null, purged: true } : a));
}

/** Delete stored photos older than RETENTION_DAYS. Returns how many files were removed. */
export async function purgeExpired(now: Date, deps: PurgeDeps, limit = PURGE_BATCH): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await deps.listExpired(cutoff, limit);
  let removed = 0;
  for (const r of rows) {
    const paths = (r.attachments ?? []).filter((a) => a && a.stored && typeof a.path === "string").map((a) => a.path as string);
    if (paths.length > 0) {
      const ok = await deps.remove(paths);
      if (!ok) {
        deps.log("warn", `purge ${r.meta_message_id}: could not delete ${paths.length} file(s), will retry later`);
        continue;
      }
    }
    // Rewrite even when no path was found, so a malformed row is not listed forever.
    if (await deps.patchAttachments(r.meta_message_id, purgedAttachments(r.attachments ?? []))) removed += paths.length;
  }
  if (rows.length > 0) deps.log("info", `purge: ${removed} photo(s) older than ${RETENTION_DAYS} days deleted`);
  return removed;
}
