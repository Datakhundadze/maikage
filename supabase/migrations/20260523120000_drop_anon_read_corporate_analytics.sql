-- Security fix: drop two anon-readable SELECT policies that were added as a
-- shortcut around proper admin auth.
--
-- Background: when the admin panel still relied on a shared password instead
-- of Supabase auth, two policies opened up SELECT to anon so the panel could
-- read these tables from the browser anon client. Admin auth now goes through
-- useAdminCheck + the has_role() function, and proper admin SELECT policies
-- already exist on both tables (see "Admins can read inquiries" in
-- 20260316100549_* and "Admins can read events" in 20260308084451_*), so the
-- anon shortcuts are pure exposure with no remaining caller.
--
-- Confirmed callers before dropping:
--   - corporate_inquiries: only AdminCorporate.tsx reads (authed admin);
--     CorporateInquiryModal.tsx only INSERTs and is covered by the unchanged
--     "Anyone can insert inquiries" policy.
--   - analytics_events: only AdminAnalytics.tsx reads (authed admin);
--     useAnalytics.ts only INSERTs and is covered by the unchanged
--     "Anyone can insert events" policy.
--
-- INSERT policies and admin policies are NOT touched.

DROP POLICY IF EXISTS "Anon can read inquiries" ON public.corporate_inquiries;

DROP POLICY IF EXISTS "Anon can read events" ON public.analytics_events;
