-- Activate the four inactive hoodie products rows so the /design/:slug
-- product switcher can offer them (feat/catalog-product-switch-fast-checkout).
--
-- NOT auto-applied. Run by hand in the Lovable SQL Editor, AFTER the branch is
-- merged and Published. (Before Publish nothing reads them on the storefront;
-- the only visible effect would be 4 extra options in the admin catalog
-- upload dropdowns.) Safe either way: the design page hides a chip whose row
-- is missing / inactive.
--
-- base_price = pricing.ts PRICES[sub].frontOnly. It is informational (admin
-- tables / dropdown labels); checkout prices come from pricing.ts via
-- calculatePrice, not from this column.
--   JEL Standard Hoodie  85
--   JEL Standard Zipper  95
--   JEL Zipper          105
--   GILDAN Bomber        70
--
-- Idempotent: re-running updates 0 rows. Each UPDATE is pinned to slug AND
-- type AND sub_product so a renamed/repurposed row is never touched.

BEGIN;

UPDATE public.products SET is_active = true, base_price = 85, updated_at = now()
 WHERE slug = 'hoodie-jel-standard' AND type = 'Hoodie' AND sub_product = 'JEL Standard Hoodie'
   AND (is_active IS DISTINCT FROM true OR base_price IS DISTINCT FROM 85);

UPDATE public.products SET is_active = true, base_price = 95, updated_at = now()
 WHERE slug = 'hoodie-jel-standard-zipper' AND type = 'Hoodie' AND sub_product = 'JEL Standard Zipper'
   AND (is_active IS DISTINCT FROM true OR base_price IS DISTINCT FROM 95);

UPDATE public.products SET is_active = true, base_price = 105, updated_at = now()
 WHERE slug = 'hoodie-jel-zipper' AND type = 'Hoodie' AND sub_product = 'JEL Zipper'
   AND (is_active IS DISTINCT FROM true OR base_price IS DISTINCT FROM 105);

UPDATE public.products SET is_active = true, base_price = 70, updated_at = now()
 WHERE slug = 'hoodie-gildan-bomber' AND type = 'Hoodie' AND sub_product = 'GILDAN Bomber'
   AND (is_active IS DISTINCT FROM true OR base_price IS DISTINCT FROM 70);

COMMIT;

-- Verify (expect 6 rows, all is_active = true, prices 80/95/85/95/105/70):
-- SELECT slug, sub_product, base_price, is_active
--   FROM public.products WHERE type = 'Hoodie' ORDER BY display_order, slug;
