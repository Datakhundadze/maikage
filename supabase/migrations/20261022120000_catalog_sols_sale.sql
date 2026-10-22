-- Catalog SALE: move every catalog t-shirt design from GILDAN to Sol's.
--
-- NOT auto-applied. Run by hand in the Lovable SQL Editor, AFTER the
-- feat/catalog-sols-sale code is merged and Published (see order note below).
--
-- What it does (single transaction):
--   1. Adds the missing Sol's products row (slug tshirt-sols). Idempotent:
--      ON CONFLICT DO NOTHING covers both unique keys (slug, (type, sub_product)).
--   2. Re-points catalog_designs.default_product_id tshirt-gildan → tshirt-sols
--      (published and unpublished; hoodie designs are untouched).
--   3. Colours: keeps only Sol's colours on those rows.
--        a) a colour that already is a Sol's colour (any case) → canonical case
--           ('white' → 'White', 'black' → 'Black', …)
--        b) the 66 non-Sol's rows → White/Black per the print-contrast mapping
--        c) anything still not a Sol's colour → 'White' (expected: 0 rows)
--
-- Price: the 45₾ SALE price is NOT stored here. base_price = 50 is the regular
-- Sol's price (informational; checkout prices come from pricing.ts PRICES and
-- src/lib/catalogPromo.ts on the design page).
--
-- Order: Publish first, then this SQL. With the new code live and the old data,
-- design pages still show GILDAN (no sale) for a few minutes; the reverse order
-- would show Sol's at the full 50₾ until Publish.

BEGIN;

-- 1. Sol's products row (print area / sizes identical to tshirt-gildan)
INSERT INTO public.products (
  slug, type, sub_product, quality,
  display_name_ka, display_name_en,
  base_price,
  print_area_x, print_area_y, print_area_width, print_area_height,
  colors, sizes, is_active, display_order
) VALUES (
  'tshirt-sols', 'T-Shirt', 'Sol''s', 'standard',
  'Sol''s მაისური', 'Sol''s T-Shirt',
  50,
  35, 25, 30, 35,
  '[]'::jsonb, ARRAY['S','M','L','XL','XXL'], true, 0
)
ON CONFLICT DO NOTHING;

-- 2. Re-point catalog t-shirt designs GILDAN → Sol's
UPDATE public.catalog_designs
SET default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-sols')
WHERE default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-gildan')
  AND EXISTS (SELECT 1 FROM public.products WHERE slug = 'tshirt-sols');

-- 3a. Normalize case of colours that already are Sol's colours
UPDATE public.catalog_designs d
SET default_color = c.name
FROM (VALUES
  ('White'), ('Black'), ('Sol''s Khaki'), ('Sol''s Pink'), ('Sol''s Emerald'),
  ('Sol''s Electric'), ('Sol''s Navy'), ('Sol''s Ultramarine')
) AS c(name)
WHERE d.default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-sols')
  AND lower(d.default_color) = lower(c.name)
  AND d.default_color IS DISTINCT FROM c.name;

-- 3b. Print-contrast mapping for the non-Sol's colours
UPDATE public.catalog_designs d
SET default_color = m.target
FROM (VALUES
  -- White
  ('vepkhistqaosani','White'),('ar-mtsalia','White'),('kartveli','White'),('kartuli','White'),
  ('peisit-w','White'),('es-aris','White'),('dzaghli','White'),('khmarebashi-gaitsevs','White'),
  ('kotsna','White'),('skeiti','White'),('burgeri','White'),('khili','White'),('naqini1','White'),
  ('dizaini-1-6','White'),('dizaini1-8','White'),('1-6','White'),('dizaini17','White'),('1-7','White'),
  ('1-31','White'),('design-12-3','White'),('1-14','White'),('1-9','White'),('1-17','White'),
  ('design-12-1','White'),('dizaini1-2','White'),('dizaini1-6','White'),
  -- Black
  ('gasuli-var','Black'),('houm','Black'),('naqini','Black'),('gegma-b','Black'),('lamazi','Black'),
  ('datvi','Black'),('vazha','Black'),('peria','Black'),('mango','Black'),('sosisebi','Black'),
  ('sazamtro','Black'),('limoni','Black'),('lemonchelo','Black'),('avokado','Black'),('ludi','Black'),
  ('dasveneba','Black'),('banani','Black'),('mze','Black'),('martsqvi','Black'),('dino','Black'),
  ('tosti','Black'),('putkari','Black'),('dizaini-1-5','Black'),('tsomi','Black'),('vrepi','Black'),
  ('me-var-sakartvelo-1','Black'),('meksika','Black'),('dizaini-1-8','Black'),('dizaini1-4','Black'),
  ('roki','Black'),('zazuna','Black'),('dizaini25','Black'),('dizaini1-1','Black'),('dizaini-1-4','Black'),
  ('pirati','Black'),('design-12-2','Black'),('valentini','Black'),('popkorni','Black'),('vashlii','Black'),
  ('dizaini1-5','Black')
) AS m(slug, target)
WHERE d.slug = m.slug
  AND d.default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-sols');

-- 3c. Safety net: anything on Sol's still not a Sol's colour → White (expected 0 rows)
UPDATE public.catalog_designs
SET default_color = 'White'
WHERE default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-sols')
  AND (default_color IS NULL OR default_color NOT IN (
    'White','Black','Sol''s Khaki','Sol''s Pink','Sol''s Emerald',
    'Sol''s Electric','Sol''s Navy','Sol''s Ultramarine'
  ));

COMMIT;

-- ── Verify (run after apply) ─────────────────────────────────────────────────
--
-- V1. The new products row (expect 1 row, is_active = true, base_price 50):
--   SELECT id, slug, type, sub_product, quality, display_name_ka, display_name_en,
--          base_price, print_area_x, print_area_y, print_area_width, print_area_height,
--          colors, sizes, is_active, display_order
--   FROM public.products WHERE slug = 'tshirt-sols';
--
-- V2. Designs per product (expect tshirt-gildan: 0 rows;
--     tshirt-sols: 239 total = 232 published + 7 unpublished;
--     hoodie-gildan: 9, hoodie-premium-washed: 1 — unchanged):
--   SELECT p.slug, d.is_published, count(*)
--   FROM public.catalog_designs d LEFT JOIN public.products p ON p.id = d.default_product_id
--   GROUP BY 1, 2 ORDER BY 1, 2;
--
-- V3. Sol's designs whose colour is not a Sol's colour (expect 0):
--   SELECT count(*) FROM public.catalog_designs d
--   JOIN public.products p ON p.id = d.default_product_id
--   WHERE p.slug = 'tshirt-sols'
--     AND (d.default_color IS NULL OR d.default_color NOT IN (
--       'White','Black','Sol''s Khaki','Sol''s Pink','Sol''s Emerald',
--       'Sol''s Electric','Sol''s Navy','Sol''s Ultramarine'));
--
-- V4. Colour distribution on Sol's (expect published: White 120, Black 98,
--     Sol's Pink 7, Sol's Electric 4, Sol's Ultramarine 2, Sol's Emerald 1;
--     unpublished: White 6, Sol's Ultramarine 1):
--   SELECT d.is_published, d.default_color, count(*)
--   FROM public.catalog_designs d JOIN public.products p ON p.id = d.default_product_id
--   WHERE p.slug = 'tshirt-sols' GROUP BY 1, 2 ORDER BY 1, 3 DESC;
--
-- Rollback (if ever needed — colours would stay Sol's colours):
--   UPDATE public.catalog_designs
--   SET default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-gildan')
--   WHERE default_product_id = (SELECT id FROM public.products WHERE slug = 'tshirt-sols');
