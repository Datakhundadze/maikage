-- Site assistant chat ratings (1–5 stars + optional comment) — one per session.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Idempotent: safe to re-run.
--
-- WHO WRITES. The customer's browser (anon or signed-in), via the ChatRating
-- row under the assistant's reply in ChatWidget and /chat — but ONLY through
-- the SECURITY DEFINER RPC public.submit_chat_rating() below. The table itself
-- has NO insert/update/delete for anon or authenticated (privileges revoked,
-- no write policies), exactly like chat_logs. No edge function is involved, so
-- nothing needs redeploying.
--
-- SPAM GUARD (adopted from the earlier RPC design). The RPC accepts a rating
-- only for a session that really exists in public.chat_logs with at least two
-- rows where role = 'assistant' — the exact value gemini-proxy writes
-- (supabase/functions/gemini-proxy/index.ts: rows.push({ …, role: "assistant" })).
-- A made-up session id raises 'invalid session'; real sessions can only be
-- created by chatting, which gemini-proxy rate-limits. The client treats that
-- error like any other failure: silent, and the session is still marked done.
--
-- ONE RATING PER SESSION. unique(session_id) + INSERT … ON CONFLICT
-- (session_id) DO NOTHING: a second rating for the same session is silently
-- ignored. created_at is always now() and user_id is always auth.uid() (null
-- for guests) — neither is caller-controlled.
--
-- Admins read via the has_role(admin) SELECT policy (ჩატის ისტორია tab).

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  text NOT NULL CHECK (char_length(session_id) BETWEEN 1 AND 200),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text CHECK (comment IS NULL OR char_length(comment) <= 300),
  lang        text CHECK (lang IS NULL OR char_length(lang) <= 10),
  page        text CHECK (page IS NULL OR char_length(page) <= 300),
  user_id     uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_ratings_session_id_key UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_ratings_created_at ON public.chat_ratings (created_at DESC);

-- 2. Privileges --------------------------------------------------------------
-- Supabase grants ALL on new public tables to anon/authenticated by default;
-- take it all back. Only admins (authenticated + RLS) may SELECT.
REVOKE ALL ON public.chat_ratings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_ratings TO authenticated;   -- gated to admins by RLS

-- 3. Row level security ------------------------------------------------------
ALTER TABLE public.chat_ratings ENABLE ROW LEVEL SECURITY;

-- No direct writes for anyone but the RPC (owner) / service role.
DROP POLICY IF EXISTS "Anyone can submit a chat rating" ON public.chat_ratings;

DROP POLICY IF EXISTS "Admins can read chat ratings" ON public.chat_ratings;
CREATE POLICY "Admins can read chat ratings" ON public.chat_ratings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- intentionally NO INSERT, UPDATE or DELETE policy.

-- 4. The only write path -----------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_chat_rating(text, int, text, text, text);
CREATE FUNCTION public.submit_chat_rating(
  p_session_id text,
  p_rating     int,
  p_comment    text,
  p_lang       text,
  p_page       text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_lang    text := nullif(btrim(coalesce(p_lang, '')), '');
  v_page    text := nullif(btrim(coalesce(p_page, '')), '');
BEGIN
  IF p_session_id IS NULL OR char_length(p_session_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid session';
  END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid rating';
  END IF;
  IF v_comment IS NOT NULL AND char_length(v_comment) > 300 THEN
    RAISE EXCEPTION 'invalid comment';
  END IF;
  IF v_lang IS NOT NULL AND char_length(v_lang) > 10 THEN
    RAISE EXCEPTION 'invalid lang';
  END IF;
  IF v_page IS NOT NULL AND char_length(v_page) > 300 THEN
    RAISE EXCEPTION 'invalid page';
  END IF;

  -- Spam guard: the session must be a real conversation with ≥2 bot replies.
  IF (
    SELECT count(*) FROM public.chat_logs c
    WHERE c.session_id = p_session_id AND c.role = 'assistant'
  ) < 2 THEN
    RAISE EXCEPTION 'invalid session';
  END IF;

  INSERT INTO public.chat_ratings (session_id, rating, comment, lang, page, user_id, created_at)
  VALUES (p_session_id, p_rating::smallint, v_comment, v_lang, v_page, auth.uid(), now())
  ON CONFLICT (session_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_chat_rating(text, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_chat_rating(text, int, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--
--   -- 1. RLS on:
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname = 'chat_ratings' AND relnamespace = 'public'::regnamespace;   -- true
--
--   -- 2. exactly ONE policy: the admin SELECT
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_ratings';
--   -- expect 1 row: "Admins can read chat ratings" | SELECT | {authenticated}
--
--   -- 3. columns + constraints:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'chat_ratings'
--   ORDER BY ordinal_position;                                  -- expect 8 rows
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.chat_ratings'::regclass;           -- pkey, unique, 5 checks
--
--   -- 4. table privileges: anon none, authenticated SELECT only
--   SELECT has_table_privilege('anon', 'public.chat_ratings', 'INSERT')          AS anon_ins,  -- false
--          has_table_privilege('anon', 'public.chat_ratings', 'SELECT')          AS anon_sel,  -- false
--          has_table_privilege('authenticated', 'public.chat_ratings', 'INSERT') AS auth_ins,  -- false
--          has_table_privilege('authenticated', 'public.chat_ratings', 'SELECT') AS auth_sel;  -- true
--
--   -- 5. the RPC: SECURITY DEFINER, pinned search_path, executable by anon:
--   SELECT p.proname, p.prosecdef AS security_definer, p.proconfig,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,     -- true
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec    -- true
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'submit_chat_rating';
--   -- expect: security_definer = true, proconfig = {"search_path=public, pg_temp"}
--
--   -- 6. anon behaviour (each block rolls back, nothing is kept):
--   BEGIN;
--     SET LOCAL ROLE anon;
--     INSERT INTO public.chat_ratings (session_id, rating) VALUES ('verify-direct', 5);
--     -- expect ERROR: permission denied for table chat_ratings
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     SELECT public.submit_chat_rating('verify-fake-session', 5, NULL, 'ge', '/chat');
--     -- expect ERROR: invalid session
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     SELECT public.submit_chat_rating('verify-fake-session', 6, NULL, 'ge', '/chat');
--     -- expect ERROR: invalid rating
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     SELECT * FROM public.chat_ratings;
--     -- expect ERROR: permission denied for table chat_ratings
--   ROLLBACK;
--
--   -- 7. happy path on a REAL session (as owner, rolled back): pick one with ≥2 replies
--   BEGIN;
--     SELECT session_id FROM public.chat_logs WHERE role = 'assistant'
--     GROUP BY session_id HAVING count(*) >= 2 ORDER BY max(created_at) DESC LIMIT 1;
--     -- then, with that id:
--     SET LOCAL ROLE anon;
--     SELECT public.submit_chat_rating('<that id>', 4, '  ტესტი  ', 'ge', '/chat');   -- ok
--     SELECT public.submit_chat_rating('<that id>', 1, NULL, 'ge', '/chat');         -- ok, ignored
--     RESET ROLE;
--     SELECT session_id, rating, comment, user_id, created_at
--     FROM public.chat_ratings WHERE session_id = '<that id>';
--     -- expect ONE row: rating 4, comment 'ტესტი', user_id NULL
--   ROLLBACK;
--
--   -- 8. after a real rating on the site:
--   SELECT created_at, session_id, rating, left(comment, 60) AS comment, lang, page,
--          user_id IS NOT NULL AS signed_in
--   FROM public.chat_ratings ORDER BY created_at DESC LIMIT 20;
