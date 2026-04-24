-- Bypass RLS for admin order updates. The admin panel authenticates via a
-- frontend password and runs as the anon role, so row-level policies can
-- silently block UPDATE statements. This SECURITY DEFINER function runs as
-- the DB owner and is therefore immune to RLS.
CREATE OR REPLACE FUNCTION public.admin_update_order(
  p_order_id UUID,
  p_field TEXT,
  p_value TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.admin_update_order TO anon, authenticated;
