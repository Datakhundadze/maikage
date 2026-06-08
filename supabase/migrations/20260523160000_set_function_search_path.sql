-- Security hardening: set an explicit search_path on the functions that
-- were missing one ("Function Search Path Mutable" warning). A function
-- without a fixed search_path resolves unqualified names against the
-- caller's search_path, which a malicious caller can manipulate to shadow
-- built-ins — especially dangerous for SECURITY DEFINER functions.
--
-- We use ALTER FUNCTION ... SET search_path rather than CREATE OR REPLACE:
-- it adds ONLY the config setting and cannot alter the body, signature,
-- return type, SECURITY DEFINER flag, volatility, or existing GRANT/REVOKE
-- privileges. On a signature mismatch it fails loudly (function not found)
-- instead of silently creating a duplicate overload.
--
-- Functions already carrying SET search_path are NOT touched:
--   handle_new_user, update_updated_at_column, has_role,
--   update_design_likes_count, admin_update_order, grant_admin_to_primary,
--   get_generations_by_session.
--
-- The four email-queue wrappers are SECURITY DEFINER and call into the
-- pgmq schema via fully-qualified names (pgmq.send / pgmq.read /
-- pgmq.delete), so a fixed search_path does not affect their behavior.
-- set_updated_at_now is a plain trigger function using only now() and NEW.

ALTER FUNCTION public.enqueue_email(TEXT, JSONB)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.read_email_batch(TEXT, INT, INT)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_email(TEXT, BIGINT)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.set_updated_at_now()
  SET search_path = public, pg_temp;
