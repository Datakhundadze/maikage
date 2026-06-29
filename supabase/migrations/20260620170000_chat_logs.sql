-- FAQ chatbot conversation log (feature 1) — persist + admin view.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- The gemini-proxy "faq-chat" action writes each turn (user message +
-- assistant reply) here via the SERVICE ROLE, which bypasses RLS. The table is
-- DENY-ALL for everyone else (RLS enabled, NO policies — exactly like
-- public.rate_limit), so no client (anon or authenticated) can read or write it
-- directly. Admins read it only through the two SECURITY DEFINER RPCs below,
-- each guarded by has_role(auth.uid(),'admin').

CREATE TABLE IF NOT EXISTS public.chat_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  text NOT NULL,
  user_id     uuid,
  role        text NOT NULL,        -- 'user' | 'assistant'
  content     text NOT NULL,
  lang        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_session_time ON public.chat_logs (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON public.chat_logs (created_at DESC);

-- RLS on, NO policies → deny-all. The service-role writer bypasses RLS; admins
-- read via the RPCs. (Mirrors public.rate_limit.)
ALTER TABLE public.chat_logs ENABLE ROW LEVEL SECURITY;
-- intentionally NO policies.

-- ── RPC 1: session list (one row per session_id, newest activity first) ──────
DROP FUNCTION IF EXISTS public.admin_list_chat_sessions(int, int);
CREATE FUNCTION public.admin_list_chat_sessions(p_limit int, p_offset int)
RETURNS TABLE (
  session_id        text,
  user_id           uuid,
  user_email        text,
  first_at          timestamptz,
  last_at           timestamptz,
  message_count     bigint,
  last_user_snippet text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  WITH sessions AS (
    SELECT
      c.session_id,
      max(c.user_id)    AS user_id,     -- all rows in a session share one user
      min(c.created_at) AS first_at,    -- (or NULL for anon); max() collapses it
      max(c.created_at) AS last_at,
      count(*)          AS message_count
    FROM public.chat_logs c
    GROUP BY c.session_id
  ),
  latest_user AS (
    SELECT DISTINCT ON (c.session_id)
      c.session_id,
      left(c.content, 120) AS snippet
    FROM public.chat_logs c
    WHERE c.role = 'user'
    ORDER BY c.session_id, c.created_at DESC
  )
  SELECT
    s.session_id,
    s.user_id,
    u.email::text AS user_email,
    s.first_at,
    s.last_at,
    s.message_count,
    lu.snippet AS last_user_snippet
  FROM sessions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN latest_user lu ON lu.session_id = s.session_id
  ORDER BY s.last_at DESC
  LIMIT GREATEST(coalesce(p_limit, 50), 0)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
END;
$$;

-- ── RPC 2: all messages of one session (chronological) ──────────────────────
DROP FUNCTION IF EXISTS public.admin_list_chat_messages(text);
CREATE FUNCTION public.admin_list_chat_messages(p_session_id text)
RETURNS TABLE (
  role       text,
  content    text,
  lang       text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  SELECT c.role, c.content, c.lang, c.created_at
  FROM public.chat_logs c
  WHERE c.session_id = p_session_id
  ORDER BY c.created_at ASC;
END;
$$;

-- Only authenticated callers may invoke; the in-body has_role check is the real
-- gate (anon can never be admin). Revoke the implicit PUBLIC execute first.
REVOKE ALL ON FUNCTION public.admin_list_chat_sessions(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_chat_sessions(int, int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_chat_messages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_chat_messages(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--   -- table exists with RLS on and NO policies (deny-all):
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname='chat_logs' AND relnamespace='public'::regnamespace;  -- true
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname='public' AND tablename='chat_logs';                 -- expect 0
--
--   -- both RPCs exist, SECURITY DEFINER, granted to authenticated:
--   SELECT p.proname, p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN ('admin_list_chat_sessions','admin_list_chat_messages');
--   -- expect: security_definer = true, authed_can_exec = true for both
--
--   -- data path verified by opening the "ჩატის ისტორია" admin tab as an admin.
