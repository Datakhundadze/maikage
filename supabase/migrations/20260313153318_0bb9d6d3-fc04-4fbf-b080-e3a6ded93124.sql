
CREATE TABLE public.generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT NULL,
  session_id text DEFAULT NULL,
  is_guest boolean NOT NULL DEFAULT true,
  product text NOT NULL,
  color text NOT NULL,
  style text DEFAULT NULL,
  prompt text DEFAULT NULL,
  mockup_image_path text DEFAULT NULL,
  transparent_image_path text DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

-- Anyone (anon or authenticated) can insert
CREATE POLICY "Anyone can insert generations"
  ON public.generations FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins can read all generations
CREATE POLICY "Admins can read all generations"
  ON public.generations FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
