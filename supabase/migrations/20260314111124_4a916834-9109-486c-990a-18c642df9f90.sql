
DROP POLICY IF EXISTS "Anyone can insert generations" ON generations;

CREATE POLICY "Anyone can insert generations" ON generations
FOR INSERT TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read generations" ON generations;

CREATE POLICY "Anyone can read generations" ON generations
FOR SELECT USING (true);
