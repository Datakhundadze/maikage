-- Photos from Messenger / Instagram DMs, kept in our own PRIVATE bucket.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Then REDEPLOY meta-webhook.
--
-- WHY. Meta's attachment links expire within days, so the admin
-- "შეტყობინებები" tab could only show a paperclip. meta-webhook now copies
-- every incoming or outgoing IMAGE into this bucket right after the message is
-- stored, and records the object path on the attachment in
-- social_messages.attachments ({ ..., path, stored: true }). No table change:
-- attachments is already jsonb.
--
-- RETENTION. meta-webhook deletes these photos 90 days after the message was
-- sent (media.ts RETENTION_DAYS), at most every 6 hours, through the Storage
-- API, and marks the attachment { purged: true }. Message text is kept.
--
-- WHO CAN TOUCH IT — same as chat-uploads:
--   - write / delete: meta-webhook's SERVICE ROLE only (bypasses RLS). No
--     INSERT / UPDATE / DELETE policy exists for anyone else.
--   - read: admins only, through signed URLs (createSignedUrl needs SELECT).
--   - the bucket is NOT public: no file is reachable without a signature.

INSERT INTO storage.buckets (id, name, public)
VALUES ('social-uploads', 'social-uploads', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins can read social uploads" ON storage.objects;
CREATE POLICY "Admins can read social uploads"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'social-uploads'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- VERIFY (run in the SQL Editor as owner):
--
--   -- 1. bucket exists and is private
--   SELECT id, public FROM storage.buckets WHERE id = 'social-uploads';
--   -- expect: social-uploads | false
--
--   -- 2. exactly one policy mentions the bucket: admin SELECT
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND coalesce(qual, '') ILIKE '%social-uploads%';
--   -- expect 1 row: Admins can read social uploads | SELECT | {authenticated}
--
--   -- 3. after a customer sends a photo (and meta-webhook is redeployed)
--   SELECT sent_at, channel, attachments
--   FROM public.social_messages
--   WHERE attachments::text LIKE '%"image"%'
--   ORDER BY sent_at DESC LIMIT 5;
--   -- expect the newest photo to carry "stored": true and a "path"
