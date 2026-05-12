-- Telemetry table for SimplePage compositor diagnostics.
--
-- Each compositeSide / compositeDesignOnly invocation inserts one row at
-- submit time so failing orders can be triaged from the DB. The previous
-- telemetry sink was console.warn, which is irretrievable once the user
-- closes the tab. Insert is open to anon + authenticated because the
-- compose flow runs unauth'd for guest customers; SELECT is admin-only
-- since event_data can include typed-text previews.
CREATE TABLE IF NOT EXISTS public.composite_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.composite_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon and authenticated can insert composite events"
  ON public.composite_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "admins can read composite events"
  ON public.composite_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS composite_events_created_at_idx
  ON public.composite_events (created_at DESC);

CREATE INDEX IF NOT EXISTS composite_events_session_id_idx
  ON public.composite_events (session_id);
