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
//   META_PAGE_TOKEN    OPTIONAL. Long-lived Page access token (pages_messaging)
//                      for the social auto-reply bot (autoReply.ts). Without it
//                      the bot logs once and stays silent; the mirror is unaffected.
// Their values are never logged.
//
// SKETCH IMAGES (add-only, 2026-10-31). When the bot's reply carries a
// maika-generate / maika-mockup (text) block, the design is rendered on the
// product server-side and sent as an image (sketchFlow.ts). Libraries are
// npm packages pinned to exact versions: jpeg-js@0.4.4 (JPEG encode/decode,
// no dependencies) and opentype.js@1.3.4 (TTF outlines; its two caret deps,
// tiny-inflate and string.prototype.codepointat, have had no release since
// 2019 / 2018). PNG decoding is pngDecode.ts. Images go to the public
// "designs" bucket under social-sketches/. Run the SQL in
// migrations/20261031200000_social_bot_sketch_kind.sql BEFORE deploying.
// PHOTO SKETCHES (add-only, 2026-10-31): a block with "photo": N places the
// customer's own photo N; it is read from the private social-uploads bucket
// with the service role (sketchDeps.downloadUpload) and never made public —
// only the rendered sketch goes to designs/social-sketches/<hash>/. No SQL.
//
// AUTO-REPLY (add-only). After a NEW inbound customer row is stored, the bot
// run (autoReply.ts) is scheduled in the background like the photo copy. It
// reads public.social_bot_settings first; with enabled = false (the default)
// that single read is all it does, and nothing is ever sent.
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
import type { SocialAdReferralRow } from "./referrals.ts";
import { redactPii } from "./redactPii.ts";
import { isBotCandidate, sendBody, sendImageBody, type BotSendRecord, type OutRow, type ThreadRow } from "./botReply.ts";
import { runAutoReply, scrubSecrets, type AutoReplyDeps, type SendResult } from "./autoReply.ts";
import { countSketchRows, type SketchDeps } from "./sketchFlow.ts";
import { loadSketchFont, sha256Hex } from "./sketchFont.ts";
import type { FontLike } from "./sketchRaster.ts";
import type { RgbaImage } from "./pngDecode.ts";
import jpeg from "npm:jpeg-js@0.4.4";
import opentype from "npm:opentype.js@1.3.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const META_PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN") ?? "";

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
  // Auto-reply bot: only rows inserted just now (a Meta retry is a no-op),
  // inbound, not unsupported, with text or a photo. Background only.
  const candidates = rows.filter((r) => fresh.has(r.meta_message_id) && isBotCandidate(r));
  if (candidates.length > 0) {
    const ar = autoReplyDeps(admin);
    for (const r of candidates) runInBackground(runAutoReply(r, ar), "auto-reply");
  }
}

// ── auto-reply bot ─────────────────────────────────────────────────────────

const GRAPH_SEND_URL = "https://graph.facebook.com/v21.0/me/messages";
const MAIKA_PAGE_ID = "159657880717306";

/**
 * META_PAGE_TOKEN may hold either a Page token or a USER / SYSTEM-USER token
 * (Business Settings → System users, never expires). The Send API needs a
 * Page token, so a user-type token is exchanged once per isolate via
 * GET me/accounts. A Page token makes me/accounts fail → used as-is.
 * Tokens travel only in the Authorization header and are never logged.
 */
let cachedPageToken: string | null = null;
async function pageToken(): Promise<string> {
  if (cachedPageToken) return cachedPageToken;
  try {
    const res = await fetch("https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token&limit=100", {
      headers: { Authorization: `Bearer ${META_PAGE_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null) as { data?: { id?: unknown; access_token?: unknown }[] } | null;
    const page = Array.isArray(data?.data) ? data!.data!.find((p) => p?.id === MAIKA_PAGE_ID) : undefined;
    if (res.ok && page && typeof page.access_token === "string" && page.access_token) {
      cachedPageToken = page.access_token;
      console.log("[meta-webhook] page token resolved from a user-type token");
      return cachedPageToken;
    }
  } catch {
    /* fall through: use the secret as a Page token */
  }
  cachedPageToken = META_PAGE_TOKEN;
  return cachedPageToken;
}

/**
 * Graph Send API. Works for Messenger PSIDs and, with the same Page token,
 * for Instagram IGSIDs (Messenger Platform for Instagram: POST me/messages).
 * The token goes in the Authorization header, never the URL, so no error
 * message or log line can carry it.
 */
async function graphSend(channel: "messenger" | "instagram", recipientId: string, text: string): Promise<SendResult> {
  return await postGraph(sendBody(channel, recipientId, text));
}

/** The Send API call itself, for a text (graphSend) or an image (graphSendImage) body. */
async function postGraph(body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(GRAPH_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await pageToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null) as
      | { message_id?: unknown; error?: { code?: unknown; error_subcode?: unknown; type?: unknown } }
      | null;
    if (!res.ok) {
      if (res.status === 401) cachedPageToken = null; // re-resolve next time
      const err = data?.error;
      const code = err ? `${String(err.code ?? "?")}/${String(err.error_subcode ?? "-")}/${String(err.type ?? "-")}` : "no_body";
      return { ok: false, status: res.status, code };
    }
    return { ok: true, messageId: typeof data?.message_id === "string" ? data.message_id : null };
  } catch (e) {
    return { ok: false, status: 0, code: e instanceof Error ? e.name : "fetch_error" };
  }
}

/** A sketch image by its public URL. */
async function graphSendImage(channel: "messenger" | "instagram", recipientId: string, url: string): Promise<SendResult> {
  return await postGraph(sendImageBody(channel, recipientId, url));
}

/** gemini-proxy faq-chat, server to server, as the trusted social channel. */
async function askBot(
  channel: "messenger" | "instagram",
  conversationKey: string,
  history: { role: "user" | "assistant"; content: string }[],
  schedule: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gemini-proxy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "faq-chat",
        params: { messages: history, lang: "ka", session_id: conversationKey, channel, schedule },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => null) as { text?: unknown; code?: unknown } | null;
    if (!res.ok) {
      log("error", `auto-reply: gemini-proxy HTTP ${res.status} code=${String(data?.code ?? "-")}`);
      return null;
    }
    const text = typeof data?.text === "string" ? data.text : "";
    if (!text.trim()) {
      log("warn", "auto-reply: gemini-proxy returned empty text");
      return null;
    }
    return text;
  } catch (e) {
    log("error", `auto-reply: gemini-proxy call failed: ${scrubSecrets(e instanceof Error ? e.name : "error")}`);
    return null;
  }
}

function autoReplyDeps(admin: Admin): AutoReplyDeps {
  const warn = (what: string, error: { code?: string; message?: string } | null) => {
    if (error) log("warn", `auto-reply: ${what} failed (${error.code ?? "?"}): ${error.message ?? ""}`);
  };
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    tokenSet: META_PAGE_TOKEN.length > 0,
    loadSettings: async () => {
      const { data, error } = await admin.from("social_bot_settings").select("enabled, schedule, allow_keys").limit(1).maybeSingle();
      warn("settings read", error);
      return error || !data ? null : {
        enabled: data.enabled === true,
        schedule: String(data.schedule ?? ""),
        allowKeys: Array.isArray(data.allow_keys) ? (data.allow_keys as unknown[]).filter((k): k is string => typeof k === "string") : [],
      };
    },
    isHandedOff: async (key) => {
      const { data, error } = await admin.from("social_bot_handoffs").select("conversation_key").eq("conversation_key", key).maybeSingle();
      warn("handoff read", error);
      // Fail closed: if we cannot tell, treat the conversation as handed off.
      return error ? true : !!data;
    },
    insertHandoff: async (key, reason) => {
      const { error } = await admin
        .from("social_bot_handoffs")
        .upsert({ conversation_key: key, reason }, { onConflict: "conversation_key", ignoreDuplicates: true });
      warn("handoff insert", error);
    },
    loadThread: async (key, limit) => {
      const { data, error } = await admin
        .from("social_messages")
        .select("meta_message_id, direction, text, attachments, unsupported, sent_at")
        .eq("conversation_key", key)
        .order("sent_at", { ascending: false })
        .limit(limit);
      warn("thread read", error);
      return ((data ?? []) as ThreadRow[]).reverse();
    },
    loadOutRows: async (key, sinceIso) => {
      const { data, error } = await admin
        .from("social_messages")
        .select("meta_message_id, text, sent_at, attachments")
        .eq("conversation_key", key)
        .eq("direction", "out")
        .gte("sent_at", sinceIso)
        .limit(200);
      warn("outbound read", error);
      // Fail closed: an unreadable history counts as "a human is here".
      if (error) return [{ meta_message_id: "?", text: null, sent_at: new Date().toISOString() }];
      return (data ?? []) as OutRow[];
    },
    loadBotSends: async (key, sinceIso) => {
      const { data, error } = await admin
        .from("social_bot_replies")
        .select("meta_message_id, text, kind, created_at")
        .eq("conversation_key", key)
        .gte("created_at", sinceIso)
        .limit(200);
      warn("bot sends read", error);
      return (data ?? []) as BotSendRecord[];
    },
    recordSend: async (key, kind, text) => {
      // Redacted exactly like the echo's social_messages.text, so isBotEcho
      // can match the two by text.
      const { data, error } = await admin
        .from("social_bot_replies")
        .insert({ conversation_key: key, kind, text: redactPii(text) })
        .select("id")
        .maybeSingle();
      warn("send record", error);
      return (data as { id?: string } | null)?.id ?? null;
    },
    markSent: async (id, messageId) => {
      const { error } = await admin.from("social_bot_replies").update({ meta_message_id: messageId }).eq("id", id);
      warn("send record update", error);
    },
    askBot: (channel, key, history, schedule) => askBot(channel, key, history, schedule),
    send: graphSend,
    log,
    sketch: sketchDeps(admin),
  };
}

// ── sketch images ──────────────────────────────────────────────────────────

const SKETCH_BUCKET = "designs";
const MAX_SKETCH_INPUT_BYTES = 15 * 1024 * 1024;

async function fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      log("warn", `sketch: fetch ${new URL(url).host} HTTP ${res.status}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_SKETCH_INPUT_BYTES ? bytes : null;
  } catch (e) {
    log("warn", `sketch: fetch ${new URL(url).host} failed: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** gemini-proxy generate-design-gpt as the trusted social call; the PNG bytes. */
async function generateSketchDesign(
  channel: "messenger" | "instagram",
  conversationKey: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gemini-proxy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-design-gpt", params: { ...params, channel, session_id: conversationKey } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null) as { image?: unknown; code?: unknown } | null;
    if (!res.ok) {
      log("error", `sketch: generate-design-gpt HTTP ${res.status} code=${String(data?.code ?? "-")}`);
      return null;
    }
    const image = typeof data?.image === "string" ? data.image : "";
    const m = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(image);
    if (m) return base64ToBytes(m[1]);
    if (/^https:\/\//i.test(image)) return await fetchBytes(image, 20_000);
    log("error", "sketch: generate-design-gpt returned no image");
    return null;
  } catch (e) {
    log("error", `sketch: generate-design-gpt call failed: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

function sketchDeps(admin: Admin): SketchDeps {
  return {
    countSketches: async (key, sinceIso) => {
      const { data, error } = await admin
        .from("social_bot_replies")
        .select("text")
        .eq("conversation_key", key)
        .eq("kind", "sketch")
        .gte("created_at", sinceIso)
        .limit(200);
      if (error) {
        log("warn", `sketch: count read failed (${error.code ?? "?"}): ${error.message ?? ""}`);
        return null;
      }
      return countSketchRows((data ?? []) as { text: string | null }[]);
    },
    generateDesign: generateSketchDesign,
    fetchImage: fetchBytes,
    loadFont: () =>
      loadSketchFont({
        fetchBytes: (url) => fetchBytes(url, 15_000),
        parse: (buf) => opentype.parse(buf) as unknown as FontLike,
        log,
      }),
    decodeJpeg: (bytes) => {
      // 24 MP = sketchFlow.PHOTO_MAX_PIXELS (customer photos; product photos are ~1 MP).
      const d = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 128, maxResolutionInMP: 24 });
      return { width: d.width, height: d.height, data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength) };
    },
    encodeJpeg: (img: RgbaImage, quality) => {
      const out = jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality);
      return new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength);
    },
    upload: async (path, bytes) => {
      const bucket = admin.storage.from(SKETCH_BUCKET);
      const { error } = await bucket.upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (error) {
        log("warn", `sketch: upload failed: ${error.message}`);
        return null;
      }
      return bucket.getPublicUrl(path).data.publicUrl ?? null;
    },
    hashKey: (key) => sha256Hex(key),
    sendImage: graphSendImage,
    // Generated designs by params hash (sketchFlow.designCacheKey), same bucket.
    cacheGet: async (k) => {
      const { data, error } = await admin.storage.from(SKETCH_BUCKET).download(`social-sketches/cache/${k}.png`);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    cachePut: async (k, png) => {
      const { error } = await admin.storage.from(SKETCH_BUCKET)
        .upload(`social-sketches/cache/${k}.png`, png, { contentType: "image/png", upsert: true });
      if (error) log("warn", `sketch: cache put failed: ${error.message}`);
    },
    // The customer's own photo, from the PRIVATE bucket with the service role —
    // never a public or signed URL. The path is not logged.
    downloadUpload: async (path: string): Promise<Uint8Array | null> => {
      try {
        const { data, error } = await admin.storage.from(SOCIAL_UPLOAD_BUCKET).download(path);
        if (error || !data) {
          log("warn", "sketch: customer photo download failed");
          return null;
        }
        const bytes = new Uint8Array(await data.arrayBuffer());
        return bytes.length > 0 && bytes.length <= MAX_SKETCH_INPUT_BYTES ? bytes : null;
      } catch (e) {
        log("warn", `sketch: customer photo download failed: ${e instanceof Error ? e.name : "error"}`);
        return null;
      }
    },
  };
}

// ── ad referrals ───────────────────────────────────────────────────────────
//
// Which ad / m.me / ig.me link opened a conversation → social_ad_referrals.
// ON CONFLICT (conversation_key, ad_id_key, occurred_at) DO NOTHING, so a Meta
// retry is a no-op (conversation_key and ad_id_key are generated columns).
// Best-effort: an error is logged and the delivery still gets its normal answer.
// Standalone referral events only arrive if the Page is also subscribed to
// `messaging_referrals` (Messenger; CTM ad + first message needs it too) and,
// for Instagram ig.me links, `messaging_referral`. Postback referrals need
// `messaging_postbacks`.
async function storeReferrals(rows: SocialAdReferralRow[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    log("warn", "referrals not stored: service role not configured");
    return;
  }
  const { error } = await makeAdmin()
    .from("social_ad_referrals")
    .upsert(rows, { onConflict: "conversation_key,ad_id_key,occurred_at", ignoreDuplicates: true });
  if (error) log("warn", `referral insert failed (ignored, ${error.code ?? "?"}): ${error.message}`);
}

serve((req) =>
  handleMetaWebhook(req, {
    appSecret: META_APP_SECRET,
    verifyToken: META_VERIFY_TOKEN,
    store,
    storeReferrals,
  })
);
