-- E-mail to maika@maika.ge for every paid order (owner's GO 2026-11-26).
-- Applied by hand on prod (Lovable does not run migrations).
--
-- staff_notified_at: set by the notify-new-orders edge function when the shop
-- has been e-mailed about a paid order. Existing paid orders are back-filled so
-- nothing old is mailed. Client inserts cannot pre-set it (extra guard trigger;
-- the existing orders_guard_* functions are not modified).

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS staff_notified_at timestamptz;

UPDATE public.orders SET staff_notified_at = now()
WHERE payment_status = 'paid' AND staff_notified_at IS NULL;

CREATE OR REPLACE FUNCTION public.orders_guard_staff_notified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.staff_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_guard_staff_notified ON public.orders;
CREATE TRIGGER orders_guard_staff_notified
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard_staff_notified();

CREATE INDEX IF NOT EXISTS orders_staff_unnotified_idx
  ON public.orders (created_at) WHERE staff_notified_at IS NULL AND payment_status = 'paid';

-- Every 2 minutes; same vault secret as the weekly report job.
SELECT cron.schedule(
  'notify-new-orders',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ykoseamefoabptuijsza.supabase.co/functions/v1/notify-new-orders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                 WHERE name = 'email_queue_service_role_key')),
    body    := '{}'::jsonb
  );
  $cron$
);

-- Verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='staff_notified_at';
-- SELECT count(*) FROM public.orders WHERE payment_status='paid' AND staff_notified_at IS NULL;  -- 0
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname='notify-new-orders';
