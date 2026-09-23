-- Read-only mirror of Facebook Messenger + Instagram DM conversations (phase 1).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- WHY. 60–70% of orders start in a social DM and every one is answered by
-- hand. Nothing recorded them. The meta-webhook edge function now writes every
-- inbound customer message AND every outbound operator reply (Meta delivers
-- the page's own messages back as `is_echo` events) into this table, so
-- conversations can be analysed with SQL exactly like chat_logs. Phase 1 is a
-- MIRROR: nothing is sent to Meta, no bot, no Graph API calls.
--
-- SHAPE follows the webhook payload (entry[].messaging[]), not a guess:
--   channel           'messenger' (object "page") | 'instagram' (object "instagram")
--   page_id           entry[].id — our Page id / IG professional account id
--   customer_id       the PSID / IGSID on the other end of the thread. For an
--                     inbound message that is sender.id; for an echo it is
--                     recipient.id. Ids ONLY — no names, no profiles. Resolving
--                     a PSID to a name needs a Page token and a Graph call,
--                     which phase 1 does not make.
--   conversation_key  channel:page_id:customer_id — the stable thread key.
--                     Generated, so it can never disagree with its parts.
--   meta_message_id   message.mid. UNIQUE: Meta retries deliveries and can
--                     send the same event more than once; the writer inserts
--                     with ON CONFLICT DO NOTHING so a retry never duplicates.
--   sender_id         sender.id as delivered (customer for 'in', page for 'out')
--   direction         'in' = customer → page, 'out' = page/operator → customer
--   text              message.text, passed through redactPii before insert
--                     (same masking as chat_logs: phones and emails)
--   attachments       [{type, url}] from message.attachments[]. ⚠️ Meta's
--                     attachment URLs are TEMPORARY and expire (hours to days).
--                     Type and url are stored anyway so the record shows WHAT
--                     was sent; the url will go dead. Nothing is downloaded
--                     into storage in phase 1 — that is a separate decision
--                     about cost and PII.
--   unsupported       true for an Instagram `is_unsupported` message (a
--                     content type the webhook cannot deliver): the row keeps
--                     the timing of the turn with no text and no attachments.
--   sent_at           messaging[].timestamp (Meta's epoch-ms), the time the
--                     message was sent, as opposed to created_at = when we
--                     recorded it.
--
-- WHO CAN TOUCH IT (mirrors ai_calls):
--   - write: the edge function's SERVICE ROLE only, which bypasses RLS. There
--     is deliberately NO insert policy, so no client can write here.
--   - read: admins only, via the SELECT policy below.
--   - anon / authenticated non-admins: no policy matches, so deny-all.
--
-- RETENTION: none, like chat_logs. See the branch summary for the trade-off.

CREATE TABLE IF NOT EXISTS public.social_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL CHECK (channel IN ('messenger', 'instagram')),
  page_id          text NOT NULL,
  customer_id      text NOT NULL,
  conversation_key text GENERATED ALWAYS AS (channel || ':' || page_id || ':' || customer_id) STORED,
  meta_message_id  text NOT NULL UNIQUE,
  sender_id        text NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  text             text,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  unsupported      boolean NOT NULL DEFAULT false,
  sent_at          timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The two reads this exists for: "show me this conversation in order" and
-- "what came in today".
CREATE INDEX IF NOT EXISTS idx_social_messages_conversation_time
  ON public.social_messages (conversation_key, sent_at);
CREATE INDEX IF NOT EXISTS idx_social_messages_created_at
  ON public.social_messages (created_at DESC);

-- RLS on. The only policy is admin SELECT; everything else is denied. The
-- service-role writer bypasses RLS.
ALTER TABLE public.social_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read social_messages" ON public.social_messages;
CREATE POLICY "Admins can read social_messages"
  ON public.social_messages FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner) — all five should hold:
--
--   -- 1. table exists with the expected columns
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='social_messages'
--   ORDER BY ordinal_position;
--   -- expect: id, channel, page_id, customer_id, conversation_key,
--   --         meta_message_id, sender_id, direction, text, attachments,
--   --         unsupported, sent_at, created_at
--
--   -- 2. RLS is ON and exactly one policy exists, SELECT only
--   SELECT c.relrowsecurity AS rls_enabled,
--          (SELECT count(*) FROM pg_policies
--           WHERE schemaname='public' AND tablename='social_messages') AS policy_count,
--          (SELECT string_agg(policyname || ':' || cmd, ', ') FROM pg_policies
--           WHERE schemaname='public' AND tablename='social_messages') AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   WHERE n.nspname='public' AND c.relname='social_messages';
--   -- expect: rls_enabled=true, policy_count=1, "Admins can read social_messages:SELECT"
--
--   -- 3. the UNIQUE constraint on meta_message_id is there (this is what makes
--   --    a Meta retry a no-op)
--   SELECT conname, contype FROM pg_constraint
--   WHERE conrelid='public.social_messages'::regclass AND contype='u';
--   -- expect one row, on (meta_message_id)
--
--   -- 4. both indexes landed
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='social_messages';
--   -- expect: social_messages_pkey, social_messages_meta_message_id_key,
--   --         idx_social_messages_conversation_time, idx_social_messages_created_at
--
--   -- 5. AFTER the function is deployed and the webhook is subscribed — the
--   --    query this table exists for
--   SELECT conversation_key, direction, left(text, 80) AS text, attachments, sent_at
--   FROM public.social_messages
--   ORDER BY sent_at DESC
--   LIMIT 20;
--   -- zero rows means the function is not deployed, the webhook is not
--   -- subscribed to `messages` + `message_echoes`, or the signature check is
--   -- rejecting deliveries (check the function logs for "bad signature").
