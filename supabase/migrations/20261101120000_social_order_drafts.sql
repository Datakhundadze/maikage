-- Social DM bot: order drafts (meta-webhook orderDraft.ts / orderFlow.ts).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor BEFORE redeploying meta-webhook.
-- Lovable does NOT auto-apply migrations; this file is the repo record.
-- Without this table the webhook's draft read fails and the bot behaves
-- exactly as before (no draft, no order rules for the model).
--
-- WHAT. One row per conversation while an order is being put together:
--   items          every sketch the bot sent, grouped per product / brand /
--                  colour, with each side's design source and sketch JPEG URL
--   lines          the priced order lines of the summary the customer saw
--                  (item number, size, qty, unit price — computed in code)
--   delivery_type / delivery_price / total   the same summary's totals
--   customer       phone / email (captured in code from the raw DM text),
--                  name, address — PII, admin-only
--   receipt        reserved for the next step (bank transfer receipt)
--   cart_id        set when the order is confirmed = orders.cart_id of the
--                  rows created for it; NULL → not yet an order
--   status         collecting → confirmed (claimed, rows being written) →
--                  awaiting_payment → receipt_received → approved | cancelled
--
-- ONE OPEN DRAFT PER CONVERSATION: the partial unique index below. Open =
-- collecting / confirmed / awaiting_payment / receipt_received.
--
-- WHO CAN TOUCH IT: the edge function's service role (bypasses RLS); admins
-- (has_role(auth.uid(), 'admin')) read and write; nobody else (no policy).
--
-- Deviation from the plan: one extra column, `lines`, so the confirmation can
-- be checked against exactly the summary the customer was shown.

CREATE TABLE IF NOT EXISTS public.social_order_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key text NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('messenger', 'instagram')),
  status           text NOT NULL DEFAULT 'collecting'
                   CHECK (status IN ('collecting', 'confirmed', 'awaiting_payment', 'receipt_received', 'approved', 'cancelled')),
  items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  lines            jsonb,
  delivery_type    text CHECK (delivery_type IN ('pickup', 'courier_tbilisi', 'courier_outside')),
  delivery_price   numeric,
  total            numeric,
  customer         jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt          jsonb,
  cart_id          uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_order_drafts_one_open
  ON public.social_order_drafts (conversation_key)
  WHERE status IN ('collecting', 'confirmed', 'awaiting_payment', 'receipt_received');

CREATE UNIQUE INDEX IF NOT EXISTS social_order_drafts_cart_id
  ON public.social_order_drafts (cart_id)
  WHERE cart_id IS NOT NULL;

ALTER TABLE public.social_order_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage social_order_drafts" ON public.social_order_drafts;
CREATE POLICY "Admins manage social_order_drafts"
  ON public.social_order_drafts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY (run after applying)
-- ───────────────────────────────────────────────────────────────────────────
-- 1) Columns — expect 14 rows (id … updated_at)
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'social_order_drafts'
--  ORDER BY ordinal_position;
--
-- 2) RLS on + exactly one policy: "Admins manage social_order_drafts", cmd ALL, roles {authenticated}
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_order_drafts'::regclass;   -- expect true
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'social_order_drafts';
--
-- 3) Indexes — expect social_order_drafts_pkey, social_order_drafts_one_open (partial, UNIQUE),
--    social_order_drafts_cart_id (partial, UNIQUE)
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE schemaname = 'public' AND tablename = 'social_order_drafts';
--
-- 4) CHECKs — expect channel, status, delivery_type
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.social_order_drafts'::regclass AND contype = 'c';
--
-- AFTER A TEST ORDER (admin):
-- SELECT id, status, jsonb_array_length(items) AS items, lines, delivery_type, total, cart_id, updated_at
--   FROM public.social_order_drafts ORDER BY updated_at DESC LIMIT 5;
-- SELECT id, product, sub_product, color, size, product_price, delivery_price, total_price,
--        payment_provider, payment_status, status, front_mockup_url IS NOT NULL AS mockup,
--        transparent_image_url IS NOT NULL AS print_front, back_transparent_image_url IS NOT NULL AS print_back
--   FROM public.orders WHERE payment_provider = 'bank_transfer' ORDER BY created_at DESC LIMIT 10;
-- SELECT cart_id, SUM(total_price) FROM public.orders WHERE payment_provider = 'bank_transfer'
--  GROUP BY cart_id ORDER BY MAX(created_at) DESC LIMIT 5;   -- = social_order_drafts.total
-- SELECT order_id, manual_channel, manual_note FROM public.order_attribution
--  WHERE manual_note = 'bot' ORDER BY created_at DESC LIMIT 10;
