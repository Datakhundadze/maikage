-- Security fix: the profiles table had TWO broad SELECT policies with
-- USING (true) that exposed every profile row to any anon caller —
-- enabling user enumeration (all user_ids), harvesting of display names /
-- avatars, and visibility of internal flags (is_anonymous, is_blocked).
--
--   - "Public can read display names" (20260225152301) — misnamed: a row
--     RLS USING clause can't restrict columns, so it leaked the whole row.
--   - "Anon can read profiles" (20260314131841) — added as an
--     admin-panel shortcut back when admin used a password gate instead
--     of Supabase auth.
--
-- No frontend code depends on anon read of profiles: CommunityPage reads
-- the `designs` table (not profiles), and every profiles reader
-- (AdminUsers, AdminDashboard, useAdminTabBadges) runs as an authenticated
-- admin covered by "Admins can read all profiles".
--
-- Surviving policies (NOT touched — they cover all legitimate access):
--   "Users can read own profile"    SEL  auth.uid() = user_id
--   "Users can insert own profile"  INS  auth.uid() = user_id
--   "Users can update own profile"  UPD  auth.uid() = user_id
--   "Admins can read all profiles"  SEL  has_role(auth.uid(),'admin')
--   "Admins can update any profile" UPD  has_role(auth.uid(),'admin')

DROP POLICY IF EXISTS "Public can read display names" ON public.profiles;

DROP POLICY IF EXISTS "Anon can read profiles" ON public.profiles;
