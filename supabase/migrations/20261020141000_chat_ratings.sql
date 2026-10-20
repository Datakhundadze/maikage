-- Site assistant chat ratings (1–5 stars + optional comment) — one per session.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Idempotent: safe to re-run.
--
-- WHO WRITES. The customer's browser, directly (anon or signed-in) — the
-- ChatRating row under the assistant's reply in ChatWidget and /chat. No
-- edge function is involved, so nothing needs redeploying.
--
-- RLS mirrors public.feedback (anyone-insert / admin-read) but is tighter:
--   * INSERT only for anon + authenticated, WITH CHECK bounding the rating and
--     forbidding anyone from writing a user_id that is not their own;
--   * NO select / update / delete for them — ratings are write-only for
--     customers (the client inserts with return=minimal, so it never reads);
--   * admins SELECT via has_role(auth.uid(), 'admin').
--
-- ONE RATING PER SESSION. unique(session_id). The client uses
-- upsert(..., { onConflict: 'session_id', ignoreDuplicates: true }), i.e.
-- INSERT ... ON CONFLICT (session_id) DO NOTHING — a second rating for the same
-- session is silently ignored. ON CONFLICT DO NOTHING needs only the INSERT
-- privilege + INSERT policy (DO UPDATE would need SELECT/UPDATE, which we do
-- not grant). The client also treats 23505 as "already rated" as a fallback.
--
-- session_id is chat_logs.session_id (widget: crypto.randomUUID(); /chat:
-- "chatpage-" + uuid). It is customer-supplied and unverified — anyone can post
-- a rating for any string. It is a join hint for the admin view, not proof.

-- ⚠️ CONFLICTS WITH 20261019120000_chat_ratings.sql on the older remote branch
-- feat/chat-rating (RPC-only design: session_id PRIMARY KEY, no id/page
-- columns, submit_chat_rating()). Apply ONE of the two, not both. The guard
-- below aborts this script if that other table shape already exists, so it
-- can never half-apply on top of it.
DO $$
BEGIN
  IF to_regclass('public.chat_ratings') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'chat_ratings' AND column_name = 'page'
     ) THEN
    RAISE EXCEPTION 'public.chat_ratings already exists in the other (RPC) shape — pick one migration';
  END IF;
END $$;

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  text NOT NULL CHECK (char_length(session_id) BETWEEN 1 AND 200),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text CHECK (comment IS NULL OR char_length(comment) <= 300),
  lang        text CHECK (lang IS NULL OR char_length(lang) <= 10),
  page        text CHECK (page IS NULL OR char_length(page) <= 300),
  user_id     uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_ratings_session_id_key UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_ratings_created_at ON public.chat_ratings (created_at DESC);

-- 2. Privileges (defence in depth under RLS) ---------------------------------
-- Supabase grants ALL on new public tables to anon/authenticated by default;
-- take that back and hand out only what the policies below use.
REVOKE ALL ON public.chat_ratings FROM anon, authenticated;
GRANT INSERT ON public.chat_ratings TO anon, authenticated;
GRANT SELECT ON public.chat_ratings TO authenticated;   -- gated to admins by RLS

-- 3. Row level security ------------------------------------------------------
ALTER TABLE public.chat_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit a chat rating" ON public.chat_ratings;
CREATE POLICY "Anyone can submit a chat rating" ON public.chat_ratings
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    rating BETWEEN 1 AND 5
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can read chat ratings" ON public.chat_ratings;
CREATE POLICY "Admins can read chat ratings" ON public.chat_ratings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- intentionally NO UPDATE and NO DELETE policy.

NOTIFY pgrst, 'reload schema';

-- VERIFY (run in the SQL Editor as owner):
--
--   -- 1. RLS on:
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname = 'chat_ratings' AND relnamespace = 'public'::regnamespace;   -- true
--
--   -- 2. exactly two policies: INSERT {anon,authenticated}, SELECT {authenticated}
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_ratings'
--   ORDER BY cmd;
--   -- expect: "Anyone can submit a chat rating" | INSERT | {anon,authenticated}
--   --         "Admins can read chat ratings"    | SELECT | {authenticated}
--
--   -- 3. columns + unique constraint:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'chat_ratings'
--   ORDER BY ordinal_position;                                  -- expect 8 rows
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.chat_ratings'::regclass;           -- pkey, unique, 5 checks
--
--   -- 4. anon privileges: INSERT only
--   SELECT has_table_privilege('anon', 'public.chat_ratings', 'INSERT') AS ins,  -- true
--          has_table_privilege('anon', 'public.chat_ratings', 'SELECT') AS sel,  -- false
--          has_table_privilege('anon', 'public.chat_ratings', 'UPDATE') AS upd,  -- false
--          has_table_privilege('anon', 'public.chat_ratings', 'DELETE') AS del;  -- false
--
--   -- 5. anon insert behaviour (each block rolls back, nothing is kept):
--   BEGIN;
--     SET LOCAL ROLE anon;
--     INSERT INTO public.chat_ratings (session_id, rating) VALUES ('verify-ok', 5);   -- succeeds
--     INSERT INTO public.chat_ratings (session_id, rating) VALUES ('verify-ok', 3)
--       ON CONFLICT (session_id) DO NOTHING;                                          -- 0 rows, no error
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     INSERT INTO public.chat_ratings (session_id, rating) VALUES ('verify-bad', 6);
--     -- expect ERROR: violates check constraint "chat_ratings_rating_check"
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     INSERT INTO public.chat_ratings (session_id, rating, user_id)
--     VALUES ('verify-uid', 4, gen_random_uuid());
--     -- expect ERROR: new row violates row-level security policy
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     SELECT * FROM public.chat_ratings;
--     -- expect ERROR: permission denied for table chat_ratings
--   ROLLBACK;
--
--   -- 6. after a real rating on the site:
--   SELECT created_at, session_id, rating, left(comment, 60) AS comment, lang, page,
--          user_id IS NOT NULL AS signed_in
--   FROM public.chat_ratings ORDER BY created_at DESC LIMIT 20;
