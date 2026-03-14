
-- Allow public read on orders for admin panel (password-protected page)
CREATE POLICY "Public can read all orders"
ON public.orders FOR SELECT
TO anon, authenticated
USING (true);

-- Allow public read on generations  
-- (already has "Anyone can read generations" but adding for anon explicitly)
DROP POLICY IF EXISTS "Anyone can read generations" ON public.generations;
CREATE POLICY "Anyone can read generations"
ON public.generations FOR SELECT
TO anon, authenticated
USING (true);

-- Allow anon to read profiles for admin panel
CREATE POLICY "Anon can read profiles"
ON public.profiles FOR SELECT
TO anon
USING (true);

-- Allow anon to read analytics events
CREATE POLICY "Anon can read events"
ON public.analytics_events FOR SELECT
TO anon
USING (true);

-- Allow anon to insert analytics events
DROP POLICY IF EXISTS "Anyone can insert events" ON public.analytics_events;
CREATE POLICY "Anyone can insert events"
ON public.analytics_events FOR INSERT
TO anon, authenticated
WITH CHECK (true);
