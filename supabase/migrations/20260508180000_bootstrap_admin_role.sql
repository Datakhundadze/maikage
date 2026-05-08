-- Bootstrap the primary admin account.
--
-- Storage RLS on the catalog-designs bucket requires public.has_role(auth.uid(),
-- 'admin'), so the user uploading via the admin UI needs an admin row in
-- public.user_roles. Previously /admin was guarded by a client-side password
-- only, so the actual Supabase session never carried admin privileges and
-- storage uploads returned 403.
--
-- Two parts:
--   1. If maika@maika.ge already exists in auth.users, grant admin now.
--   2. A trigger on auth.users INSERT auto-grants admin to maika@maika.ge so
--      that signing up via the new admin login form also works.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE email = 'maika@maika.ge'
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_admin_to_primary()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email = 'maika@maika.ge' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_admin_to_primary_on_signup ON auth.users;
CREATE TRIGGER grant_admin_to_primary_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_admin_to_primary();
