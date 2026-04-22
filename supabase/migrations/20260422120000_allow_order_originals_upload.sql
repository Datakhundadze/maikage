-- Allow anyone to upload full-resolution original photos to order-originals/ folder
CREATE POLICY "Anyone can upload order originals"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-originals');

-- Allow listing files inside order-originals/ so admin can enumerate them
CREATE POLICY "Anyone can list order originals"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-originals');
