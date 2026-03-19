CREATE POLICY "Anyone can read order mockups"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups');