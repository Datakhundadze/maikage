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
// No META_PAGE_TOKEN in phase 1: this function makes no outbound calls.
// Their values are never logged.
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
import { handleMetaWebhook, type SocialMessageRow, type StoreResult } from "./handler.ts";

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
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const table = () => admin.from("social_messages");

  const batch = await table()
    .upsert(rows, { onConflict: "meta_message_id", ignoreDuplicates: true })
    .select("meta_message_id");
  if (!batch.error) return { inserted: batch.data?.length ?? 0, error: null };

  console.warn(`[meta-webhook] batch insert failed (${batch.error.code ?? "?"}), retrying row by row: ${batch.error.message}`);
  let inserted = 0;
  const failures: string[] = [];
  for (const row of rows) {
    const one = await table()
      .upsert(row, { onConflict: "meta_message_id", ignoreDuplicates: true })
      .select("meta_message_id");
    if (one.error) failures.push(`${row.meta_message_id}: ${one.error.message}`);
    else inserted += one.data?.length ?? 0;
  }
  if (failures.length > 0) {
    console.error(`[meta-webhook] ${failures.length} row(s) could not be stored: ${failures.join(" | ")}`);
    return { inserted, error: `${failures.length} row(s) failed` };
  }
  return { inserted, error: null };
}

serve((req) =>
  handleMetaWebhook(req, {
    appSecret: META_APP_SECRET,
    verifyToken: META_VERIFY_TOKEN,
    store,
  })
);
