-- Period-aware sales report functions (weekly + monthly share one pair).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- Replaces the fixed-window report_brands_last_week() / report_week_meta()
-- (from 20260706190000) with range-parameterized functions the edge function
-- calls with a [p_from, p_to) window it computes per period. Same aggregation:
-- PAID orders, PER ITEM, brand×type, TBC/BOG bank split (Flitt + tbc_credit
-- count under TBC), product_price excluding delivery.

-- Drop the old fixed-window functions (superseded).
DROP FUNCTION IF EXISTS public.report_brands_last_week();
DROP FUNCTION IF EXISTS public.report_week_meta();

-- ── report_brands: per-brand×type item table for a [p_from, p_to) window ─────
CREATE OR REPLACE FUNCTION public.report_brands(p_from timestamptz, p_to timestamptz)
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
      AND o.created_at >= p_from
      AND o.created_at <  p_to
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

-- ── report_meta: order count + any unexpected providers for the window ──────
CREATE OR REPLACE FUNCTION public.report_meta(p_from timestamptz, p_to timestamptz)
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
        AND o2.created_at >= p_from
        AND o2.created_at <  p_to
        AND lower(o2.payment_provider) NOT IN ('tbc', 'flitt', 'tbc_credit', 'bog')
    ) AS unknown_providers
  FROM public.orders o
  WHERE o.payment_status = 'paid'
    AND o.created_at >= p_from
    AND o.created_at <  p_to;
$$;

REVOKE ALL ON FUNCTION public.report_brands(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_brands(timestamptz, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.report_meta(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_meta(timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor):
--   SELECT * FROM public.report_brands(now() - interval '7 days', now());
--   SELECT * FROM public.report_meta(now() - interval '7 days', now());

-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULES (run MANUALLY, AFTER the edge function is deployed). Reuse the
-- existing pg_cron + pg_net + vault stack and the vault secret
-- 'email_queue_service_role_key'. The edge function computes the previous
-- complete calendar period in Asia/Tbilisi from the body's "period".
-- ════════════════════════════════════════════════════════════════════════════
--
-- WEEKLY — Monday 06:00 UTC (10:00 Tbilisi), covers the week that just ended:
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
--     body    := '{"period":"week"}'::jsonb
--   );
--   $CRON$
-- );
--
-- MONTHLY — 1st of month 06:00 UTC (10:00 Tbilisi), covers the month that ended:
-- SELECT cron.schedule(
--   'monthly-sales-report',
--   '0 6 1 * *',
--   $CRON$
--   SELECT net.http_post(
--     url     := 'https://ykoseamefoabptuijsza.supabase.co/functions/v1/generate-weekly-sales-report',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                                  WHERE name = 'email_queue_service_role_key')),
--     body    := '{"period":"month"}'::jsonb
--   );
--   $CRON$
-- );
--
-- To revert:  SELECT cron.unschedule('weekly-sales-report');
--             SELECT cron.unschedule('monthly-sales-report');
-- One-off test (either period): the same net.http_post with the chosen body.
