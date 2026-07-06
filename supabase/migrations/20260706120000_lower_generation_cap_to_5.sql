-- Lower the auto anti-abuse generation cap: 15 → 5.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. No schema/table change, no edge
-- function redeploy needed (gemini-proxy calls this RPC by name; the number
-- lives only here).
--
-- Identical to 20260620130000_check_generation_block.sql except the count
-- threshold: a logged-in (non-anonymous) user with MORE than 5 generations
-- and zero paid orders is blocked from further generate-design calls. Any
-- paid order unblocks. Manual admin block (profiles.is_blocked) unchanged —
-- it still applies to ALL billable actions. Signature is unchanged, so
-- CREATE OR REPLACE suffices (no DROP) and existing grants are preserved;
-- they are re-stated below anyway for a self-contained record.

CREATE OR REPLACE FUNCTION public.check_generation_block(p_user_id uuid, p_action text)
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
      AND (SELECT count(*) FROM public.generations WHERE user_id = p_user_id) > 5
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
--   -- 1. function definition now carries the new threshold:
--   SELECT pg_get_functiondef(p.oid) LIKE '%> 5%' AS has_new_cap,
--          p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'check_generation_block';
--   -- expect: has_new_cap = true, security_definer = true, authed_can_exec = true
--
--   -- 2. spot-check a real user (no admin guard — runs directly):
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid, 'generate-design');
--   --    true  → blocked (>5 generations, no paid order, or manually blocked)
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid, 'upscale');
--   --    manual is_blocked only — the count rule never applies to non-generate actions
