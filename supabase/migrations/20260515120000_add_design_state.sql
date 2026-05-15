-- Structured editor state for orders.
--
-- Stores everything needed to re-render the customer's design at admin
-- time: per-side photo transforms, text styling, and the placement zone
-- snapshot. Until now only rendered PNGs and a free-text prompt were
-- persisted, which meant rotated/repositioned layouts could not be
-- reproduced once the saved mockup was generated.
--
-- Existing orders predate this column and remain NULL — the admin panel
-- falls back to the rendered mockup PNGs when design_state is absent.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS design_state JSONB;
