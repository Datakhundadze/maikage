-- Security fix: the generations table had a public SELECT policy
-- (USING (true)) that exposed user_id, session_id, prompts and image
-- paths for every generation to any anon caller. Replace it with:
--   - admin SELECT (re-added; the broad public policy had previously
--     superseded and dropped the admin one in 20260319100000)
--   - own-row SELECT for logged-in users
--   - a sanitized SECURITY DEFINER RPC for anonymous guests, keyed on the
--     session_id they already hold, returning NO user_id / session_id /
--     is_guest. This is what the guest /my-designs page calls.
--
-- The INSERT policy ("Anyone can insert generations") is intentionally
-- left untouched — studio generation depends on anon INSERT.

-- 1. Drop the over-permissive public read.
DROP POLICY IF EXISTS "Anyone can read generations" ON public.generations;

-- 2. Re-add admin read (covers AdminDesigns / AdminDashboard / AdminAnalytics).
DROP POLICY IF EXISTS "Admins can read all generations" ON public.generations;
CREATE POLICY "Admins can read all generations"
  ON public.generations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Logged-in customers can read their own generation rows.
DROP POLICY IF EXISTS "Users can read own generations" ON public.generations;
CREATE POLICY "Users can read own generations"
  ON public.generations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. Sanitized RPC for anonymous guests. Returns only the columns the
--    "My Designs" page renders — never user_id, session_id, or is_guest.
--    The caller passes the session_id they already store in localStorage;
--    a session_id is an unguessable UUID, so this exposes only that
--    session's own generations.
CREATE OR REPLACE FUNCTION public.get_generations_by_session(p_session_id text)
RETURNS TABLE (
  id uuid,
  product text,
  color text,
  style text,
  prompt text,
  mockup_image_path text,
  transparent_image_path text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, product, color, style, prompt,
         mockup_image_path, transparent_image_path, created_at
  FROM public.generations
  WHERE session_id = p_session_id
  ORDER BY created_at DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_generations_by_session(text) TO anon, authenticated;
