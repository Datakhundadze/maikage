-- Track which payment provider was used per order so admin can distinguish
-- BOG vs TBC orders and the correct callback handler runs.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'bog';
