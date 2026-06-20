-- Admin generations history with user email (feature B) — status fix.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Read-only: a SECURITY DEFINER RPC,
-- no schema/table change.
--
-- admin_list_generations(p_limit, p_offset) returns the FULL generations
-- history (paginated, created_at DESC) joined to auth.users.email and
-- profiles.display_name, plus per-user context: user_gen_count (cumulative
-- generations) and user_paid_order_count (how many PAID orders the user has).
--
-- Fix: the prior version returned user_paid (boolean) which the admin tab
-- rendered as a "paid" badge per generation — misleading, since generations are
-- free and only ORDERS are paid. Replaced with user_paid_order_count (bigint) so
-- the UI can show a clear per-user "{n} orders" figure.
--
-- Admin-gated in-body via has_role(auth.uid(), 'admin') — auth.uid() inside a
-- SECURITY DEFINER function returns the CALLER's uid (from the JWT), not the
-- owner's, so this correctly authorizes the caller (mirrors admin_update_order).
-- SECURITY DEFINER is required to read the auth.users schema, which PostgREST
-- can't expose directly. search_path is pinned per the project convention; all
-- cross-schema refs (auth.users, public.*) are fully qualified.
--
-- The RETURNS TABLE columns changed (user_paid boolean → user_paid_order_count
-- bigint), so DROP the old function first, then CREATE.

DROP FUNCTION IF EXISTS public.admin_list_generations(int, int);

CREATE FUNCTION public.admin_list_generations(p_limit int, p_offset int)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  created_at timestamptz,
  product text,
  color text,
  style text,
  prompt text,
  mockup_image_path text,
  is_guest boolean,
  user_email text,
  user_display_name text,
  user_paid_order_count bigint,
  user_gen_count bigint
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
  SELECT
    g.id,
    g.user_id,
    g.created_at,
    g.product,
    g.color,
    g.style,
    g.prompt,
    g.mockup_image_path,
    g.is_guest,
    u.email::text AS user_email,
    p.display_name AS user_display_name,
    (
      SELECT count(*) FROM public.orders o
      WHERE o.user_id = g.user_id AND o.payment_status = 'paid'
    ) AS user_paid_order_count,
    (
      SELECT count(*) FROM public.generations g2
      WHERE g2.user_id = g.user_id
    ) AS user_gen_count
  FROM public.generations g
  LEFT JOIN auth.users u ON u.id = g.user_id
  LEFT JOIN public.profiles p ON p.user_id = g.user_id
  ORDER BY g.created_at DESC
  LIMIT GREATEST(coalesce(p_limit, 50), 0)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
END;
$$;

-- Only authenticated callers may invoke it (the in-body has_role check is the
-- real gate; anon can never be admin). Revoke the implicit PUBLIC execute first.
REVOKE ALL ON FUNCTION public.admin_list_generations(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_generations(int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor; it runs as owner so catalog checks work even
-- though calling the function as owner would hit the admin guard):
--   SELECT p.proname, pg_get_function_result(p.oid) AS returns,
--          p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'admin_list_generations';
--   -- expect: returns includes "user_paid_order_count bigint" (and NO user_paid),
--   --         security_definer = true, authed_can_exec = true
-- The data path is verified by opening the "გენერაციები" admin tab as an admin.
