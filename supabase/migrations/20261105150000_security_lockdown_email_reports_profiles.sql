-- Security review 2026-11-05 (Claude, David's GO). ✅ APPLIED on prod + verified.
--
-- 1. Email queue + weekly-report functions were EXECUTE-able by anon/authenticated
--    through PostgREST (/rest/v1/rpc/…), all SECURITY DEFINER:
--      read_email_batch  → anyone could read queued emails, incl. the auth_emails
--                          queue (sign-in / confirmation links) → account takeover;
--      enqueue_email     → anyone could queue mail sent from maika.ge's domain;
--      delete_email / move_to_dlq / email_queue_dispatch → drop or stall mail;
--      report_brands / report_meta → sales revenue by brand readable by anyone.
--    Every caller uses the service role (send-transactional-email,
--    process-email-queue, generate-weekly-sales-report) or pg_cron (postgres).
--    Verified: anon POST /rpc/read_email_batch → 42501 permission denied;
--    has_function_privilege: anon/authenticated false, service_role true.
--
-- 2. profiles: "Users can update own profile" / "Users can insert own profile"
--    had no column limits, so a user could clear is_blocked (admin block) or set
--    is_exempt (AI generation limit exemption → unbounded paid AI calls).
--    Verified (rolled back): non-admin self-update of both flags → unchanged.
--
-- NOT changed: check_and_increment_rate_limit and check_generation_block stay
-- callable by anon/authenticated — gemini-proxy calls them through the
-- request's own anon-key client (gemini-proxy/index.ts ~1382).

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_brands(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_meta(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.report_brands(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_meta(timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.profiles_guard_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_blocked := false;
      NEW.is_exempt := false;
    ELSE
      NEW.is_blocked := OLD.is_blocked;
      NEW.is_exempt := OLD.is_exempt;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_guard_flags ON public.profiles;
CREATE TRIGGER profiles_guard_flags
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_flags();

-- Verify:
-- SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc
--  WHERE pronamespace = 'public'::regnamespace
--    AND proname IN ('enqueue_email','read_email_batch','delete_email','move_to_dlq',
--                    'email_queue_dispatch','report_brands','report_meta');   -- all false
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
