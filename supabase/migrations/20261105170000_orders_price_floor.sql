-- Server-side price floor for browser-inserted orders (security review 2026-11-05).
-- ✅ APPLIED on prod 2026-11-05 (Claude, David's GO) and verified (rolled back):
--   anon GILDAN Hoodie at 1 ₾ → blocked (22023); legit hoodie 80 ₾ courier → ok;
--   catalog SALE Sol's 45 ₾ → ok. Replay of all 366 orders of the last 120 days:
--   0 below floor, 0 unknown keys, 0 total_price < product_price.
--
-- WHY: product_price / total_price are computed in the browser and payment
-- validation only compares the paid amount with SUM(total_price), so editing
-- the insert let a customer pay 1 ₾ for a hoodie (and every paid order is made).
--
-- RULE: for anon/authenticated non-admin inserts, product_price must be ≥ the
-- floor for its price key (sub_product, or product when they are equal) and
-- total_price ≥ product_price. Floors = floor(0.75 × lowest legit price) from
-- src/lib/pricing.ts PRICES (catalog SALE included): wide enough for an old
-- open tab or a small price change, far below what tampering needs. Unknown
-- key → 15 ₾. Admins (showroom orders) and service_role (DM bot) are exempt.
-- src/test/priceFloors.test.ts fails CI when a PRICES key is added or a price
-- drops below its floor ÷ 0.75 — then update this table (admins can edit it).

CREATE TABLE IF NOT EXISTS public.price_floors (
  price_key text PRIMARY KEY,
  min_price integer NOT NULL CHECK (min_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.price_floors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read price floors" ON public.price_floors;
CREATE POLICY "Anyone can read price floors" ON public.price_floors FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage price floors" ON public.price_floors;
CREATE POLICY "Admins manage price floors" ON public.price_floors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.price_floors (price_key, min_price) VALUES
 ('GILDAN',26),('Sol''s',33),('GILDAN HUMMER',45),('TH',33),('GIORDANO',52),('JEL T-Shirt',52),('Khundadze',41),('Polo',33),('NIKE',75),('Oversize',52),('GILDAN KIDS',26),('GILDAN Hoodie',60),('Premium Washed Hoodie',71),('JEL Standard Hoodie',63),('JEL Standard Zipper',71),('JEL Zipper',78),('GILDAN Bomber',52),('Sport Set',48),('Tote Bag',26),('Apron',33),('Mug',18),('Cap',18),('Phone Case',15)
ON CONFLICT (price_key) DO UPDATE SET min_price = EXCLUDED.min_price, updated_at = now();

CREATE OR REPLACE FUNCTION public.orders_guard_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_floor integer;
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    v_key := CASE WHEN NEW.sub_product IS NULL OR NEW.sub_product = NEW.product
                  THEN NEW.product ELSE NEW.sub_product END;
    SELECT min_price INTO v_floor FROM public.price_floors WHERE price_key = v_key;
    v_floor := COALESCE(v_floor, 15);
    IF COALESCE(NEW.product_price, 0) < v_floor THEN
      RAISE EXCEPTION 'ფასი არასწორია — განაახლეთ გვერდი და სცადეთ თავიდან (price check failed)'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NEW.total_price, 0) < COALESCE(NEW.product_price, 0)
       OR COALESCE(NEW.delivery_price, 0) < 0 THEN
      RAISE EXCEPTION 'ფასი არასწორია — განაახლეთ გვერდი და სცადეთ თავიდან (price check failed)'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_guard_price ON public.orders;
CREATE TRIGGER orders_guard_price
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard_price();

-- Verify:
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal;
-- SELECT * FROM public.price_floors ORDER BY price_key;
