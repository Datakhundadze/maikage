-- 1–5 star rating of the site AI chat (ChatWidget and /chat).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- WHY A NEW TABLE AND NOT public.feedback. feedback has no score and no
-- session_id, and its anon INSERT policy checks only the message length, so a
-- rating there could not be tied to one conversation or limited to one per
-- conversation.
--
-- WHY AN RPC AND NOT AN anon INSERT POLICY. The table is DENY-ALL (RLS on, no
-- INSERT policy), exactly like chat_logs. Customers write only through
-- submit_chat_rating(), a SECURITY DEFINER function that:
--   1. accepts a rating only for a session that really exists in chat_logs
--      with at least two assistant replies — a made-up session id is refused,
--      so ratings cannot be sprayed without first holding real conversations,
--      and those are rate-limited by gemini-proxy;
--   2. keeps ONE rating per session (session_id is the primary key; the first
--      one wins, a repeat is ignored);
--   3. bounds the rating to 1–5 and the comment to 500 characters.
-- The session id is a random UUID generated in the customer's own browser and
-- never shown to anyone else, so in practice only that customer can rate it.
--
-- No edge function is involved, so nothing needs a redeploy.

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_ratings (
  session_id  text PRIMARY KEY,              -- chat_logs.session_id
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text CHECK (comment IS NULL OR char_length(comment) <= 500),
  lang        text,
  user_id     uuid,                          -- auth.uid() at submit time; null for guests
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_ratings_created_at ON public.chat_ratings (created_at DESC);

-- 2. Row level security -----------------------------------------------------
ALTER TABLE public.chat_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_ratings FROM anon;

-- Admins read (the "ჩატის ისტორია" tab). Nobody writes directly.
DROP POLICY IF EXISTS "Admins can read chat_ratings" ON public.chat_ratings;
CREATE POLICY "Admins can read chat_ratings"
  ON public.chat_ratings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
-- intentionally NO INSERT / UPDATE / DELETE policy.

-- 3. The only write path -----------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_chat_rating(text, int, text, text);
CREATE FUNCTION public.submit_chat_rating(
  p_session_id text,
  p_rating     int,
  p_comment    text,
  p_lang       text
)
RETURNS text            -- 'ok' | 'duplicate' | 'no_session' | 'invalid'
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comment text;
  v_replies int;
  v_inserted int;
BEGIN
  IF p_session_id IS NULL OR char_length(p_session_id) NOT BETWEEN 8 AND 100
     OR p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RETURN 'invalid';
  END IF;

  v_comment := nullif(btrim(left(coalesce(p_comment, ''), 500)), '');

  SELECT count(*) INTO v_replies
  FROM public.chat_logs
  WHERE session_id = p_session_id AND role = 'assistant';

  IF v_replies < 2 THEN
    RETURN 'no_session';
  END IF;

  INSERT INTO public.chat_ratings (session_id, rating, comment, lang, user_id)
  VALUES (p_session_id, p_rating::smallint, v_comment, left(p_lang, 5), auth.uid())
  ON CONFLICT (session_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN CASE WHEN v_inserted = 1 THEN 'ok' ELSE 'duplicate' END;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_chat_rating(text, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_chat_rating(text, int, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--
--   -- 1. table with RLS on, exactly one policy (admin SELECT)
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname = 'chat_ratings' AND relnamespace = 'public'::regnamespace;   -- true
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'chat_ratings';
--   -- expect 1 row: Admins can read chat_ratings | SELECT | {authenticated}
--
--   -- 2. the RPC exists, is SECURITY DEFINER, anon and authenticated can call it
--   SELECT p.proname, p.prosecdef,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'submit_chat_rating';
--   -- expect: true | true | true
--
--   -- 3. a made-up session is refused
--   SELECT public.submit_chat_rating('not-a-real-session-123', 5, null, 'ka');
--   -- expect: no_session
--
--   -- 4. after a real rating from the site
--   SELECT created_at, rating, left(comment, 60) AS comment, lang, session_id
--   FROM public.chat_ratings ORDER BY created_at DESC LIMIT 20;
