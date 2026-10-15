-- Callback requests from the FAQ chat (§9d of FAQ_KB, gemini-proxy).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- gemini-proxy (callbackRequest.ts) inserts one row when a customer asks to be
-- called and their own chat message carries a phone number, then e-mails
-- maika@maika.ge. Admins work the list in the "დარეკვის მოთხოვნები" tab.
--
-- `phone` is the ONLY place the raw number is stored: chat_logs keeps the
-- masked "[phone:***NN]" form and the "[ზარის მოთხოვნა]" marker, and `note`
-- below is masked the same way.
--
-- RLS: on. Admins may SELECT and UPDATE (status, handled_*). There is NO
-- INSERT and NO DELETE policy — only the service role (gemini-proxy) writes,
-- and only the purge job below deletes.

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.callback_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  phone          text NOT NULL,                 -- E.164, e.g. +995577123456
  session_id     text,                          -- chat_logs.session_id
  user_id        uuid,                          -- null for guests
  lang           text,
  note           text,                          -- last customer message, PII-masked
  status         text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'called', 'no_answer', 'done')),
  handled_at     timestamptz,
  handled_by     uuid,
  email_sent_at  timestamptz,
  email_error    text
);

CREATE INDEX IF NOT EXISTS idx_callback_requests_created_at ON public.callback_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_callback_requests_phone_time ON public.callback_requests (phone, created_at DESC);

-- 2. Row level security -----------------------------------------------------
ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;

-- Nothing for anon at all, even before RLS is considered.
REVOKE ALL ON public.callback_requests FROM anon;

DROP POLICY IF EXISTS "Admins can read callback_requests" ON public.callback_requests;
CREATE POLICY "Admins can read callback_requests"
  ON public.callback_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update callback_requests" ON public.callback_requests;
CREATE POLICY "Admins can update callback_requests"
  ON public.callback_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- intentionally NO INSERT and NO DELETE policy.

-- 3. Retention: delete rows older than 90 days, daily at 03:17 UTC ------------
-- pg_cron is already installed (20260316101830_email_infra.sql). Unschedule
-- first so re-running this file never creates a second job.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-callback-requests';
SELECT cron.schedule(
  'purge-callback-requests',
  '17 3 * * *',
  $$DELETE FROM public.callback_requests WHERE created_at < now() - interval '90 days'$$
);

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--
--   -- RLS on:
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname = 'callback_requests' AND relnamespace = 'public'::regnamespace;   -- true
--
--   -- exactly two policies, SELECT and UPDATE, both for authenticated:
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'callback_requests'
--   ORDER BY policyname;
--   -- expect: "Admins can read callback_requests"   | SELECT | {authenticated}
--   --         "Admins can update callback_requests" | UPDATE | {authenticated}
--
--   -- columns:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'callback_requests'
--   ORDER BY ordinal_position;
--   -- expect 12 rows: id … email_error; phone NOT NULL; status default 'new'
--
--   -- status check:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.callback_requests'::regclass AND contype = 'c';
--
--   -- anon has no privileges:
--   SELECT has_table_privilege('anon', 'public.callback_requests', 'SELECT');   -- false
--
--   -- purge job, exactly one:
--   SELECT jobid, jobname, schedule, command, active
--   FROM cron.job WHERE jobname = 'purge-callback-requests';
