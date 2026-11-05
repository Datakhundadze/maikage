-- Extra CC recipients for the weekly/monthly sales report (2026-11-05).
-- ✅ APPLIED on prod by Claude. Addresses are inserted on prod only — NOT in
-- this file, because the repo is public. Manage them in SQL:
--   INSERT INTO public.report_recipients (email) VALUES ('name@example.com');
--   UPDATE public.report_recipients SET active = false WHERE email = '…';
-- generate-weekly-sales-report reads active rows with report = 'sales' (service
-- role) and adds them to CC next to maika@maika.ge; ACCOUNTANT_EMAIL stays "to".
CREATE TABLE IF NOT EXISTS public.report_recipients (
  email text PRIMARY KEY CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  report text NOT NULL DEFAULT 'sales',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage report recipients" ON public.report_recipients;
CREATE POLICY "Admins manage report recipients" ON public.report_recipients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
