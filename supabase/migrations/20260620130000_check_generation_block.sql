-- Generation / billable-action block (feature A) + manual admin block.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. No schema/table change.
--
-- check_generation_block(p_user_id, p_action) returns TRUE when a user should
-- be blocked. Two reasons, OR'd:
--   1. MANUAL admin block — profiles.is_blocked = true (AdminUsers toggle).
--      Blocks ALL billable actions.
--   2. AUTO anti-abuse — only for p_action = 'generate-design': MORE than 15
--      generations AND zero paid orders. Any paid order unblocks.
-- profiles is keyed by profiles.user_id (UNIQUE); COALESCE handles users with
-- no profile row (treated as not blocked).
--
-- The gemini-proxy gate calls this for every billable action (logged-in,
-- non-anonymous, non-admin callers) before any gateway call, and refuses with
-- 403 { code: "GENERATION_BLOCKED" } when true.
--
-- SECURITY DEFINER so it can read profiles / generations / orders regardless of
-- RLS. Pure computation on p_user_id — NO admin guard, so it can be spot-checked
-- in the SQL editor. Granted to authenticated (the proxy invokes it with the
-- caller's JWT, mirroring check_and_increment_rate_limit). search_path pinned.
--
-- The parameter list changed from the prior (uuid) version, so DROP first.

DROP FUNCTION IF EXISTS public.check_generation_block(uuid);

CREATE FUNCTION public.check_generation_block(p_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT is_blocked FROM public.profiles WHERE user_id = p_user_id), false)
    OR (
      p_action = 'generate-design'
      AND (SELECT count(*) FROM public.generations WHERE user_id = p_user_id) > 15
      AND NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE user_id = p_user_id AND payment_status = 'paid'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.check_generation_block(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_generation_block(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor):
--   -- exists with the new (uuid, text) signature + SECURITY DEFINER + grant
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname='check_generation_block';
--   -- expect: args = 'p_user_id uuid, p_action text', security_definer = true, authed_can_exec = true
--
--   -- spot-check (no admin guard, so these run directly):
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid, 'generate-design'); -- auto rule + manual
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid, 'upscale');         -- manual block only
