-- One-time recovery: delete the existing maika@maika.ge auth user so the
-- admin can re-register fresh via the new /admin login form.
--
-- Background: prior to the previous migration (20260508180000), /admin was
-- guarded by a hard-coded client-side password and never exercised real
-- Supabase auth. The auth.users row for maika@maika.ge predates that change
-- and has an unknown password — the admin can't sign in or sign up (the
-- latter fails with "User already registered"). Deleting unblocks signup,
-- and the bootstrap_admin_role trigger will grant admin on the fresh signup.
--
-- Cascades / cleanup:
--   * user_roles.user_id   → ON DELETE CASCADE (admin row is removed; the
--                            trigger re-creates it on signup).
--   * orders.user_id       → ON DELETE SET NULL (anonymised, kept).
--   * designs.user_id      → no FK; orphan rows remain (harmless).
--   * profiles.user_id     → no FK; we delete the matching row explicitly.
--
-- The created_at guard ensures this migration is a no-op once the admin has
-- re-registered (their new row has a more recent created_at).

DO $$
DECLARE
  old_uid uuid;
BEGIN
  SELECT id INTO old_uid
  FROM auth.users
  WHERE email = 'maika@maika.ge'
    AND created_at < '2026-05-08T18:00:00Z';

  IF old_uid IS NOT NULL THEN
    DELETE FROM public.profiles WHERE user_id = old_uid;
    DELETE FROM auth.users WHERE id = old_uid;
  END IF;
END $$;
