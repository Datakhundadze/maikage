-- Social DM auto-reply bot (Messenger + Instagram) — kill switch, handoffs, send log.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- WHAT. The meta-webhook edge function can now answer a customer's DM with the
-- site's faq-chat bot while no operator works (schedule 'sunday' = Sunday all
-- day, Asia/Tbilisi). It is OFF until an admin flips social_bot_settings.enabled.
--
--   social_bot_settings  single row (id is always true). enabled = kill switch,
--                        schedule = 'sunday' | 'off_hours'.
--   social_bot_handoffs  one row per conversation where the customer asked for
--                        a human („ოპერატორი"). The bot never answers that
--                        conversation again; delete the row to give it back.
--   social_bot_replies   every message the bot sent (text redacted the same way
--                        as social_messages.text, plus Meta's message id once the
--                        Send API returns it). This is how the webhook tells the
--                        bot's own echoes apart from an operator's reply, for
--                        BOTH channels: Messenger echoes carry the Send API
--                        `metadata` marker back, but Instagram's are not
--                        documented to. The bot's messages themselves are stored
--                        in social_messages by the normal echo path, exactly once.
--
-- WHO CAN TOUCH IT:
--   - the edge function's SERVICE ROLE bypasses RLS (reads + writes).
--   - admins: read + write settings and handoffs; read the send log.
--   - anon / authenticated non-admins: no policy matches → deny-all.

-- ── settings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_bot_settings (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled    boolean NOT NULL DEFAULT false,
  schedule   text    NOT NULL DEFAULT 'sunday' CHECK (schedule IN ('sunday', 'off_hours')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.social_bot_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.social_bot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read social_bot_settings" ON public.social_bot_settings;
CREATE POLICY "Admins can read social_bot_settings"
  ON public.social_bot_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update social_bot_settings" ON public.social_bot_settings;
CREATE POLICY "Admins can update social_bot_settings"
  ON public.social_bot_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── handoffs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_bot_handoffs (
  conversation_key text PRIMARY KEY,
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_bot_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage social_bot_handoffs" ON public.social_bot_handoffs;
CREATE POLICY "Admins can manage social_bot_handoffs"
  ON public.social_bot_handoffs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── send log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_bot_replies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('reply', 'handoff', 'photo')),
  text             text,
  meta_message_id  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_bot_replies_conversation_time
  ON public.social_bot_replies (conversation_key, created_at DESC);

ALTER TABLE public.social_bot_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read social_bot_replies" ON public.social_bot_replies;
CREATE POLICY "Admins can read social_bot_replies"
  ON public.social_bot_replies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';

-- TURN ON / OFF:
--   UPDATE public.social_bot_settings SET enabled = true,  updated_at = now();
--   UPDATE public.social_bot_settings SET enabled = false, updated_at = now();
-- Give a handed-off conversation back to the bot:
--   DELETE FROM public.social_bot_handoffs WHERE conversation_key = '<key>';
--
-- VERIFY (run in the SQL Editor as owner):
--
--   -- 1. three tables, RLS on
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('social_bot_settings', 'social_bot_handoffs', 'social_bot_replies');
--   -- expect 3 rows, relrowsecurity = true
--
--   -- 2. policies
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('social_bot_settings', 'social_bot_handoffs', 'social_bot_replies')
--   ORDER BY tablename, policyname;
--   -- expect: settings SELECT + UPDATE, handoffs ALL, replies SELECT
--
--   -- 3. the single settings row, OFF
--   SELECT * FROM public.social_bot_settings;
--   -- expect: id=true, enabled=false, schedule='sunday'
--
--   -- 4. after a test Sunday: what the bot sent, and who asked for a human
--   SELECT conversation_key, kind, left(text, 80), meta_message_id, created_at
--   FROM public.social_bot_replies ORDER BY created_at DESC LIMIT 30;
--   SELECT * FROM public.social_bot_handoffs ORDER BY created_at DESC;
