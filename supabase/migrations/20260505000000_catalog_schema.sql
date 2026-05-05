-- Catalog feature schema (Phase 1)
--
-- Two new tables:
--   * products          — one row per (type, sub_product) pairing from src/lib/catalog.ts.
--                         Sub_product is the brand (GILDAN, TH, JEL T-Shirt …) so the
--                         table grows as we add brands without schema changes.
--   * catalog_designs   — admin-curated pre-made designs displayed on the public
--                         catalog. Distinct from the existing user-generated
--                         `designs` table (which serves /community via is_published
--                         on user uploads).
--
-- Coexists with src/lib/catalog.ts. Studio still reads from the static catalog;
-- the new tables only feed the catalog feature for now.

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,

  -- Type matches src/lib/catalog.ts ProductType ('T-Shirt', 'Hoodie', 'Tote Bag',
  -- 'Cap', 'Apron', 'Phone Case', 'Mug', 'Sport'). Sub_product is the brand
  -- (NULL for products without brands like Tote Bag/Cap/Apron/Mug).
  type TEXT NOT NULL,
  sub_product TEXT,

  quality TEXT NOT NULL DEFAULT 'standard',
  display_name_ka TEXT NOT NULL,
  display_name_en TEXT,
  description_ka TEXT,
  description_en TEXT,
  base_price NUMERIC,

  -- Print area as percentages of the mockup image, top-left origin.
  -- Defaults match catalog.ts DEFAULT_FRONT (centre 0.5, 0.42 with scale 0.38).
  print_area_x NUMERIC NOT NULL DEFAULT 31,
  print_area_y NUMERIC NOT NULL DEFAULT 23,
  print_area_width NUMERIC NOT NULL DEFAULT 38,
  print_area_height NUMERIC NOT NULL DEFAULT 38,

  -- colors: array of {name, hex, mockup_url, is_default} objects
  colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  sizes TEXT[] NOT NULL DEFAULT ARRAY['S','M','L','XL','XXL'],

  -- Fallback mockup if a color has no mockup_url
  mockup_image_url TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (type, sub_product)
);

CREATE TABLE IF NOT EXISTS public.catalog_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,

  title_ka TEXT NOT NULL,
  title_en TEXT,
  description_ka TEXT,
  description_en TEXT,
  meta_description_ka TEXT,
  meta_description_en TEXT,

  print_file_url TEXT NOT NULL,
  thumbnail_url TEXT,

  default_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  default_color TEXT DEFAULT 'White',

  category TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',

  is_published BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,

  view_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,

  ai_generated BOOLEAN NOT NULL DEFAULT false,
  ai_prompt TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_type ON public.products(type);
CREATE INDEX IF NOT EXISTS idx_products_sub_product ON public.products(sub_product);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON public.products(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_catalog_designs_slug ON public.catalog_designs(slug);
CREATE INDEX IF NOT EXISTS idx_catalog_designs_published ON public.catalog_designs(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_catalog_designs_category ON public.catalog_designs(category);
CREATE INDEX IF NOT EXISTS idx_catalog_designs_tags ON public.catalog_designs USING gin(tags);

-- updated_at triggers (mirror the rest of the schema's pattern)
CREATE OR REPLACE FUNCTION public.set_updated_at_now()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS catalog_designs_set_updated_at ON public.catalog_designs;
CREATE TRIGGER catalog_designs_set_updated_at
  BEFORE UPDATE ON public.catalog_designs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- Row level security: public reads only the active/published rows; writes are
-- gated by has_role(auth.uid(), 'admin') to match the rest of the schema.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active products" ON public.products;
CREATE POLICY "Public can read active products"
  ON public.products FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
CREATE POLICY "Admins can manage products"
  ON public.products FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Public can read published designs" ON public.catalog_designs;
CREATE POLICY "Public can read published designs"
  ON public.catalog_designs FOR SELECT
  USING (is_published = true);

DROP POLICY IF EXISTS "Admins can manage catalog designs" ON public.catalog_designs;
CREATE POLICY "Admins can manage catalog designs"
  ON public.catalog_designs FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Storage: catalog-designs is new, products already exists from a previous migration.
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalog-designs', 'catalog-designs', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for both buckets, admin-only write for both. We scope each
-- policy to a specific bucket_id so other buckets aren't affected.
DROP POLICY IF EXISTS "Public read catalog-designs" ON storage.objects;
CREATE POLICY "Public read catalog-designs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'catalog-designs');

DROP POLICY IF EXISTS "Admins write catalog-designs" ON storage.objects;
CREATE POLICY "Admins write catalog-designs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'catalog-designs' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update catalog-designs" ON storage.objects;
CREATE POLICY "Admins update catalog-designs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'catalog-designs' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete catalog-designs" ON storage.objects;
CREATE POLICY "Admins delete catalog-designs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'catalog-designs' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Public read products bucket" ON storage.objects;
CREATE POLICY "Public read products bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'products');

DROP POLICY IF EXISTS "Admins write products bucket" ON storage.objects;
CREATE POLICY "Admins write products bucket"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'products' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update products bucket" ON storage.objects;
CREATE POLICY "Admins update products bucket"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'products' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete products bucket" ON storage.objects;
CREATE POLICY "Admins delete products bucket"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'products' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Seed: products mirroring src/lib/catalog.ts SUB_PRODUCTS / BRAND_COLORS /
-- BRAND_SIZES at this snapshot. base_price is left NULL (admin will fill in).
-- Phone Case is intentionally skipped (Phase 2). ON CONFLICT keeps re-runs idempotent.
INSERT INTO public.products (slug, type, sub_product, display_name_ka, display_name_en, sizes, colors, display_order)
VALUES
  -- T-Shirts
  ('tshirt-gildan',         'T-Shirt', 'GILDAN',         'GILDAN მაისური',          'GILDAN T-Shirt',         ARRAY['S','M','L','XL','XXL','XXXL','XXXXL'], '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Beige","hex":"#F5F0DC"},{"name":"Light Gray","hex":"#C8C8C8"},{"name":"Red","hex":"#E21818"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Yellow","hex":"#FFD700"},{"name":"Orange","hex":"#FF8C00"},{"name":"Light Blue","hex":"#87CEEB"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Burgundy","hex":"#800020"},{"name":"Gray","hex":"#808080"},{"name":"Lime","hex":"#32CD32"},{"name":"Purple","hex":"#800080"}]'::jsonb, 10),
  ('tshirt-gildan-hummer',  'T-Shirt', 'GILDAN HUMMER',  'GILDAN HUMMER მაისური',   'GILDAN HUMMER T-Shirt',  ARRAY['S','M','L','XL','XXL'],                 '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Light Gray Melange","hex":"#B8B8B8"}]'::jsonb, 11),
  ('tshirt-th',             'T-Shirt', 'TH',             'TH მაისური',              'TH T-Shirt',             ARRAY['S','M','L','XL','XXL'],                 '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"}]'::jsonb, 12),
  ('tshirt-jel',            'T-Shirt', 'JEL T-Shirt',    'JEL მაისური',             'JEL T-Shirt',            ARRAY['S','M','L','XL','XXL','XXXL'],          '[{"name":"Black","hex":"#000000"},{"name":"Purple","hex":"#800080"},{"name":"Gray","hex":"#808080"},{"name":"Light Cream","hex":"#FFF8E7"},{"name":"Pink","hex":"#FF69B4"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Khaki","hex":"#C3B091"},{"name":"Brown","hex":"#654321"}]'::jsonb, 13),
  ('tshirt-giordano',       'T-Shirt', 'GIORDANO',       'GIORDANO მაისური',        'GIORDANO T-Shirt',       ARRAY['S','M','L','XL','XXL','XXXL'],          '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"}]'::jsonb, 14),
  ('tshirt-khundadze',      'T-Shirt', 'Khundadze',      'Khundadze მაისური',       'Khundadze T-Shirt',      ARRAY['S','M','L','XL','XXL'],                 '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"}]'::jsonb, 15),
  ('tshirt-nike',           'T-Shirt', 'NIKE',           'NIKE მაისური',            'NIKE T-Shirt',           ARRAY['S','M','L','XL','XXL'],                 '[{"name":"Dark Navy","hex":"#0A1128"},{"name":"White","hex":"#FFFFFF"},{"name":"Cream","hex":"#FFFDD0"}]'::jsonb, 16),
  ('tshirt-polo',           'T-Shirt', 'Polo',           'Polo მაისური',            'Polo T-Shirt',           ARRAY['S','M','L','XL','XXL','XXXL'],          '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Beige","hex":"#F5F0DC"},{"name":"Light Gray","hex":"#C8C8C8"},{"name":"Red","hex":"#E21818"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Yellow","hex":"#FFD700"},{"name":"Orange","hex":"#FF8C00"},{"name":"Light Blue","hex":"#87CEEB"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Burgundy","hex":"#800020"},{"name":"Gray","hex":"#808080"},{"name":"Lime","hex":"#32CD32"},{"name":"Purple","hex":"#800080"}]'::jsonb, 17),
  ('tshirt-oversize',       'T-Shirt', 'Oversize',       'Oversize მაისური',        'Oversize T-Shirt',       ARRAY[]::TEXT[],                                '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"}]'::jsonb, 18),
  ('tshirt-gildan-kids',    'T-Shirt', 'GILDAN KIDS',    'GILDAN ბავშვის მაისური',  'GILDAN KIDS T-Shirt',    ARRAY['3/4 წელი','5/6 წელი','7/8 წელი','9/11 წელი'], '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Beige","hex":"#F5F0DC"},{"name":"Light Gray","hex":"#C8C8C8"},{"name":"Red","hex":"#E21818"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Yellow","hex":"#FFD700"},{"name":"Orange","hex":"#FF8C00"},{"name":"Light Blue","hex":"#87CEEB"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Burgundy","hex":"#800020"},{"name":"Gray","hex":"#808080"},{"name":"Lime","hex":"#32CD32"},{"name":"Purple","hex":"#800080"}]'::jsonb, 19),

  -- Hoodies (catalog.ts HOODIE_FRONT placement: x 0.50, y 0.51, scale 0.28)
  ('hoodie-gildan',                'Hoodie', 'GILDAN Hoodie',          'GILDAN ჰუდი',           'GILDAN Hoodie',           ARRAY['S','M','L','XL','XXL'], '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Beige","hex":"#F5F0DC"},{"name":"Light Gray","hex":"#C8C8C8"},{"name":"Red","hex":"#E21818"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Yellow","hex":"#FFD700"},{"name":"Orange","hex":"#FF8C00"},{"name":"Light Blue","hex":"#87CEEB"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Burgundy","hex":"#800020"},{"name":"Gray","hex":"#808080"},{"name":"Lime","hex":"#32CD32"},{"name":"Purple","hex":"#800080"}]'::jsonb, 20),
  ('hoodie-premium-washed',        'Hoodie', 'Premium Washed Hoodie',  'Premium Washed ჰუდი',   'Premium Washed Hoodie',   ARRAY['S','M','L','XL','XXL'], '[{"name":"Black","hex":"#000000"},{"name":"Gray","hex":"#808080"},{"name":"Khaki","hex":"#C3B091"},{"name":"Pink","hex":"#FF69B4"},{"name":"Purple","hex":"#800080"}]'::jsonb, 21),
  ('hoodie-jel-standard',          'Hoodie', 'JEL Standard Hoodie',    'JEL Standard ჰუდი',     'JEL Standard Hoodie',     ARRAY['S','M','L','XL','XXL'], '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Red","hex":"#E21818"},{"name":"Burgundy","hex":"#800020"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Light Gray","hex":"#C8C8C8"}]'::jsonb, 22),
  ('hoodie-jel-zipper',            'Hoodie', 'JEL Zipper',             'JEL Zipper ჰუდი',       'JEL Zipper Hoodie',       ARRAY['S','M','L','XL','XXL'], '[{"name":"Black","hex":"#000000"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Gray","hex":"#808080"}]'::jsonb, 23),
  ('hoodie-jel-standard-zipper',   'Hoodie', 'JEL Standard Zipper',    'JEL Standard Zipper',   'JEL Standard Zipper',     ARRAY['S','M','L','XL','XXL'], '[{"name":"Black","hex":"#000000"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Light Gray Melange","hex":"#B8B8B8"},{"name":"Blue","hex":"#2563EB"}]'::jsonb, 24),
  ('hoodie-gildan-bomber',         'Hoodie', 'GILDAN Bomber',          'GILDAN Bomber ჰუდი',    'GILDAN Bomber Hoodie',    ARRAY['S','M','L','XL','XXL'], '[{"name":"Black","hex":"#000000"},{"name":"White","hex":"#FFFFFF"},{"name":"Red","hex":"#E21818"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Brown","hex":"#654321"}]'::jsonb, 25),

  -- Sport (catalog.ts SHORTS_FRONT placement: x 0.50, y 0.28, scale 0.22)
  ('sport-set', 'Sport', 'Sport Set', 'სპორტული კომპლექტი', 'Sport Set', ARRAY['S','M','L','XL','XXL'], '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Beige","hex":"#F5F0DC"},{"name":"Light Gray","hex":"#C8C8C8"},{"name":"Red","hex":"#E21818"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Yellow","hex":"#FFD700"},{"name":"Orange","hex":"#FF8C00"},{"name":"Light Blue","hex":"#87CEEB"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Burgundy","hex":"#800020"},{"name":"Gray","hex":"#808080"},{"name":"Lime","hex":"#32CD32"},{"name":"Purple","hex":"#800080"}]'::jsonb, 30),

  -- Standalone products (no sub-product)
  ('tote-bag', 'Tote Bag', NULL, 'ჩანთა',  'Tote Bag', ARRAY[]::TEXT[],                  '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Cream","hex":"#FFFDD0"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Turquoise","hex":"#40E0D0"},{"name":"Green","hex":"#228B22"},{"name":"Lime","hex":"#32CD32"},{"name":"Pink","hex":"#FF69B4"},{"name":"Red","hex":"#E21818"},{"name":"Burgundy","hex":"#800020"},{"name":"Purple","hex":"#800080"}]'::jsonb, 40),
  ('cap',      'Cap',      NULL, 'ქეპი',  'Cap',      ARRAY[]::TEXT[],                  '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"},{"name":"Beige","hex":"#F5F0DC"},{"name":"Light Gray","hex":"#C8C8C8"},{"name":"Red","hex":"#E21818"},{"name":"Electric Blue","hex":"#0066FF"},{"name":"Dark Navy","hex":"#0A1128"},{"name":"Yellow","hex":"#FFD700"},{"name":"Orange","hex":"#FF8C00"},{"name":"Light Blue","hex":"#87CEEB"},{"name":"Standard Blue","hex":"#4169E1"},{"name":"Burgundy","hex":"#800020"},{"name":"Gray","hex":"#808080"},{"name":"Lime","hex":"#32CD32"},{"name":"Purple","hex":"#800080"}]'::jsonb, 50),
  ('apron',    'Apron',    NULL, 'წინსაფარი', 'Apron', ARRAY[]::TEXT[],                  '[{"name":"White","hex":"#FFFFFF"},{"name":"Black","hex":"#000000"}]'::jsonb, 60),
  ('mug',      'Mug',      NULL, 'ჭიქა',  'Mug',      ARRAY[]::TEXT[],                  '[{"name":"White","hex":"#FFFFFF"}]'::jsonb, 70)
ON CONFLICT (slug) DO NOTHING;
