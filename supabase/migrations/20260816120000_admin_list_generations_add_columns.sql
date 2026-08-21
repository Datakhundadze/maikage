-- admin_list_generations: return session_id and transparent_image_path.
--
-- ⚠️ APPLY MANUALLY in the SQL Editor — migrations in this repo are the record,
-- not the deploy mechanism. Run this BEFORE shipping the frontend change: the
-- "დიზაინები" tab moves off its direct table query onto this RPC, and its
-- "პრინტი" download reads transparent_image_path. Ship the frontend first and
-- that button disappears (the field arrives undefined) until the SQL lands.
--
-- WHY THESE TWO. The tab already needed them from the table it was reading
-- directly; the RPC did not return them, which was the only thing blocking it
-- from using the enriched, admin-gated path that already carries user_email,
-- user_display_name, user_gen_count and user_paid_order_count.
--
-- RETURNS TABLE is part of the function signature, so a changed column list
-- requires DROP + CREATE. CREATE OR REPLACE is rejected by Postgres here.
--
-- Everything else is carried over verbatim from
-- 20260620120000_admin_list_generations.sql: same admin gate, same joins, same
-- ordering, same pagination, same grants. Only the two columns are new.
--
-- ⚠️ KNOWN LIMIT, unchanged by this migration: both counts join on user_id,
-- which is NULL for guests, so a guest always reads 0 generations and 0 orders.
-- The UI renders "—" rather than "0" for is_guest rows. See the note at the
-- bottom for the one of the two that could be fixed.

DROP FUNCTION IF EXISTS public.admin_list_generations(int, int);

CREATE FUNCTION public.admin_list_generations(p_limit int, p_offset int)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  session_id text,
  created_at timestamptz,
  product text,
  color text,
  style text,
  prompt text,
  mockup_image_path text,
  transparent_image_path text,
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
    g.session_id,
    g.created_at,
    g.product,
    g.color,
    g.style,
    g.prompt,
    g.mockup_image_path,
    g.transparent_image_path,
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

REVOKE ALL ON FUNCTION public.admin_list_generations(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_generations(int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor, as owner — calling the function as owner would hit the
-- admin guard, so check the catalog instead):
--
--   SELECT p.proname,
--          p.prosecdef AS security_definer,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec,
--          pg_get_function_result(p.oid) AS returns
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'admin_list_generations';
--
--   -- expect: security_definer = true, authed_can_exec = true, and `returns`
--   -- containing BOTH "session_id text" AND "transparent_image_path text"
--   -- alongside the four user_* columns.
--
-- Data path: open the "დიზაინები" admin tab as an admin — the "პრინტი"
-- download button appears on cards whose generation has a print file, and the
-- new identity line shows under the prompt.

-- ── OPTIONAL, NOT APPLIED ───────────────────────────────────────────────────
-- user_gen_count CAN be made correct for guests; user_paid_order_count cannot.
-- generations.session_id is populated for guests, so counting by it works:
--
--   (SELECT count(*) FROM public.generations g2
--     WHERE (g.user_id IS NOT NULL AND g2.user_id = g.user_id)
--        OR (g.user_id IS NULL AND g2.session_id = g.session_id)) AS user_gen_count
--
-- orders has NO session or guest column at all, so there is nothing to count a
-- guest's orders against — that one is a schema gap, not a query bug. Left out
-- of this migration because it changes a number the "გენერაციები" tab also
-- reads, and that was out of scope here.
