-- Customer feedback (mirrors the corporate_inquiries pattern).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. No proxy/edge involved: customers
-- INSERT directly (anon or signed-in), admins SELECT + flag handled. RLS
-- mirrors public.corporate_inquiries (anyone-insert / admin-read / admin-update)
-- with an added char_length bound on the message to curb abuse.

CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text NOT NULL,
  email       text,
  page        text,
  user_id     uuid,
  handled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback (created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Anyone (anon or authenticated) may submit. The WITH CHECK bounds the message
-- length (1–2000 chars) at the DB level so a bypassed client can't dump junk.
-- There is NO public SELECT — submissions are write-only for customers.
DROP POLICY IF EXISTS "Anyone can submit feedback" ON public.feedback;
CREATE POLICY "Anyone can submit feedback" ON public.feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(message) BETWEEN 1 AND 2000);

-- Admins read all feedback.
DROP POLICY IF EXISTS "Admins can read feedback" ON public.feedback;
CREATE POLICY "Admins can read feedback" ON public.feedback
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Admins can flag a row handled (the seen/done toggle in the admin tab).
DROP POLICY IF EXISTS "Admins can update feedback" ON public.feedback;
CREATE POLICY "Admins can update feedback" ON public.feedback
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--   -- table exists with RLS enabled:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'feedback' AND relnamespace = 'public'::regnamespace;
--   -- expect: relrowsecurity = true
--
--   -- policy count (expect 3: submit / read / update):
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'feedback';   -- expect 3
--
--   -- confirm there is NO public/anon SELECT policy:
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'feedback' AND cmd = 'SELECT';
--   -- expect: one row, roles = {authenticated} (the admin has_role policy)
