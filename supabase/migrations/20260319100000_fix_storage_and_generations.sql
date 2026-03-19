-- Make the 'designs' bucket public so getPublicUrl() URLs are accessible
UPDATE storage.buckets SET public = true WHERE id = 'designs';

-- Drop old conflicting storage policies and recreate cleanly
DROP POLICY IF EXISTS "Anyone can upload generation images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own design images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view all storage objects" ON storage.objects;

-- Allow anyone (anon or authenticated) to upload to generations/ subfolder
CREATE POLICY "Anyone can upload to generations folder"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'generations');

-- Allow authenticated users to upload to their own folder (uid-based paths)
CREATE POLICY "Authenticated users upload own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow public read on all objects in designs bucket
CREATE POLICY "Public read designs bucket"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'designs');

-- Allow authenticated users to delete from their own folder
CREATE POLICY "Authenticated users delete own objects"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Ensure generations table RLS is correct
DROP POLICY IF EXISTS "Anyone can read generations" ON public.generations;
DROP POLICY IF EXISTS "Admins can read all generations" ON public.generations;
DROP POLICY IF EXISTS "Anyone can insert generations" ON public.generations;

CREATE POLICY "Anyone can insert generations"
ON public.generations FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anyone can read generations"
ON public.generations FOR SELECT
TO anon, authenticated
USING (true);
