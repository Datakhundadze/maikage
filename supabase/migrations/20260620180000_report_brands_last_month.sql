-- Monthly per-brand sales report (feature: automated accountant email).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- PART A (below, uncommented): the read-only aggregation function the
-- generate-monthly-brands-report edge function calls.
-- PARTS B & C (commented at the bottom): the pg_cron schedule + a one-off test
-- call — run these MANUALLY (separately), after the edge function is deployed.

-- ── PART A: aggregation function ────────────────────────────────────────────
-- Per-brand (sub_product) × product totals + TBC/BOG split for the PREVIOUS
-- calendar month, PAID orders only. product_price = per-item price excluding
-- delivery. Read-only; SECURITY DEFINER so the caller needs no direct table
-- grant, search_path pinned per convention.
CREATE OR REPLACE FUNCTION public.report_brands_last_month()
RETURNS TABLE (
  brand         text,
  type          text,
  total_items   bigint,
  tbc_items     bigint,
  bog_items     bigint,
  total_revenue numeric,
  tbc_revenue   numeric,
  bog_revenue   numeric,
  avg_price     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.sub_product AS brand,
    o.product     AS type,
    count(*)                                                    AS total_items,
    count(*) FILTER (WHERE o.payment_provider = 'tbc')         AS tbc_items,
    count(*) FILTER (WHERE o.payment_provider = 'bog')         AS bog_items,
    sum(o.product_price)                                       AS total_revenue,
    sum(o.product_price) FILTER (WHERE o.payment_provider = 'tbc') AS tbc_revenue,
    sum(o.product_price) FILTER (WHERE o.payment_provider = 'bog') AS bog_revenue,
    round(avg(o.product_price), 2)                             AS avg_price
  FROM public.orders o
  WHERE o.payment_status = 'paid'
    AND o.created_at >= date_trunc('month', now()) - interval '1 month'
    AND o.created_at <  date_trunc('month', now())
  GROUP BY o.sub_product, o.product
  ORDER BY count(*) DESC;
$$;

-- The edge function calls this with the service-role client → executes as the
-- service_role DB role. Revoke the implicit PUBLIC execute, grant service_role.
REVOKE ALL ON FUNCTION public.report_brands_last_month() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_brands_last_month() TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor, runs as owner):
--   SELECT * FROM public.report_brands_last_month();
--   -- returns one row per brand×type for last month's paid orders (or 0 rows).

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — SCHEDULE (run MANUALLY, once, AFTER the edge function is deployed).
-- Reuses the existing pg_cron + pg_net + vault stack (the same one that drains
-- the email queue) and the vault secret 'email_queue_service_role_key'.
-- Fires at 06:00 UTC (10:00 Tbilisi) on the 1st of every month.
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT cron.schedule(
--   'monthly-brands-report',
--   '0 6 1 * *',
--   $CRON$
--   SELECT net.http_post(
--     url     := 'https://ykoseamefoabptuijsza.supabase.co/functions/v1/generate-monthly-brands-report',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                                  WHERE name = 'email_queue_service_role_key')),
--     body    := '{}'::jsonb
--   );
--   $CRON$
-- );
--
-- To revert:  SELECT cron.unschedule('monthly-brands-report');
-- To inspect: SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'monthly-brands-report';

-- ════════════════════════════════════════════════════════════════════════════
-- PART C — ONE-OFF TEST (run MANUALLY to trigger the report NOW, before the 1st).
-- Same net.http_post without scheduling; check the accountant + maika@maika.ge
-- inbox and the edge function logs.
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT net.http_post(
--   url     := 'https://ykoseamefoabptuijsza.supabase.co/functions/v1/generate-monthly-brands-report',
--   headers := jsonb_build_object(
--                'Content-Type', 'application/json',
--                'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                                WHERE name = 'email_queue_service_role_key')),
--   body    := '{}'::jsonb
-- );
