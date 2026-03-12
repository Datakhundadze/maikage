ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS bog_order_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;