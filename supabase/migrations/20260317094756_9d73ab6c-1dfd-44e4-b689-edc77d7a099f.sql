CREATE POLICY "Anyone can upload order mockups"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups');