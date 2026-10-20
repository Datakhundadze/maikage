-- Ad funnel: which Meta ad → conversation → requisites sent → paid → revenue.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Apply BEFORE publishing the
-- frontend: until admin_ad_funnel exists the „რეკლამები → შეკვეთები" section
-- of the „ხარჯები" tab shows an error box (the rest of the tab is unaffected).
--
-- Add-only: social_messages, social_ad_referrals and admin_ai_spend are not
-- touched. marketing_spend only gains a nullable column.
--
-- Used by src/components/admin/AdminSpend.tsx (AdFunnelCard). The TS mirror of
-- the parsing / attribution rules is src/lib/adFunnel.ts — THIS FILE IS
-- AUTHORITATIVE; keep the regexes in sync if either side changes.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. meta_ads — ad_id → human name (and ad set / campaign for spend matching)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_ads (
  ad_id          text PRIMARY KEY,
  ad_name        text NOT NULL,
  adset_name     text,
  campaign_name  text,
  platform       text,
  created_at     timestamptz DEFAULT now()
);

COMMENT ON COLUMN public.meta_ads.adset_name IS
  'Ad set NAME exactly as in marketing_spend.adset. When set, marketing_spend rows '
  'with ad_id IS NULL and this adset are counted as this ad''s spend. Leave NULL when '
  'several ads share one ad set (e.g. the two showroom ads) — then tag their spend '
  'rows with marketing_spend.ad_id instead, or the spend would be double-counted.';

ALTER TABLE public.meta_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage meta_ads" ON public.meta_ads;
CREATE POLICY "Admins manage meta_ads"
  ON public.meta_ads FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.meta_ads (ad_id, ad_name, adset_name, campaign_name, platform) VALUES
  ('52662783755524', 'ჰუდის ვიდეო (Messenger)', 'Tbilisi 20km | 18-40 | Messenger | work hours', 'Maika | Washed Hoodie | Messenger | Oct 2026', 'facebook'),
  ('52663755851724', 'შოურუმი — ქართული (Facebook)', NULL, 'Maika | Showroom video test | Messenger | Oct 19-24', 'facebook'),
  ('52663761377724', 'შოურუმი — ინგლისური (Instagram)', NULL, 'Maika | Showroom video test | Messenger | Oct 19-24', 'instagram')
ON CONFLICT (ad_id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. marketing_spend.ad_id — optional per-ad tag on a spend row
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.marketing_spend ADD COLUMN IF NOT EXISTS ad_id text;
CREATE INDEX IF NOT EXISTS idx_marketing_spend_ad_id_date
  ON public.marketing_spend (ad_id, date);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. admin_ad_funnel(p_from, p_to) — dates inclusive, Asia/Tbilisi days
-- ───────────────────────────────────────────────────────────────────────────
-- RULES
--   Attribution  every message is attributed to the most recent referral
--                (social_ad_referrals.occurred_at <= message.sent_at) of its
--                conversation; no referral, or a ref-only referral (ad_id NULL)
--                → organic / unknown (ad_id NULL). The webhook writes both
--                timestamps from the same messaging[].timestamp, so the message
--                that carries a referral is attributed to it ("at or before").
--   Unit         (conversation_key, attributed ad_id). In the common case — one
--                ad click that opens a new thread — that is just the
--                conversation. A returning customer who clicks an ad later gets
--                a second unit for that ad (their older messages stay organic),
--                so the ad is credited and the old chat is not.
--   Bucketing    a unit belongs to the range of its FIRST INBOUND message. Units
--                with no inbound message are ignored. Cohort-style: a payment
--                that lands after p_to still counts for the unit's range.
--   Stages       counted once per unit, from direction = 'out' (staff) only:
--                  requisites  text ~ 'რეკვიზ'   (catches the typo „რეკვიზირებს")
--                  paid        text ~* 'ვადასტურებთ ჩარიცხ|გიდასტურებთ|ჩარიცხვა დადასტურ|მივიღეთ ჩარიცხ'
--   Revenue      per paid unit: the LAST price parsed from a staff message of the
--                same conversation (any unit) sent at or before the unit's FIRST
--                confirmation. Price = first match of
--                'ღირებულება[\s:]*(\d+(?:[.,]\d{1,2})?)\s*ლარ' in that message.
--                Courier (+8 ₾) is not revenue. No price → paid counts, revenue
--                does not, paid_without_price += 1.
--   Spend        Σ marketing_spend.amount_usd (date in [p_from, p_to]) where
--                ad_id = the ad, + Σ where ad_id IS NULL AND adset =
--                meta_ads.adset_name (only when adset_name is not NULL).
--                Organic row: spend_usd NULL. Ad with no spend rows: NULL.
--   Name         meta_ads.ad_name → latest referral ad_title → ad_id.
--
-- One row per ad_id seen in either the funnel or the spend; organic (NULL)
-- last. Rows with nothing in the range are not returned.
CREATE OR REPLACE FUNCTION public.admin_ad_funnel(p_from date, p_to date)
RETURNS TABLE (
  ad_id               text,
  ad_name             text,
  spend_usd           numeric,
  conversations       bigint,
  requisites          bigint,
  paid                bigint,
  revenue_gel         numeric,
  paid_without_price  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_from timestamptz;
  v_to   timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid range: % – %', p_from, p_to;
  END IF;

  -- local midnight of p_from → local midnight of the day after p_to (exclusive)
  v_from := p_from::timestamp AT TIME ZONE 'Asia/Tbilisi';
  v_to   := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Tbilisi';

  RETURN QUERY
  WITH convs AS (
    -- conversations that can have a unit starting in range
    SELECT DISTINCT sm.conversation_key
    FROM public.social_messages sm
    WHERE sm.direction = 'in' AND sm.sent_at >= v_from AND sm.sent_at < v_to
  ),
  msgs AS (
    SELECT m.conversation_key AS ck, m.direction AS dir, m.text AS body, m.sent_at AS at,
           (SELECT r.ad_id
              FROM public.social_ad_referrals r
             WHERE r.conversation_key = m.conversation_key
               AND r.occurred_at <= m.sent_at
             ORDER BY r.occurred_at DESC, r.created_at DESC
             LIMIT 1) AS attr_ad
    FROM public.social_messages m
    JOIN convs c ON c.conversation_key = m.conversation_key
  ),
  units AS (
    SELECT x.ck, x.attr_ad,
           min(x.at) FILTER (WHERE x.dir = 'in') AS first_in,
           coalesce(bool_or(x.dir = 'out' AND x.body ~ 'რეკვიზ'), false) AS has_req,
           min(x.at) FILTER (
             WHERE x.dir = 'out'
               AND x.body ~* '(ვადასტურებთ ჩარიცხ|გიდასტურებთ|ჩარიცხვა დადასტურ|მივიღეთ ჩარიცხ)'
           ) AS first_paid_at
    FROM msgs x
    GROUP BY x.ck, x.attr_ad
  ),
  bucketed AS (
    SELECT u.attr_ad, u.has_req, u.first_paid_at,
           CASE WHEN u.first_paid_at IS NULL THEN NULL ELSE (
             SELECT replace(substring(p.text FROM 'ღირებულება[\s:]*(\d+(?:[.,]\d{1,2})?)\s*ლარ'), ',', '.')::numeric
               FROM public.social_messages p
              WHERE p.conversation_key = u.ck
                AND p.direction = 'out'
                AND p.sent_at <= u.first_paid_at
                AND p.text ~ 'ღირებულება[\s:]*\d+(?:[.,]\d{1,2})?\s*ლარ'
              ORDER BY p.sent_at DESC
              LIMIT 1
           ) END AS price_gel
    FROM units u
    WHERE u.first_in >= v_from AND u.first_in < v_to
  ),
  funnel AS (
    SELECT b.attr_ad AS f_ad,
           count(*)                                                              AS f_conv,
           count(*) FILTER (WHERE b.has_req)                                     AS f_req,
           count(*) FILTER (WHERE b.first_paid_at IS NOT NULL)                   AS f_paid,
           sum(b.price_gel)                                                      AS f_rev,
           count(*) FILTER (WHERE b.first_paid_at IS NOT NULL AND b.price_gel IS NULL) AS f_paid_np
    FROM bucketed b
    GROUP BY b.attr_ad
  ),
  spend AS (
    SELECT s.s_ad, sum(s.amt) AS s_usd
    FROM (
      SELECT ms.ad_id AS s_ad, ms.amount_usd AS amt
        FROM public.marketing_spend ms
       WHERE ms.ad_id IS NOT NULL
         AND ms.date >= p_from AND ms.date <= p_to
      UNION ALL
      SELECT a.ad_id, ms.amount_usd
        FROM public.marketing_spend ms
        JOIN public.meta_ads a ON a.adset_name IS NOT NULL AND ms.adset = a.adset_name
       WHERE ms.ad_id IS NULL
         AND ms.date >= p_from AND ms.date <= p_to
    ) s
    GROUP BY s.s_ad
  ),
  keys AS (
    SELECT f.f_ad AS k FROM funnel f
    UNION
    SELECT sp.s_ad FROM spend sp
  )
  SELECT k.k,
         CASE WHEN k.k IS NULL THEN NULL::text ELSE coalesce(
           a.ad_name,
           (SELECT r.ad_title FROM public.social_ad_referrals r
             WHERE r.ad_id = k.k AND r.ad_title IS NOT NULL
             ORDER BY r.occurred_at DESC LIMIT 1),
           k.k
         ) END,
         CASE WHEN k.k IS NULL THEN NULL::numeric ELSE sp.s_usd END,
         coalesce(f.f_conv, 0)::bigint,
         coalesce(f.f_req, 0)::bigint,
         coalesce(f.f_paid, 0)::bigint,
         f.f_rev::numeric,
         coalesce(f.f_paid_np, 0)::bigint
  FROM keys k
  LEFT JOIN funnel f ON f.f_ad IS NOT DISTINCT FROM k.k
  LEFT JOIN spend sp ON sp.s_ad = k.k
  LEFT JOIN public.meta_ads a ON a.ad_id = k.k
  ORDER BY (k.k IS NULL), coalesce(sp.s_usd, 0) DESC, coalesce(f.f_conv, 0) DESC, k.k;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ad_funnel(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_ad_funnel(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_ad_funnel(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- OPTIONAL (not applied): tag existing showroom spend rows with their ad_id.
-- The two showroom ads share one campaign, so their spend can only be split by
-- ad_id. Check the rows first, then tag by hand, e.g.:
--
--   SELECT id, date, campaign, adset, amount_usd, note, ad_id
--   FROM public.marketing_spend
--   WHERE campaign ILIKE '%Showroom%' ORDER BY date;
--
--   UPDATE public.marketing_spend SET ad_id = '52663755851724' WHERE id IN ('…');  -- ქართული (FB)
--   UPDATE public.marketing_spend SET ad_id = '52663761377724' WHERE id IN ('…');  -- ინგლისური (IG)
-- ───────────────────────────────────────────────────────────────────────────

-- VERIFY (SQL Editor, as owner):
--
--   -- 1. meta_ads: RLS on, one FOR ALL policy, 3 seed rows
--   SELECT c.relrowsecurity AS rls_enabled,
--          (SELECT string_agg(policyname || ':' || cmd, ', ') FROM pg_policies
--           WHERE schemaname = 'public' AND tablename = 'meta_ads') AS policies,
--          (SELECT count(*) FROM public.meta_ads) AS seed_rows
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'meta_ads';
--   -- expect: true | "Admins manage meta_ads:ALL" | 3
--
--   -- 2. marketing_spend.ad_id exists (text, nullable) + index
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'marketing_spend' AND column_name = 'ad_id';
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'marketing_spend' AND indexname = 'idx_marketing_spend_ad_id_date';
--
--   -- 3. RPC: SECURITY DEFINER, search_path set, authenticated yes / anon no
--   SELECT p.proname,
--          p.prosecdef AS security_definer,
--          p.proconfig AS config,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec,
--          pg_get_function_result(p.oid) AS returns
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'admin_ad_funnel';
--   -- expect: security_definer = true, config = {search_path=public, pg_temp},
--   --         authed_can_exec = true, anon_can_exec = false
--
--   -- 4. sample call. As owner auth.uid() is NULL → 'forbidden: admin only'
--   --    (that IS the guard working). To see data from the SQL Editor, impersonate
--   --    an admin inside a rolled-back transaction:
--   BEGIN;
--   SELECT set_config('request.jwt.claims',
--          json_build_object('sub', (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1))::text, true);
--   SELECT * FROM public.admin_ad_funnel('2026-10-01', '2026-10-31');
--   ROLLBACK;
--   -- or simply open the „ხარჯები" tab as an admin.
