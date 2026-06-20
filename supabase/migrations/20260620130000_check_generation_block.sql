-- Anti-abuse generation block (feature A).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. No schema/table change.
--
-- check_generation_block(p_user_id) returns TRUE when a user should be blocked
-- from further generate-design: MORE than 15 generations AND zero paid orders.
-- The gemini-proxy gate calls this (for logged-in, non-anonymous, non-admin
-- callers on generate-design) before any gateway call and refuses with 403
-- { code: "GENERATION_BLOCKED" } when true. Any paid order unblocks.
--
-- SECURITY DEFINER so it can count generations / orders regardless of RLS.
-- Pure computation on p_user_id — NO admin guard (unlike admin_list_generations),
-- so it can be spot-checked directly in the SQL editor. Granted to authenticated
-- (the proxy invokes it with the caller's JWT, mirroring
-- check_and_increment_rate_limit). search_path pinned per project convention.

CREATE OR REPLACE FUNCTION public.check_generation_block(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM public.generations WHERE user_id = p_user_id) > 15
    AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE user_id = p_user_id AND payment_status = 'paid'
    );
$$;

REVOKE ALL ON FUNCTION public.check_generation_block(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_generation_block(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor):
--   -- exists + SECURITY DEFINER + authenticated may execute
--   SELECT p.proname, p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname='check_generation_block';
--   -- expect: security_definer = true, authed_can_exec = true
--
--   -- spot-check the boolean against a real user (no admin guard, so this runs):
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid);  -- true/false
