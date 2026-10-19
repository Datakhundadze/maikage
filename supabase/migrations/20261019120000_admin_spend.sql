-- Admin "ხარჯები" (Spend) tab — repo record of objects that ALREADY EXIST in
-- production (created by hand in the Lovable SQL Editor on 2026-10-19).
--
-- ⚠️ Lovable does NOT auto-apply migrations. This file is documentation and is
-- written to be a no-op against production: every statement is IF NOT EXISTS /
-- ON CONFLICT DO NOTHING / guarded by a catalog check. Re-running it changes
-- nothing that is already there.
--
-- NOTE: the column lists below are reconstructed from the build spec, not from
-- pg_dump — NOT NULL / default details may differ slightly from production.
-- Production is the source of truth; refresh this file from
--   SELECT pg_get_functiondef('public.admin_ai_spend(timestamptz,timestamptz)'::regprocedure);
-- and information_schema.columns if it ever matters.
--
-- Used by src/components/admin/AdminSpend.tsx (all reads/writes admin-only via
-- RLS; the RPC is SECURITY DEFINER and checks has_role itself).

-- 1. Model price list: USD per successful call. NULL = price unknown (the tab
--    flags it and the RPC returns unit_cost/cost NULL for that model).
CREATE TABLE IF NOT EXISTS public.ai_model_prices (
  model              text PRIMARY KEY,
  cost_usd_per_call  numeric(10,4),
  note               text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 2. Ad spend, entered by hand from the ad managers.
CREATE TABLE IF NOT EXISTS public.marketing_spend (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('meta', 'google', 'other')),
  campaign     text,
  adset        text,
  amount_usd   numeric(12,2) NOT NULL,
  results      integer,
  result_type  text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 3. Subscriptions / fixed costs. monthly → amount each month; yearly →
--    amount / 12; one_off → amount in the month of paid_on.
CREATE TABLE IF NOT EXISTS public.fixed_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  amount      numeric(12,2) NOT NULL,
  currency    text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'GEL')),
  period      text NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly', 'yearly', 'one_off')),
  start_on    date,
  end_on      date,
  paid_on     date,
  active      boolean NOT NULL DEFAULT true,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Single-row settings (id is always true): 1 USD = usd_gel GEL.
CREATE TABLE IF NOT EXISTS public.spend_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  usd_gel     numeric(8,4),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.spend_settings (id, usd_gel) VALUES (true, 2.70)
ON CONFLICT (id) DO NOTHING;

-- 5. RLS: admin-only FOR ALL on all four tables. A policy is created only when
--    the table has none yet, so production's existing policies (whatever their
--    names) are left alone.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_model_prices', 'marketing_spend', 'fixed_costs', 'spend_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
        'USING (public.has_role(auth.uid(), ''admin''::public.app_role)) '
        'WITH CHECK (public.has_role(auth.uid(), ''admin''::public.app_role))',
        'Admins manage ' || t, t);
    END IF;
  END LOOP;
END $$;

-- 6. RPC (exists in production — NOT recreated here, because its body lives
--    only in production and a CREATE OR REPLACE from this file would overwrite
--    it). Signature the tab relies on:
--
--   public.admin_ai_spend(p_from timestamptz, p_to timestamptz)
--   RETURNS TABLE(
--     day                        date,
--     action                     text,
--     model                      text,
--     calls_ok                   bigint,
--     calls_failed               bigint,
--     calls_failed_maybe_billed  bigint,
--     unit_cost                  numeric,   -- ai_model_prices.cost_usd_per_call, NULL if unknown
--     cost                       numeric,   -- calls_ok × unit_cost
--     cost_max                   numeric    -- upper bound incl. failed-maybe-billed
--   )
--   SECURITY DEFINER, admin-only (has_role(auth.uid(), 'admin')).
--
-- The tab passes Asia/Tbilisi month boundaries as UTC ISO timestamps:
-- p_from = local 1st 00:00, p_to = next month's 1st 00:00 (exclusive).

-- VERIFY (run in the SQL Editor as owner):
--
--   -- tables exist with RLS on:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace
--     AND relname IN ('ai_model_prices', 'marketing_spend', 'fixed_costs', 'spend_settings');
--   -- expect 4 rows, all true
--
--   -- policies (one FOR ALL admin policy per table):
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('ai_model_prices', 'marketing_spend', 'fixed_costs', 'spend_settings')
--   ORDER BY tablename;
--
--   -- settings row:
--   SELECT * FROM public.spend_settings;          -- expect id=true, usd_gel=2.7000
--
--   -- RPC present, SECURITY DEFINER:
--   SELECT p.proname, p.prosecdef, pg_get_function_result(p.oid)
--   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_ai_spend';
--
--   -- smoke test (as an admin session, or as owner):
--   SELECT * FROM public.admin_ai_spend('2026-09-30T20:00:00Z', '2026-10-31T20:00:00Z') LIMIT 20;
