
-- Create corporate_inquiries table
CREATE TABLE public.corporate_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  tax_id text NOT NULL,
  contact_person text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  tshirt_quantity integer NOT NULL,
  color text,
  comment text,
  logo_path text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corporate_inquiries ENABLE ROW LEVEL SECURITY;

-- Anyone can insert
CREATE POLICY "Anyone can insert inquiries" ON public.corporate_inquiries
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Admins can read
CREATE POLICY "Admins can read inquiries" ON public.corporate_inquiries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Anon can read for admin panel (password-protected)
CREATE POLICY "Anon can read inquiries" ON public.corporate_inquiries
  FOR SELECT TO anon USING (true);

-- Admins can update status
CREATE POLICY "Admins can update inquiries" ON public.corporate_inquiries
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Create storage bucket for corporate logos
INSERT INTO storage.buckets (id, name, public) VALUES ('corporate-logos', 'corporate-logos', true);

-- Storage policies
CREATE POLICY "Anyone can upload logos" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'corporate-logos');

CREATE POLICY "Public can view logos" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'corporate-logos');
