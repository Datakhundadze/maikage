-- orders: browser inserts can never create a "paid" / processed order.
--
-- ✅ APPLIED on prod 2026-11-05 (Claude, David's GO) and verified:
--   anon INSERT with payment_status='paid', status='confirmed', paid_at, bog_order_id
--     → stored as unpaid / pending / NULL / NULL;
--   service_role INSERT + UPDATE to paid (payment callbacks, DM bot) → unchanged;
--   admin (has_role) INSERT 'showroom' + admin_update_order → paid, paid_at set.
--   All tests ran inside rolled-back DO blocks; 0 test rows left.
--
-- WHY: the INSERT policies ("Anonymous can insert orders" user_id IS NULL,
-- "Users can insert orders" auth.uid() = user_id) never restricted columns,
-- so anyone with the public anon key could insert an order already marked
-- paid — and every paid order gets produced.
--
-- Only the BROWSER roles are coerced. service_role (create-payment-*, the
-- *-callback functions, meta-webhook) and admins are untouched.

CREATE OR REPLACE FUNCTION public.orders_guard_client_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    NEW.payment_status := 'unpaid';
    NEW.paid_at := NULL;
    NEW.bog_order_id := NULL;
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_client_insert ON public.orders;
CREATE TRIGGER orders_guard_client_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard_client_insert();

-- Verify:
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal;
