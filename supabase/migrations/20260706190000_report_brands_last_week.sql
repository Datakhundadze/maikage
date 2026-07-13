-- Weekly per-brand sales report (feature: automated accountant email).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- PART A (below, uncommented): two read-only aggregation functions the
-- generate-weekly-sales-report edge function calls.
-- PARTS B & C (commented at the bottom): the pg_cron weekly schedule + a one-off
-- test call — run these MANUALLY, after the edge function is deployed.

-- ── PART A: aggregation functions ──────────────────────────────────────────
-- public.orders is ONE ROW PER ITEM (a multi-item checkout is expanded into
-- N rows sharing one cart_id; delivery is charged once on the first row). So
-- "items" = count(*), "orders" = count(DISTINCT coalesce(cart_id, id)).
--
-- BANK grouping (NOT payment gateway): Flitt is a TBC gateway, and tbc_credit
-- is TBC installment, so tbc / flitt / tbc_credit all count under TBC; bog is
-- BOG. Anything else lands in the OTHER bucket and is surfaced by report_week_meta
-- so it's flagged rather than silently dropped.
-- product_price = per-item price excluding delivery (matches the "ბრენდები" sheet).

CREATE OR REPLACE FUNCTION public.report_brands_last_week()
RETURNS TABLE (
  brand         text,
  type          text,
  total_items   bigint,
  tbc_items     bigint,
  bog_items     bigint,
  other_items   bigint,
  total_revenue numeric,
  tbc_revenue   numeric,
  bog_revenue   numeric,
  other_revenue numeric,
  avg_price     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH banked AS (
    SELECT
      o.sub_product,
      o.product,
      o.product_price,
      CASE
        WHEN lower(o.payment_provider) IN ('tbc', 'flitt', 'tbc_credit') THEN 'TBC'
        WHEN lower(o.payment_provider) = 'bog' THEN 'BOG'
        ELSE 'OTHER'
      END AS bank
    FROM public.orders o
    WHERE o.payment_status = 'paid'
      AND o.created_at >= now() - interval '7 days'
  )
  SELECT
    sub_product AS brand,
    product     AS type,
    count(*)                                                    AS total_items,
    count(*) FILTER (WHERE bank = 'TBC')                        AS tbc_items,
    count(*) FILTER (WHERE bank = 'BOG')                        AS bog_items,
    count(*) FILTER (WHERE bank = 'OTHER')                      AS other_items,
    coalesce(sum(product_price), 0)                            AS total_revenue,
    coalesce(sum(product_price) FILTER (WHERE bank = 'TBC'), 0) AS tbc_revenue,
    coalesce(sum(product_price) FILTER (WHERE bank = 'BOG'), 0) AS bog_revenue,
    coalesce(sum(product_price) FILTER (WHERE bank = 'OTHER'), 0) AS other_revenue,
    round(avg(product_price), 2)                               AS avg_price
  FROM banked
  GROUP BY sub_product, product
  ORDER BY count(*) DESC;
$$;

-- Header meta: real order count (distinct cart_id / id) + a comma list of any
-- unexpected payment_provider values so the report can flag them.
CREATE OR REPLACE FUNCTION public.report_week_meta()
RETURNS TABLE (
  total_orders      bigint,
  unknown_providers text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(DISTINCT coalesce(o.cart_id, o.id)) AS total_orders,
    (
      SELECT string_agg(DISTINCT o2.payment_provider, ', ')
      FROM public.orders o2
      WHERE o2.payment_status = 'paid'
        AND o2.created_at >= now() - interval '7 days'
        AND lower(o2.payment_provider) NOT IN ('tbc', 'flitt', 'tbc_credit', 'bog')
    ) AS unknown_providers
  FROM public.orders o
  WHERE o.payment_status = 'paid'
    AND o.created_at >= now() - interval '7 days';
$$;

-- The edge function calls these with the service-role client. Revoke the
-- implicit PUBLIC execute, grant service_role.
REVOKE ALL ON FUNCTION public.report_brands_last_week() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_brands_last_week() TO service_role;
REVOKE ALL ON FUNCTION public.report_week_meta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_week_meta() TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor, runs as owner):
--   SELECT * FROM public.report_brands_last_week();   -- per-brand×type rows, last 7 days paid
--   SELECT * FROM public.report_week_meta();           -- total_orders + any unknown_providers

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — SCHEDULE (run MANUALLY, once, AFTER the edge function is deployed).
-- Reuses the existing pg_cron + pg_net + vault stack (the same one that drains
-- the email queue) and the vault secret 'email_queue_service_role_key'.
-- Fires at 06:00 UTC (10:00 Tbilisi) every MONDAY.
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT cron.schedule(
--   'weekly-sales-report',
--   '0 6 * * 1',
--   $CRON$
--   SELECT net.http_post(
--     url     := 'https://ykoseamefoabptuijsza.supabase.co/functions/v1/generate-weekly-sales-report',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                                  WHERE name = 'email_queue_service_role_key')),
--     body    := '{}'::jsonb
--   );
--   $CRON$
-- );
--
-- To revert:  SELECT cron.unschedule('weekly-sales-report');
-- To inspect: SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'weekly-sales-report';

-- ════════════════════════════════════════════════════════════════════════════
-- PART C — ONE-OFF TEST (run MANUALLY to trigger the report NOW).
-- Same net.http_post without scheduling; check the accountant inbox + logs.
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT net.http_post(
--   url     := 'https://ykoseamefoabptuijsza.supabase.co/functions/v1/generate-weekly-sales-report',
--   headers := jsonb_build_object(
--                'Content-Type', 'application/json',
--                'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                                WHERE name = 'email_queue_service_role_key')),
--   body    := '{}'::jsonb
-- );
