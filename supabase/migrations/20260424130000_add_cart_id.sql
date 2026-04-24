-- Cart support: multiple orders placed together share the same cart_id so
-- a single BOG payment can cover the whole cart and the admin panel can
-- group them. Nullable so single-item checkouts keep working unchanged.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cart_id UUID;

CREATE INDEX IF NOT EXISTS orders_cart_id_idx ON public.orders (cart_id);
