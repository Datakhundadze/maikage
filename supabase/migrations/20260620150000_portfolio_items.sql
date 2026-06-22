-- Portfolio gallery (completes the trust trio; mirrors the showroom_photos recipe).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Creates a public table + a public
-- storage bucket, both admin-writable, mirroring the showroom-photos / partners
-- conventions already live on prod.
--
-- public.portfolio_items backs the gallery on the public /portfolio page (active
-- rows, sort_order ASC, grouped/filtered by category) and the admin "პორტფოლიო"
-- tab (full CRUD). Images are uploaded later via the admin tab into the public
-- 'portfolio' bucket; portfolio_items.image_path stores the object path resolved
-- with getPublicUrl. category groups the gallery; alt_text feeds each <img>'s alt
-- attribute for SEO.
--
-- RLS mirrors public.showroom_photos: public SELECT is scoped to active = true;
-- all writes are gated by has_role(auth.uid(), 'admin'). The BEFORE UPDATE
-- trigger reuses the existing public.set_updated_at_now().

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portfolio_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text,
  image_path  text NOT NULL,
  category    text,
  alt_text    text,
  sort_order  int DEFAULT 0,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- updated_at trigger (reuses the schema-wide helper from catalog_schema).
DROP TRIGGER IF EXISTS portfolio_items_set_updated_at ON public.portfolio_items;
CREATE TRIGGER portfolio_items_set_updated_at
  BEFORE UPDATE ON public.portfolio_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- 2. Row level security ------------------------------------------------------
ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active portfolio items" ON public.portfolio_items;
CREATE POLICY "Public can read active portfolio items"
  ON public.portfolio_items FOR SELECT
  USING (active = true);

DROP POLICY IF EXISTS "Admins can manage portfolio items" ON public.portfolio_items;
CREATE POLICY "Admins can manage portfolio items"
  ON public.portfolio_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Storage bucket ----------------------------------------------------------
-- Public bucket, 10 MB cap, JPEG/PNG/WEBP only (mirrors showroom-photos).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'portfolio',
  'portfolio',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Public read, admin-only write — scoped to bucket_id so other buckets are
-- unaffected (mirrors the showroom-photos storage policies).
DROP POLICY IF EXISTS "Public read portfolio" ON storage.objects;
CREATE POLICY "Public read portfolio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'portfolio');

DROP POLICY IF EXISTS "Admins write portfolio" ON storage.objects;
CREATE POLICY "Admins write portfolio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'portfolio' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update portfolio" ON storage.objects;
CREATE POLICY "Admins update portfolio"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'portfolio' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete portfolio" ON storage.objects;
CREATE POLICY "Admins delete portfolio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'portfolio' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. Expose the new table to PostgREST --------------------------------------
NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--   -- bucket is public with the right cap + mime types:
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'portfolio';
--   -- expect: public = true, file_size_limit = 10485760,
--   --         allowed_mime_types = {image/jpeg,image/png,image/webp}
--
--   -- table exists with RLS enabled:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'portfolio_items' AND relnamespace = 'public'::regnamespace;
--   -- expect: relrowsecurity = true
--
--   -- policy counts (2 on the table, 4 on storage for this bucket):
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'portfolio_items';   -- expect 2
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname LIKE '%portfolio%';                              -- expect 4
