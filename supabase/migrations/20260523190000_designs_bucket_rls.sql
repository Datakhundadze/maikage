-- Storage RLS fix for the 'designs' bucket.
--
-- A live prod query confirmed the only INSERT policies actually present on
-- storage.objects for this bucket were: "Admin upload catalog designs",
-- "Allow all uploads to designs" (broad — anon+authed, any path),
-- "Anyone can upload logos", "Anyone can upload order mockups". The
-- per-folder INSERT policies that earlier migrations (20260319100000,
-- 20260422120000, 20260424140000) defined were NEVER applied to prod
-- (migration-file-only). So we (re)create them here BEFORE dropping the
-- broad policy, otherwise legitimate guest/auth uploads would break.
--
-- Folder roots that legitimately receive uploads (verified against all
-- frontend upload call sites): generations/, order-originals/, cart-items/,
-- order-mockups/ (anon-allowed), and <uid>/ (authed own-folder).
-- "Anyone can upload order mockups" already exists on prod and is NOT
-- touched here.
--
-- All statements use DROP POLICY IF EXISTS + CREATE so the migration is
-- idempotent regardless of any stray partially-applied copy.

-- 1. Create the missing per-folder INSERT policies (were never on prod).
DROP POLICY IF EXISTS "Anyone can upload to generations folder" ON storage.objects;
CREATE POLICY "Anyone can upload to generations folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'generations');

DROP POLICY IF EXISTS "Anyone can upload to order-originals folder" ON storage.objects;
CREATE POLICY "Anyone can upload to order-originals folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-originals');

DROP POLICY IF EXISTS "Anyone can upload to cart-items folder" ON storage.objects;
CREATE POLICY "Anyone can upload to cart-items folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'cart-items');

DROP POLICY IF EXISTS "Authenticated users upload own folder" ON storage.objects;
CREATE POLICY "Authenticated users upload own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 2. Drop the broad policies (now redundant once the above are live):
--    - "Allow all uploads to designs" let anon upload anywhere with any name.
--    - "Allow authenticated delete from designs" let any logged-in user
--      delete ANY file. The narrower "Users can delete own designs"
--      (auth.uid()::text = foldername[1]) remains and covers the sole
--      delete caller (MyDesignsPage own-design delete).
DROP POLICY IF EXISTS "Allow all uploads to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete from designs" ON storage.objects;
