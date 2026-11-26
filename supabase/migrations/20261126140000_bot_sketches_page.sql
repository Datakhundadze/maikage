-- BOT SKETCHES PAGE (owner 2026-11-26): a separate admin tab lists every
-- sketch the DM bot sent, with the customer's name and a "new" badge until
-- someone downloads the print file. Add-only:
--   1. social_sketch_files.downloaded_at — set by the admin page on download
--      (admins may UPDATE; they could already SELECT).
--   2. social_contacts — customer display names from the Meta profile APIs,
--      written by meta-webhook (service role). Admins read. No other access.
--   3. The one row saved before this page (25.11, file already sent to the
--      owner) is marked downloaded so the badge starts at zero.

ALTER TABLE public.social_sketch_files
  ADD COLUMN IF NOT EXISTS downloaded_at timestamptz;

DROP POLICY IF EXISTS "Admins can mark social_sketch_files downloaded" ON public.social_sketch_files;
CREATE POLICY "Admins can mark social_sketch_files downloaded"
  ON public.social_sketch_files FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.social_contacts (
  conversation_key text PRIMARY KEY,
  channel          text NOT NULL,
  name             text,
  username         text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read social_contacts" ON public.social_contacts;
CREATE POLICY "Admins can read social_contacts"
  ON public.social_contacts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

UPDATE public.social_sketch_files
   SET downloaded_at = now()
 WHERE downloaded_at IS NULL
   AND created_at < '2026-11-26T09:00:00Z';

-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='social_sketch_files' AND column_name='downloaded_at';
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('social_sketch_files','social_contacts') ORDER BY 1,2;
--   SELECT relrowsecurity FROM pg_class WHERE relname='social_contacts';
--   SELECT count(*) FILTER (WHERE downloaded_at IS NULL) AS new_rows, count(*) FROM public.social_sketch_files;
