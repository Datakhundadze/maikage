-- Which ad (or m.me / ig.me link) opened a Messenger / Instagram conversation.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- WHY. maika.ge runs click-to-message ads. social_messages mirrors every DM
-- but not which ad started the thread, so conversations (and later orders)
-- cannot be attributed to an ad. The meta-webhook edge function now also
-- writes every referral it sees here (referrals.ts). Add-only: social_messages
-- is untouched.
--
-- SHAPE (from the webhook's referral object):
--   channel / page_id / customer_id   derived exactly like social_messages
--   conversation_key  GENERATED channel:page_id:customer_id — same expression
--                     as social_messages.conversation_key, so they always join
--   ad_id, source ('ADS' | 'SHORTLINK' | ig.me source …), type ('OPEN_THREAD'),
--   ref               the ref code set in the ad / link, verbatim
--   ad_title          ads_context_data.ad_title (through redactPii)
--   raw               the referral object, sanitised (no token-like keys,
--                     referer_uri without query string)
--   occurred_at       messaging[].timestamp
--   ad_id_key         GENERATED coalesce(ad_id, '') — makes the unique key
--                     NULL-safe for ref-only referrals (a plain NULL ad_id
--                     would never conflict, so retries would duplicate)
--
-- DEDUPE. UNIQUE (conversation_key, ad_id_key, occurred_at); the writer
-- upserts with ignoreDuplicates (ON CONFLICT DO NOTHING), so Meta's retries
-- of the same delivery never add a row.
--
-- WHO CAN TOUCH IT (same as social_messages):
--   - write: the edge function's SERVICE ROLE only (bypasses RLS). No insert
--     / update / delete policy exists.
--   - read: admins only, via the SELECT policy below.
--   - anon / authenticated non-admins: no policy matches → deny-all.

CREATE TABLE IF NOT EXISTS public.social_ad_referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL CHECK (channel IN ('messenger', 'instagram')),
  page_id          text NOT NULL,
  customer_id      text NOT NULL,
  conversation_key text GENERATED ALWAYS AS (channel || ':' || page_id || ':' || customer_id) STORED,
  ad_id            text,
  ad_id_key        text GENERATED ALWAYS AS (coalesce(ad_id, '')) STORED,
  source           text,
  type             text,
  ref              text,
  ad_title         text,
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_ad_referrals_conv_ad_time
  ON public.social_ad_referrals (conversation_key, ad_id_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_social_ad_referrals_ad_id
  ON public.social_ad_referrals (ad_id);
CREATE INDEX IF NOT EXISTS idx_social_ad_referrals_conversation_key
  ON public.social_ad_referrals (conversation_key);

ALTER TABLE public.social_ad_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read social_ad_referrals" ON public.social_ad_referrals;
CREATE POLICY "Admins can read social_ad_referrals"
  ON public.social_ad_referrals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--
--   -- 1. columns (expect 14: id, channel, page_id, customer_id,
--   --    conversation_key, ad_id, ad_id_key, source, type, ref, ad_title,
--   --    raw, occurred_at, created_at; conversation_key + ad_id_key generated)
--   SELECT column_name, data_type, is_nullable, is_generated
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='social_ad_referrals'
--   ORDER BY ordinal_position;
--
--   -- 2. RLS on, exactly one policy, SELECT only
--   SELECT c.relrowsecurity AS rls_enabled,
--          (SELECT string_agg(policyname || ':' || cmd, ', ') FROM pg_policies
--           WHERE schemaname='public' AND tablename='social_ad_referrals') AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   WHERE n.nspname='public' AND c.relname='social_ad_referrals';
--   -- expect: true | "Admins can read social_ad_referrals:SELECT"
--
--   -- 3. indexes (expect pkey + uq_social_ad_referrals_conv_ad_time +
--   --    idx_social_ad_referrals_ad_id + idx_social_ad_referrals_conversation_key)
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND tablename='social_ad_referrals';
--
--   -- 4. AFTER the function is redeployed and an ad is clicked: which ads
--   --    opened which conversations
--   SELECT r.ad_id, r.ad_title, r.source, r.ref, r.conversation_key, r.occurred_at,
--          (SELECT count(*) FROM public.social_messages m
--           WHERE m.conversation_key = r.conversation_key) AS messages
--   FROM public.social_ad_referrals r
--   ORDER BY r.occurred_at DESC
--   LIMIT 20;
