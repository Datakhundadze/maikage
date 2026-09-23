-- designs bucket — STEP 0: make the repo match production. NO-OP when applied.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- WHY. A read-only audit on 2026-09-23 (pg_policies on storage.objects, live)
-- found the repo and production had drifted on this bucket:
--   - four live policies exist in NO migration file:
--       "Admins read designs order-originals"   SELECT, admin-only
--       "Public read designs cart-items"        SELECT, anon + authenticated
--       "Public read designs order-mockups"     SELECT, anon + authenticated
--       "Anyone can update order mockups"       UPDATE, anon + authenticated
--   - several repo policies do NOT exist live (they were superseded or never
--     applied — see 20260523190000's own header for the first documented case).
-- 20260924110000 (step 3) changes this state. It has to be written against
-- what is actually there, so this file records that state first.
--
-- WHAT THIS DOES ON PRODUCTION: nothing observable. Every DROP below targets a
-- policy that is already absent, and every DROP+CREATE pair re-creates a live
-- policy with its live definition (roles, USING, WITH CHECK). Verified by
-- comparing pg_policies before and after — the VERIFY block at the bottom is
-- that comparison. The bucket flag (public = true) is NOT touched.
--
-- On the has_role spelling: production stores the expression as
-- `has_role(auth.uid(), 'admin'::app_role)`; the schema-qualified form below
-- resolves to the same function and type and prints identically in
-- pg_get_expr under the default search_path.

-- 1. Repo-only policies that are ALREADY ABSENT live ---------------------------
DROP POLICY IF EXISTS "Public can view design images"            ON storage.objects; -- 20260226113811
DROP POLICY IF EXISTS "Users can upload own designs"             ON storage.objects; -- 20260226113811
DROP POLICY IF EXISTS "Anyone can upload generation images"      ON storage.objects; -- 20260318120000
DROP POLICY IF EXISTS "Public read designs bucket"               ON storage.objects; -- 20260319100000
DROP POLICY IF EXISTS "Authenticated users delete own objects"   ON storage.objects; -- 20260319100000
DROP POLICY IF EXISTS "Anyone can read generation images"        ON storage.objects; -- 20260319100726
DROP POLICY IF EXISTS "Anyone can read order mockups"            ON storage.objects; -- 20260319100732
DROP POLICY IF EXISTS "Anyone can upload order originals"        ON storage.objects; -- 20260422120000
DROP POLICY IF EXISTS "Anyone can list order originals"          ON storage.objects; -- 20260422120000
DROP POLICY IF EXISTS "Anyone can upload cart items"             ON storage.objects; -- 20260424140000
DROP POLICY IF EXISTS "Anyone can read cart items"               ON storage.objects; -- 20260424140000
DROP POLICY IF EXISTS "Allow all uploads to designs"             ON storage.objects; -- dropped by 20260523190000
DROP POLICY IF EXISTS "Allow authenticated delete from designs"  ON storage.objects; -- dropped by 20260523190000

-- 2. The eleven LIVE policies, re-stated exactly ------------------------------

-- INSERT
DROP POLICY IF EXISTS "Anyone can upload order mockups" ON storage.objects;
CREATE POLICY "Anyone can upload order mockups" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups');

DROP POLICY IF EXISTS "Anyone can upload to cart-items folder" ON storage.objects;
CREATE POLICY "Anyone can upload to cart-items folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'cart-items');

DROP POLICY IF EXISTS "Anyone can upload to generations folder" ON storage.objects;
CREATE POLICY "Anyone can upload to generations folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'generations');

DROP POLICY IF EXISTS "Anyone can upload to order-originals folder" ON storage.objects;
CREATE POLICY "Anyone can upload to order-originals folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-originals');

DROP POLICY IF EXISTS "Authenticated users upload own folder" ON storage.objects;
CREATE POLICY "Authenticated users upload own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- SELECT
DROP POLICY IF EXISTS "Admins read designs order-originals" ON storage.objects;
CREATE POLICY "Admins read designs order-originals" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-originals'
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Public read designs cart-items" ON storage.objects;
CREATE POLICY "Public read designs cart-items" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'cart-items');

DROP POLICY IF EXISTS "Public read designs order-mockups" ON storage.objects;
CREATE POLICY "Public read designs order-mockups" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups');

-- UPDATE
DROP POLICY IF EXISTS "Anyone can update order mockups" ON storage.objects;
CREATE POLICY "Anyone can update order mockups" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING      (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups')
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups');

-- Live with roles = {public} (no TO clause), so re-stated without one.
DROP POLICY IF EXISTS "Users can update own designs" ON storage.objects;
CREATE POLICY "Users can update own designs" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- DELETE (roles = {public} live)
DROP POLICY IF EXISTS "Users can delete own designs" ON storage.objects;
CREATE POLICY "Users can delete own designs" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- VERIFY (SQL Editor). Run this BEFORE and AFTER applying; the two result sets
-- must be identical — that is what "no-op" means here.
--   SELECT policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND (coalesce(qual,'') ILIKE '%''designs''%' OR coalesce(with_check,'') ILIKE '%''designs''%')
--   ORDER BY cmd, policyname;
--   -- expect exactly 11 rows: 5 INSERT, 3 SELECT, 2 UPDATE, 1 DELETE
--
--   SELECT id, public FROM storage.buckets WHERE id = 'designs';
--   -- expect: designs | true  (unchanged by this file)
