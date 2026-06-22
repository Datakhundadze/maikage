-- Showroom / Contact-Visit photo gallery (mirrors the partners CMS recipe).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Creates a public table + a public
-- storage bucket, both admin-writable, mirroring the partners / catalog-designs
-- conventions already live on prod.
--
-- public.showroom_photos backs the photo gallery on the public /contact page
-- (active rows, sort_order ASC) and the admin "შოურუმი" tab (full CRUD). Photos
-- are uploaded later via the admin tab into the public 'showroom-photos' bucket;
-- showroom_photos.photo_path stores the object path resolved with getPublicUrl.
--
-- RLS mirrors public.products / public.catalog_designs: public SELECT is scoped
-- to active = true; all writes are gated by has_role(auth.uid(), 'admin'). The
-- BEFORE UPDATE trigger reuses the existing public.set_updated_at_now().

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.showroom_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  photo_path  text NOT NULL,
  sort_order  int DEFAULT 0,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- updated_at trigger (reuses the schema-wide helper from catalog_schema).
DROP TRIGGER IF EXISTS showroom_photos_set_updated_at ON public.showroom_photos;
CREATE TRIGGER showroom_photos_set_updated_at
  BEFORE UPDATE ON public.showroom_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- 2. Row level security ------------------------------------------------------
ALTER TABLE public.showroom_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active showroom photos" ON public.showroom_photos;
CREATE POLICY "Public can read active showroom photos"
  ON public.showroom_photos FOR SELECT
  USING (active = true);

DROP POLICY IF EXISTS "Admins can manage showroom photos" ON public.showroom_photos;
CREATE POLICY "Admins can manage showroom photos"
  ON public.showroom_photos FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Storage bucket ----------------------------------------------------------
-- Public bucket, 10 MB cap, JPEG/PNG/WEBP only (mirrors partner-logos minus SVG).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'showroom-photos',
  'showroom-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Public read, admin-only write — scoped to bucket_id so other buckets are
-- unaffected (mirrors the catalog-designs storage policies).
DROP POLICY IF EXISTS "Public read showroom-photos" ON storage.objects;
CREATE POLICY "Public read showroom-photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'showroom-photos');

DROP POLICY IF EXISTS "Admins write showroom-photos" ON storage.objects;
CREATE POLICY "Admins write showroom-photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'showroom-photos' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update showroom-photos" ON storage.objects;
CREATE POLICY "Admins update showroom-photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'showroom-photos' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete showroom-photos" ON storage.objects;
CREATE POLICY "Admins delete showroom-photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'showroom-photos' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. Expose the new table to PostgREST --------------------------------------
NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--   -- bucket is public with the right cap + mime types:
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'showroom-photos';
--   -- expect: public = true, file_size_limit = 10485760,
--   --         allowed_mime_types = {image/jpeg,image/png,image/webp}
--
--   -- table exists with RLS enabled:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'showroom_photos' AND relnamespace = 'public'::regnamespace;
--   -- expect: relrowsecurity = true
--
--   -- policy counts (2 on the table, 4 on storage for this bucket):
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'showroom_photos';   -- expect 2
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname LIKE '%showroom-photos%';                        -- expect 4
