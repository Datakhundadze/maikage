-- Customer photos from the FAQ chat, visible to admins.
--
-- WHY. chat_logs recorded only a literal " [image]" marker, so a conversation
-- that turned on a photo could not be judged after the fact: you could read
-- what the customer typed and what the bot answered, but not what they showed
-- it. This stores the picture and links it to its message row.
--
-- PRIVATE BUCKET, deliberately NOT the existing `designs` bucket. `designs` is
-- public (`public: true`) — fine for generated artwork the customer already
-- shares, wrong for a file a stranger uploaded, which sooner or later contains
-- a face or a document. Nothing here is reachable by URL without a signature.
--
-- WHO CAN TOUCH IT:
--   - write: the edge function's SERVICE ROLE only, which bypasses RLS. There
--     is deliberately NO insert policy, so the browser cannot write here at
--     all — no unauthenticated upload path into the account's storage.
--   - read: admins only, via the SELECT policy below, which is what lets
--     createSignedUrl succeed for them and fail for everyone else.
--   - anon/authenticated non-admins: no policy matches, so deny-all.

-- 1. The column. Nullable, no backfill: existing rows keep their " [image]"
--    marker and simply have no picture, which is accurate.
ALTER TABLE public.chat_logs ADD COLUMN IF NOT EXISTS image_path text;

-- 2. The bucket. `public => false` is the whole point; do not flip it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-uploads', 'chat-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Admin read. Required for createSignedUrl: signing is a privileged read,
--    so a caller with no SELECT right on the object gets an error rather than
--    a URL. No other policy exists on this bucket, so this is the only way in.
DROP POLICY IF EXISTS "Admins can read chat uploads" ON storage.objects;
CREATE POLICY "Admins can read chat uploads"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-uploads'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- 4. Return the new column from the admin messages RPC. Same shape, same
--    has_role gate; one extra column on the end so existing callers that
--    destructure by name are unaffected.
DROP FUNCTION IF EXISTS public.admin_list_chat_messages(text);
CREATE FUNCTION public.admin_list_chat_messages(p_session_id text)
RETURNS TABLE (
  role       text,
  content    text,
  lang       text,
  created_at timestamptz,
  image_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  SELECT c.role, c.content, c.lang, c.created_at, c.image_path
  FROM public.chat_logs c
  WHERE c.session_id = p_session_id
  ORDER BY c.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chat_messages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_chat_messages(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner) — all five should hold:
--
--   -- 1. column exists, nullable
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='chat_logs' AND column_name='image_path';
--   -- expect: image_path | text | YES
--
--   -- 2. bucket exists and is PRIVATE
--   SELECT id, public FROM storage.buckets WHERE id='chat-uploads';
--   -- expect: chat-uploads | false
--
--   -- 3. exactly one policy on the bucket, SELECT only
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects'
--     AND policyname='Admins can read chat uploads';
--   -- expect one row: SELECT | {authenticated}
--
--   -- 4. RPC returns 5 columns and is still admin-gated
--   SELECT p.proname, p.prosecdef AS security_definer,
--          pg_get_function_result(p.oid) AS returns,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname='admin_list_chat_messages';
--   -- expect: security_definer=true, returns includes image_path, authed_can_exec=true
--
--   -- 5. chat_logs itself is still deny-all
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='chat_logs';
--   -- expect 0
