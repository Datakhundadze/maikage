-- Security fix: admin_update_order is SECURITY DEFINER (bypasses RLS on
-- orders) but had NO internal authorization check and was GRANTed EXECUTE
-- to anon — so any anonymous caller could mark any order as paid, flip
-- statuses, etc. without authentication. This was the last open door for
-- order tampering after the public UPDATE policy on orders was dropped.
--
-- Two-layer fix:
--   1. Internal guard: reject callers who are not admins (the real boundary
--      — survives even if EXECUTE is accidentally re-granted later).
--   2. Tighten grants: REVOKE from PUBLIC/anon, GRANT to authenticated only.
--
-- The status / payment_status / paid_at UPDATE logic and RETURNING below
-- are byte-identical to the original (20260424120000_admin_update_order_fn.sql);
-- the only addition is the has_role guard at the top.
--
-- auth.uid() inside a SECURITY DEFINER function returns the CALLER's uid
-- (from the session JWT), not the function owner's — so this correctly
-- checks the person invoking the RPC. AdminOrders.tsx (the sole caller) runs
-- as an authenticated admin (maika@maika.ge holds the 'admin' role), so the
-- legitimate admin path is unchanged.

CREATE OR REPLACE FUNCTION public.admin_update_order(
  p_order_id UUID,
  p_field TEXT,
  p_value TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Caller-identity guard. SECURITY DEFINER bypasses RLS, so this function
  -- must verify the caller itself. Non-admins get a permission error.
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Permission denied: admin role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_field = 'status' THEN
    UPDATE public.orders
    SET status = p_value
    WHERE id = p_order_id
    RETURNING to_jsonb(orders.*) INTO result;
  ELSIF p_field = 'payment_status' THEN
    UPDATE public.orders
    SET payment_status = p_value,
        paid_at = CASE
          WHEN p_value = 'paid' AND paid_at IS NULL THEN now()
          ELSE paid_at
        END
    WHERE id = p_order_id
    RETURNING to_jsonb(orders.*) INTO result;
  ELSE
    RAISE EXCEPTION 'Unknown field: %', p_field;
  END IF;

  RETURN result;
END;
$$;

-- Shrink the callable surface: no anon, no PUBLIC. Authenticated only —
-- and even authenticated non-admins are rejected by the guard above.
REVOKE EXECUTE ON FUNCTION public.admin_update_order(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_order(UUID, TEXT, TEXT) TO authenticated;
