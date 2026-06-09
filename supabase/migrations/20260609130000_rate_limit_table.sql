-- Step 1 of gemini-proxy rate limiting (DB only).
--
-- Counter table + atomic check-and-increment used by the gemini-proxy edge
-- function to cap AI-gateway spend per key (user_id for authed, IP for anon).
--
-- The table has RLS enabled with NO policies: no client may touch it
-- directly. Only the SECURITY DEFINER function below reads/writes it, and
-- SECURITY DEFINER bypasses RLS. The function uses an explicit search_path
-- (public, pg_temp) per the project's search_path convention.
--
-- EXECUTE is granted to anon + authenticated because the edge function calls
-- it via .rpc() and the anon Studio must keep working. The apply block ends
-- with NOTIFY pgrst so PostgREST exposes the new RPC immediately.

CREATE TABLE IF NOT EXISTS public.rate_limit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time ON public.rate_limit (bucket_key, created_at);
ALTER TABLE public.rate_limit ENABLE ROW LEVEL SECURITY;
-- intentionally NO policies: deny all direct client access; SECURITY DEFINER fn bypasses RLS

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key text, p_hour_limit int, p_day_limit int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_hour int; v_day int;
BEGIN
  SELECT count(*) INTO v_hour FROM public.rate_limit
    WHERE bucket_key = p_key AND created_at >= now() - interval '1 hour';
  SELECT count(*) INTO v_day FROM public.rate_limit
    WHERE bucket_key = p_key AND created_at >= now() - interval '1 day';
  IF v_hour >= p_hour_limit OR v_day >= p_day_limit THEN
    RETURN false;
  END IF;
  INSERT INTO public.rate_limit (bucket_key) VALUES (p_key);
  DELETE FROM public.rate_limit WHERE bucket_key = p_key AND created_at < now() - interval '1 day';
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text,int,int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
