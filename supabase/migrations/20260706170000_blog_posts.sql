-- Blog / news section (partner events, camps, collaborations) — CMS pattern.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Creates a public table + a public
-- storage bucket, both admin-writable, mirroring the portfolio_items /
-- showroom_photos recipe already live on prod.
--
-- public.blog_posts backs the public /blog listing (published rows, newest
-- first) and /blog/:slug article pages, plus the admin "ბლოგი" tab (full
-- CRUD). body_md holds MARKDOWN (rendered client-side with react-markdown,
-- raw HTML disabled). cover_path / inline images live in the public 'blog'
-- bucket; meta_description_ka feeds the per-post <meta name="description">.
--
-- RLS mirrors portfolio_items: public SELECT is scoped to published = true;
-- all writes are gated by has_role(auth.uid(), 'admin'). The BEFORE UPDATE
-- trigger reuses the existing public.set_updated_at_now().

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE,
  title_ka            text NOT NULL,
  body_md             text NOT NULL DEFAULT '',
  cover_path          text,
  meta_description_ka text,
  published           boolean NOT NULL DEFAULT false,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger (reuses the schema-wide helper from catalog_schema).
DROP TRIGGER IF EXISTS blog_posts_set_updated_at ON public.blog_posts;
CREATE TRIGGER blog_posts_set_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- 2. Row level security ------------------------------------------------------
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published blog posts" ON public.blog_posts;
CREATE POLICY "Public can read published blog posts"
  ON public.blog_posts FOR SELECT
  USING (published = true);

DROP POLICY IF EXISTS "Admins can manage blog posts" ON public.blog_posts;
CREATE POLICY "Admins can manage blog posts"
  ON public.blog_posts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Storage bucket ----------------------------------------------------------
-- Public bucket, 10 MB cap, JPEG/PNG/WEBP only (covers + inline article images).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blog',
  'blog',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Public read, admin-only write — scoped to bucket_id so other buckets are
-- unaffected (mirrors the portfolio storage policies).
DROP POLICY IF EXISTS "Public read blog" ON storage.objects;
CREATE POLICY "Public read blog"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'blog');

DROP POLICY IF EXISTS "Admins write blog" ON storage.objects;
CREATE POLICY "Admins write blog"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'blog' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update blog" ON storage.objects;
CREATE POLICY "Admins update blog"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'blog' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete blog" ON storage.objects;
CREATE POLICY "Admins delete blog"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'blog' AND public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';

-- VERIFY (SQL Editor):
--   -- table with RLS enabled and the two policies:
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname = 'blog_posts' AND relnamespace = 'public'::regnamespace;  -- true
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'blog_posts';
--   -- expect: "Public can read published blog posts" (SELECT),
--   --         "Admins can manage blog posts" (ALL)
--
--   -- bucket exists, public, with the MIME allowlist:
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'blog';
--
--   -- anon sees only published rows (spot-check after creating a draft):
--   -- SET LOCAL ROLE anon; SELECT count(*) FROM public.blog_posts; RESET ROLE;
