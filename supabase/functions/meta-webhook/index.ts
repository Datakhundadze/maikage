// Meta (Messenger + Instagram DM) webhook — Deno entry point.
//
// Everything that can be tested lives in handler.ts (no Deno, no supabase-js).
// This file only: reads the two secrets from the environment, builds the
// service-role client, and supplies the store function.
//
// SECRETS — set in the Supabase project's function secrets, never in code:
//   META_APP_SECRET    the App Secret from the Meta App dashboard; signs every POST
//   META_VERIFY_TOKEN  a string you invent and paste into the dashboard's
//                      "Verify token" field; checked on the GET subscription call
// No META_PAGE_TOKEN: the only outbound calls are downloads of the photo
// URLs Meta itself put in a signed delivery (see media.ts).
// Their values are never logged.
//
// PHOTOS. After a NEW row is stored, its images are copied into the private
// "social-uploads" bucket in the background (EdgeRuntime.waitUntil), so the
// answer to Meta is never delayed by a download. At most every PURGE_EVERY_MS
// per isolate, photos older than RETENTION_DAYS are deleted the same way.
//
// DEPLOY. A GitHub merge does not deploy edge functions; deploy meta-webhook
// manually, then paste the callback URL into the Meta App dashboard:
//   https://<project-ref>.supabase.co/functions/v1/meta-webhook
// and subscribe the Page to the `messages` and `message_echoes` fields (and
// the Instagram account to `messages`). verify_jwt is false for this function
// in supabase/config.toml — Meta cannot send a Supabase JWT; the HMAC
// signature is the authentication.
//
// ON 500. handler.ts answers 500 only when the database write fails. Meta
// retries a non-2xx delivery with backoff for a while, which is the only
// replay we have for a transient outage. Meta can disable the subscription
// after prolonged failures; if that ever bites, make `store` swallow the error
// and return 200, at the cost of silently losing rows during the outage.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMetaWebhook, type SocialAttachment, type SocialMessageRow, type StoreResult } from "./handler.ts";
import {
  MAX_IMAGE_BYTES,
  SOCIAL_UPLOAD_BUCKET,
  mirrorRowImages,
  mirrorTargets,
  purgeExpired,
  type FetchedImage,
} from "./media.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";

if (!META_APP_SECRET || !META_VERIFY_TOKEN) {
  // Names only, never values. With an empty secret the handler refuses every
  // request, which is the safe failure.
  console.error("[meta-webhook] META_APP_SECRET and/or META_VERIFY_TOKEN not set — all deliveries will be refused");
}

/**
 * Insert with ON CONFLICT (meta_message_id) DO NOTHING semantics.
 *
 * PostgREST expresses that as an upsert with `ignoreDuplicates` on the unique
 * column (Prefer: resolution=ignore-duplicates). The whole batch goes in one
 * statement; if that statement fails for any reason, fall back to one row at
 * a time so a single bad row cannot take the rest of the batch with it, and
 * report an error only if a row still cannot be written.
 */
async function store(rows: SocialMessageRow[]): Promise<StoreResult> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { inserted: 0, error: "service role not configured" };
  const admin = makeAdmin();
  const table = () => admin.from("social_messages");

  const batch = await table()
    .upsert(rows, { onConflict: "meta_message_id", ignoreDuplicates: true })
    .select("meta_message_id");
  if (!batch.error) {
    afterStore(admin, rows, (batch.data ?? []).map((r: { meta_message_id: string }) => r.meta_message_id));
    return { inserted: batch.data?.length ?? 0, error: null };
  }

  console.warn(`[meta-webhook] batch insert failed (${batch.error.code ?? "?"}), retrying row by row: ${batch.error.message}`);
  let inserted = 0;
  const failures: string[] = [];
  const newIds: string[] = [];
  for (const row of rows) {
    const one = await table()
      .upsert(row, { onConflict: "meta_message_id", ignoreDuplicates: true })
      .select("meta_message_id");
    if (one.error) failures.push(`${row.meta_message_id}: ${one.error.message}`);
    else {
      inserted += one.data?.length ?? 0;
      for (const r of one.data ?? []) newIds.push((r as { meta_message_id: string }).meta_message_id);
    }
  }
  afterStore(admin, rows, newIds);
  if (failures.length > 0) {
    console.error(`[meta-webhook] ${failures.length} row(s) could not be stored: ${failures.join(" | ")}`);
    return { inserted, error: `${failures.length} row(s) failed` };
  }
  return { inserted, error: null };
}

// ── photos ─────────────────────────────────────────────────────────────────

function makeAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
type Admin = ReturnType<typeof makeAdmin>;

const log = (level: "info" | "warn" | "error", msg: string) =>
  console[level === "info" ? "log" : level](`[meta-webhook] ${msg}`);

/** Keep background work alive after the Response, without delaying it. */
function runInBackground(work: Promise<unknown>, label: string): void {
  const guarded = work.catch((e) => console.error(`[meta-webhook] ${label} failed (ignored):`, e));
  try {
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") rt.waitUntil(guarded);
  } catch {
    /* already running and guarded */
  }
}

async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function deps(admin: Admin) {
  const bucket = () => admin.storage.from(SOCIAL_UPLOAD_BUCKET);
  const patchAttachments = async (mid: string, attachments: SocialAttachment[]) => {
    const { error } = await admin.from("social_messages").update({ attachments }).eq("meta_message_id", mid);
    if (error) log("warn", `attachments update failed for ${mid}: ${error.message}`);
    return !error;
  };
  return {
    fetchImage,
    upload: async (path: string, bytes: Uint8Array, contentType: string) => {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (!error) return "ok" as const;
      const msg = (error.message ?? "").toLowerCase();
      if (String((error as { statusCode?: unknown }).statusCode ?? "") === "409" || msg.includes("already exists") || msg.includes("duplicate")) {
        return "exists" as const;
      }
      log("warn", `upload ${path} failed: ${error.message}`);
      return "error" as const;
    },
    remove: async (paths: string[]) => {
      const { error } = await bucket().remove(paths);
      if (error) log("warn", `remove failed: ${error.message}`);
      return !error;
    },
    listExpired: async (cutoffIso: string, limit: number) => {
      const { data, error } = await admin
        .from("social_messages")
        .select("meta_message_id, attachments")
        .lt("sent_at", cutoffIso)
        .filter("attachments", "cs", JSON.stringify([{ stored: true }]))
        .limit(limit);
      if (error) {
        log("warn", `purge list failed: ${error.message}`);
        return [];
      }
      return data ?? [];
    },
    patchAttachments,
    log,
  };
}

const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPurgeAt = 0;

/** Copy the photos of rows inserted just now; now and then, delete old ones. */
function afterStore(admin: Admin, rows: SocialMessageRow[], newIds: string[]): void {
  const fresh = new Set(newIds);
  const withPhotos = rows.filter((r) => fresh.has(r.meta_message_id) && mirrorTargets(r.attachments).length > 0);
  const d = deps(admin);
  if (withPhotos.length > 0) {
    runInBackground(
      (async () => {
        let n = 0;
        for (const r of withPhotos) n += await mirrorRowImages(r, d);
        log("info", `photos stored: ${n}`);
      })(),
      "photo copy",
    );
  }
  const now = Date.now();
  if (now - lastPurgeAt > PURGE_EVERY_MS) {
    lastPurgeAt = now;
    runInBackground(purgeExpired(new Date(now), d), "photo purge");
  }
}

serve((req) =>
  handleMetaWebhook(req, {
    appSecret: META_APP_SECRET,
    verifyToken: META_VERIFY_TOKEN,
    store,
  })
);
