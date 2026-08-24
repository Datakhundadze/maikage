-- Per-call cost record for every gateway call gemini-proxy makes.
--
-- WHY. `generations` only ever recorded generate-design. edit-image, restyle,
-- upscale, isolate-subject and virtual-tryon are all paid model calls — two of
-- them on the PRO tier, which costs roughly twice flash — and none of them left
-- any trace. There was no way to answer "what are we actually spending it on"
-- before deciding what to optimise. This is that answer, and nothing more.
--
-- WHAT IS NOT HERE, DELIBERATELY: no prompt, no instruction text, no image, no
-- IP, no email. Action and model only. A cost record is not a transcript;
-- chat_logs is where conversation lives, under its own rules and its own
-- redaction. Nothing written here needs redacting because nothing the customer
-- typed reaches it.
--
-- WHO CAN TOUCH IT:
--   - write: the edge function's SERVICE ROLE only, which bypasses RLS. There
--     is deliberately NO insert policy, so the browser cannot write here at
--     all — the numbers cannot be forged from a client.
--   - read: admins only, via the SELECT policy below (modelled on the
--     chat-uploads one).
--   - anon/authenticated non-admins: no policy matches, so deny-all.

-- 1. The table. Every column except id/created_at/action/model/is_guest is
--    nullable: an action that passes through neither auth gate (convert-bg-black,
--    the internal second half of a generate-design) has no user and no session,
--    and recording that honestly is better than inventing one.
CREATE TABLE IF NOT EXISTS public.ai_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  action      text NOT NULL,
  model       text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id  text,
  is_guest    boolean NOT NULL DEFAULT true,
  success     boolean NOT NULL,
  duration_ms integer,
  error_code  text
);

-- 2. RLS on with NO permissive policy = deny-all, exactly like chat_logs.
--    The service role bypasses RLS, so the edge function still writes.
ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;

-- 3. Admin read. Without this the table is write-only and the whole point —
--    looking at the numbers — needs the SQL editor. Same has_role gate as
--    every other admin surface.
DROP POLICY IF EXISTS "Admins can read ai_calls" ON public.ai_calls;
CREATE POLICY "Admins can read ai_calls"
  ON public.ai_calls FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. The two reads this table exists for: "what did today cost, by action" and
--    "what is failing". Both scan by time, so one index on created_at carries
--    them; action/model are low-cardinality and filter fine after it.
CREATE INDEX IF NOT EXISTS ai_calls_created_at_idx ON public.ai_calls (created_at DESC);

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner) — all four should hold:
--
--   -- 1. table exists with the expected columns
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='ai_calls'
--   ORDER BY ordinal_position;
--   -- expect: id, created_at, action, model, user_id, session_id, is_guest,
--   --         success, duration_ms, error_code
--
--   -- 2. RLS is ON and exactly one policy exists, SELECT only
--   SELECT c.relrowsecurity AS rls_enabled,
--          (SELECT count(*) FROM pg_policies
--           WHERE schemaname='public' AND tablename='ai_calls') AS policy_count,
--          (SELECT string_agg(policyname || ':' || cmd, ', ') FROM pg_policies
--           WHERE schemaname='public' AND tablename='ai_calls') AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   WHERE n.nspname='public' AND c.relname='ai_calls';
--   -- expect: rls_enabled=true, policy_count=1, "Admins can read ai_calls:SELECT"
--
--   -- 3. the index landed
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='ai_calls';
--   -- expect: ai_calls_pkey and ai_calls_created_at_idx
--
--   -- 4. AFTER the function is redeployed and one generation has run —
--   --    this is the query the table exists for
--   SELECT action, model, count(*) AS calls,
--          count(*) FILTER (WHERE NOT success) AS failed,
--          round(avg(duration_ms)) AS avg_ms
--   FROM public.ai_calls
--   WHERE created_at > now() - interval '24 hours'
--   GROUP BY action, model
--   ORDER BY calls DESC;
--   -- expect at least one row; zero rows means the function was not redeployed
--   --   (a GitHub merge does NOT deploy edge functions) or the service-role
--   --   key is missing from the function's environment.
