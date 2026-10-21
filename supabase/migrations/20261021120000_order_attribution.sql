-- Order attribution: first-touch / last-touch ad & referral source per order.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Apply BEFORE publishing the
-- frontend: until record_order_attribution exists the storefront's keepalive
-- POST just 404s (harmless, swallowed), and until order_attribution exists
-- the admin „შეკვეთები" tab shows no source badges (the list itself is
-- unaffected — attribution is loaded by a separate query).
--
-- Add-only: public.orders is not altered. Written by the client
-- (src/components/AttributionTracker.tsx → src/lib/attribution.ts) through the
-- SECURITY DEFINER RPC below; read and manually tagged by admins
-- (src/hooks/useOrderAttribution.ts, src/components/admin/AdminOrders.tsx).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_attribution (
  order_id         uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  cart_id          uuid,

  ft_source        text,
  ft_medium        text,
  ft_campaign      text,
  ft_content       text,
  ft_term          text,
  ft_fbclid        text,
  ft_gclid         text,
  ft_referrer      text,
  ft_landing_page  text,
  ft_seen_at       timestamptz,

  lt_source        text,
  lt_medium        text,
  lt_campaign      text,
  lt_content       text,
  lt_term          text,
  lt_fbclid        text,
  lt_gclid         text,
  lt_referrer      text,
  lt_landing_page  text,
  lt_seen_at       timestamptz,

  in_app           text,

  manual_channel   text CHECK (manual_channel IN ('messenger','instagram','whatsapp','phone','store','other')),
  manual_note      text,
  manual_set_by    uuid,
  manual_set_at    timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_attribution_cart_id
  ON public.order_attribution (cart_id);

ALTER TABLE public.order_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage order_attribution" ON public.order_attribution;
CREATE POLICY "Admins manage order_attribution"
  ON public.order_attribution FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. record_order_attribution(p_order_id, p) — called by anon / authenticated
-- ───────────────────────────────────────────────────────────────────────────
-- p = { ft: {source, medium, campaign, content, term, fbclid, gclid, referrer,
--            landing_page, ts}, lt: {…same…}, in_app }   (ts = epoch ms)
-- Only for orders created in the last 6 hours; first write wins
-- (ON CONFLICT DO NOTHING); never raises — any error is swallowed so a bad
-- payload can never surface to the storefront.
CREATE OR REPLACE FUNCTION public.record_order_attribution(p_order_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart_id    uuid;
  v_created_at timestamptz;
  v_ft         jsonb;
  v_lt         jsonb;
  v_ft_ts      text;
  v_lt_ts      text;
BEGIN
  SELECT o.cart_id, o.created_at
    INTO v_cart_id, v_created_at
    FROM public.orders o
   WHERE o.id = p_order_id;

  IF NOT FOUND OR v_created_at < now() - interval '6 hours' THEN
    RETURN;
  END IF;

  v_ft := CASE WHEN jsonb_typeof(p->'ft') = 'object' THEN p->'ft' ELSE '{}'::jsonb END;
  v_lt := CASE WHEN jsonb_typeof(p->'lt') = 'object' THEN p->'lt' ELSE '{}'::jsonb END;
  v_ft_ts := v_ft->>'ts';
  v_lt_ts := v_lt->>'ts';

  INSERT INTO public.order_attribution (
    order_id, cart_id,
    ft_source, ft_medium, ft_campaign, ft_content, ft_term,
    ft_fbclid, ft_gclid, ft_referrer, ft_landing_page, ft_seen_at,
    lt_source, lt_medium, lt_campaign, lt_content, lt_term,
    lt_fbclid, lt_gclid, lt_referrer, lt_landing_page, lt_seen_at,
    in_app
  ) VALUES (
    p_order_id, v_cart_id,
    left(v_ft->>'source', 200), left(v_ft->>'medium', 200), left(v_ft->>'campaign', 200),
    left(v_ft->>'content', 200), left(v_ft->>'term', 200),
    left(v_ft->>'fbclid', 300), left(v_ft->>'gclid', 300),
    left(v_ft->>'referrer', 300), left(v_ft->>'landing_page', 300),
    CASE WHEN v_ft_ts ~ '^[0-9]{10,14}(\.[0-9]+)?$' THEN to_timestamp(v_ft_ts::numeric / 1000.0) END,
    left(v_lt->>'source', 200), left(v_lt->>'medium', 200), left(v_lt->>'campaign', 200),
    left(v_lt->>'content', 200), left(v_lt->>'term', 200),
    left(v_lt->>'fbclid', 300), left(v_lt->>'gclid', 300),
    left(v_lt->>'referrer', 300), left(v_lt->>'landing_page', 300),
    CASE WHEN v_lt_ts ~ '^[0-9]{10,14}(\.[0-9]+)?$' THEN to_timestamp(v_lt_ts::numeric / 1000.0) END,
    left(p->>'in_app', 40)
  )
  ON CONFLICT (order_id) DO NOTHING;
EXCEPTION WHEN others THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_attribution(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_order_attribution(uuid, jsonb) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY (run after applying)
-- ───────────────────────────────────────────────────────────────────────────
-- 1) Policy — expect exactly one row: "Admins manage order_attribution", cmd ALL, roles {authenticated}
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'order_attribution';
--
-- 2) Function — expect prosecdef = true; proacl lists anon=X and authenticated=X, no bare =X (PUBLIC)
-- SELECT p.proname, p.prosecdef, p.proacl, pg_get_function_identity_arguments(p.oid) AS args, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'record_order_attribution';
--
-- 3) Columns — expect 28 rows (order_id … created_at)
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'order_attribution'
--  ORDER BY ordinal_position;
