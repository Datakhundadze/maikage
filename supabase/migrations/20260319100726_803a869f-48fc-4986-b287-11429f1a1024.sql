CREATE POLICY "Anyone can read generation images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'generations');