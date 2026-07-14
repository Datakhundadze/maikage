-- Admin "exempt from generation limit" mechanism.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- Lets an admin free a user who hit the lifetime generate-design cap WITHOUT
-- deleting their generations history (the old hack). A new profiles.is_exempt
-- flag skips ONLY the count-limit clause; the manual is_blocked hard block is
-- unchanged and still applies to every billable action (an exempt user can
-- still be hard-blocked).
--
-- The cap number is unchanged (> 10, the value currently live in production).

-- 1. Exemption flag ----------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_exempt boolean NOT NULL DEFAULT false;

-- 2. Block function — same body, plus the is_exempt skip -----------------------
-- Reason 1 (is_blocked): manual admin hard block — applies to ALL actions,
--   UNCHANGED, and evaluated first regardless of is_exempt.
-- Reason 2 (auto anti-abuse, generate-design only): > 10 generations AND no
--   paid order — now ALSO skipped when profiles.is_exempt = true. Any paid
--   order still unblocks. Signature/grants/SECURITY DEFINER/search_path kept
--   exactly as before.
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
      AND NOT COALESCE((SELECT is_exempt FROM public.profiles WHERE user_id = p_user_id), false)
      AND (SELECT count(*) FROM public.generations WHERE user_id = p_user_id) > 10
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
--   -- column exists, default false:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_exempt';
--
--   -- function still SECURITY DEFINER + granted, and carries the exempt skip:
--   SELECT pg_get_functiondef(p.oid) LIKE '%is_exempt%' AS has_exempt_skip,
--          pg_get_functiondef(p.oid) LIKE '%> 10%'      AS cap_is_10,
--          p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'check_generation_block';
--   -- expect: has_exempt_skip = true, cap_is_10 = true, security_definer = true, authed_can_exec = true
--
--   -- spot-check a capped user before/after flipping the flag:
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid, 'generate-design');  -- true (capped)
--   -- UPDATE public.profiles SET is_exempt = true WHERE user_id = '<user-uuid>';
--   -- SELECT public.check_generation_block('<user-uuid>'::uuid, 'generate-design');  -- false (exempt)
--   -- (is_blocked still overrides: a hard-blocked exempt user stays blocked.)
