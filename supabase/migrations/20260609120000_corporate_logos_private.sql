-- Step 2 of securing corporate-logos (DB only).
--
-- Step 1 (already live) switched AdminCorporate to read logos via
-- createSignedUrl, so admins keep working once the bucket is private.
-- This migration narrows logo READ to admins and flips the bucket private
-- with a 5 MB upload cap. The guest B2B upload path
-- ("Anyone can upload logos") is intentionally left untouched.
--
-- has_role(auth.uid(), 'admin'::app_role) mirrors the admin check used by
-- the existing catalog-designs storage policies.

-- 1. Narrow logo read to admin-only (was public/anon)
DROP POLICY IF EXISTS "Public can view logos" ON storage.objects;
CREATE POLICY "Admin can view logos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'corporate-logos' AND has_role(auth.uid(), 'admin'::app_role));

-- 2. Make bucket private + cap file size at 5 MB
UPDATE storage.buckets
  SET public = false, file_size_limit = 5242880
  WHERE id = 'corporate-logos';
