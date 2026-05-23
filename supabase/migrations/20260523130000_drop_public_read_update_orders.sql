-- Security fix: drop the two anon-permissive policies on `orders` that were
-- added as a shortcut around proper admin auth (back when the admin panel
-- used a frontend password gate instead of Supabase auth).
--
-- Why this is safe:
--
--   Admin reads          covered by "Admins can read all orders" (auth: SEL,
--                        public.has_role(auth.uid(),'admin'))
--                        — applies to AdminOrders.tsx:189, AdminAnalytics:31,
--                        AdminDashboard:33, AdminUsers:39 (all authed admins).
--
--   Admin status updates covered by admin_update_order SECURITY DEFINER RPC
--                        (RLS-immune). See AdminOrders.tsx status-change path.
--
--   Admin regenerate-    covered by "Admins can update orders" (auth: UPD,
--   print-file UPDATE    public.has_role(auth.uid(),'admin'::app_role)).
--                        See AdminOrders.tsx:259-262.
--
--   Guest checkout       INSERT covered by "Anonymous can insert orders"
--   (orderSubmission)    (anon: INS, WITH CHECK (user_id IS NULL)). UPDATE
--                        path (back_transparent_image_url backfill) was
--                        moved to the create-payment and create-payment-flitt
--                        edge functions which use the service role.
--
--   Logged-in customer   INSERT covered by "Users can insert orders"
--   checkout             (auth: INS, WITH CHECK (auth.uid()=user_id)).
--                        SELECT covered by "Users can read own orders".
--
--   Post-payment landing No client-side `orders` read — LandingPage polls the
--                        check-payment edge function (service role) which
--                        returns only status fields, never order PII.
--
-- After this migration runs, there is no anon SELECT or UPDATE path on orders.

DROP POLICY IF EXISTS "Public can update orders" ON public.orders;

DROP POLICY IF EXISTS "Public can read all orders" ON public.orders;
