-- Allow anyone (anon/authenticated) to upload images to the generations/ subfolder in the designs bucket.
-- Previously only uploads where the first folder matched auth.uid() were allowed,
-- but generation images are stored under generations/{id}-mockup.png which doesn't match that pattern.
CREATE POLICY "Anyone can upload generation images"
ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'generations');
