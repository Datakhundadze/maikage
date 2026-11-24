-- Virtual showroom funnel (2026-11-24, David: "separate analytics — how many
-- came in, how many stayed, who ordered from the showroom").
--
-- One row per step a visitor reaches, once per tab session. No personal data:
-- a random session id, the step, where the visit came from.
-- Insert is open to anon + authenticated (most showroom visitors are guests);
-- reading is admin-only, through admin_showroom_funnel.
CREATE TABLE IF NOT EXISTS public.showroom_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  event      text NOT NULL,
  detail     text,
  source     text,
  medium     text,
  campaign   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showroom_events_sizes CHECK (
    char_length(session_id) <= 64 AND char_length(event) <= 32
    AND coalesce(char_length(detail), 0) <= 64 AND coalesce(char_length(source), 0) <= 80
    AND coalesce(char_length(medium), 0) <= 80 AND coalesce(char_length(campaign), 0) <= 120
  )
);

ALTER TABLE public.showroom_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can insert showroom events" ON public.showroom_events;
CREATE POLICY "anyone can insert showroom events"
  ON public.showroom_events FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "admins can read showroom events" ON public.showroom_events;
CREATE POLICY "admins can read showroom events"
  ON public.showroom_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT INSERT ON public.showroom_events TO anon, authenticated;
GRANT SELECT ON public.showroom_events TO authenticated;

CREATE INDEX IF NOT EXISTS showroom_events_created_at_idx ON public.showroom_events (created_at DESC);
CREATE INDEX IF NOT EXISTS showroom_events_session_idx ON public.showroom_events (session_id);

-- Sessions per day (Tbilisi time), source and step. Counted in the database:
-- a client read would stop at 1000 rows.
CREATE OR REPLACE FUNCTION public.admin_showroom_funnel(p_days integer DEFAULT 14)
RETURNS TABLE (day date, source text, medium text, event text, sessions bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT (e.created_at AT TIME ZONE 'Asia/Tbilisi')::date,
           coalesce(e.source, 'direct'), coalesce(e.medium, ''), e.event,
           count(DISTINCT e.session_id)
      FROM public.showroom_events e
     WHERE e.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
     GROUP BY 1, 2, 3, 4;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_showroom_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_showroom_funnel(integer) TO authenticated;
