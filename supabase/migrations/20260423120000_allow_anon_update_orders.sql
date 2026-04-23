-- The admin panel uses a frontend password gate (not Supabase auth), so updates
-- from the admin UI arrive with the anon role and were being silently blocked
-- by RLS. Allow anon + authenticated to UPDATE orders so status/payment
-- changes saved in the admin panel actually persist to the database.
CREATE POLICY "Public can update orders"
ON public.orders FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);
