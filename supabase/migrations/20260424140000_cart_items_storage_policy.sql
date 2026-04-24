-- Allow anyone to upload & read cart preview assets under cart-items/
-- so the localStorage cart can persist URLs pointing to Supabase storage.
CREATE POLICY "Anyone can upload cart items"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'cart-items');

CREATE POLICY "Anyone can read cart items"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'cart-items');
