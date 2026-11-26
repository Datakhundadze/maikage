-- SKETCH FILES (owner 2026-11-26): every sketch the DM bot sent, with the
-- print file's storage path, so the admin inbox can offer downloads.
-- Written by meta-webhook (service role). Admins read. No other access.
CREATE TABLE IF NOT EXISTS public.social_sketch_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key text NOT NULL,
  channel          text NOT NULL,
  kind             text NOT NULL,
  sketch_url       text NOT NULL,
  print_path       text,
  source_path      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_sketch_files_conv_idx
  ON public.social_sketch_files (conversation_key, created_at DESC);

ALTER TABLE public.social_sketch_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read social_sketch_files" ON public.social_sketch_files;
CREATE POLICY "Admins can read social_sketch_files"
  ON public.social_sketch_files FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
