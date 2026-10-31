-- Social DM bot: sketch images (meta-webhook sketchFlow.ts).
-- Every sketch the bot starts is recorded in social_bot_replies with
-- kind = 'sketch' and text = 'sketch:generate' | 'sketch:mockup' (the caps:
-- 3 generated / 10 text sketches per conversation per 24 h). Its mid is
-- written back after the Graph image send, for echo recognition.
--
-- RUN MANUALLY in the SQL Editor BEFORE redeploying meta-webhook. Without it
-- the 'sketch' insert is refused and every sketch falls back to the link line.

-- The inline CHECK from 20261031120000 is auto-named social_bot_replies_kind_check;
-- drop whatever CHECK on `kind` exists, whatever its name.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.social_bot_replies'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.social_bot_replies DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.social_bot_replies
  ADD CONSTRAINT social_bot_replies_kind_check CHECK (kind IN ('reply', 'handoff', 'photo', 'sketch'));

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.social_bot_replies'::regclass AND contype = 'c';
--   -- expect one row: social_bot_replies_kind_check
--   --   CHECK ((kind = ANY (ARRAY['reply'::text, 'handoff'::text, 'photo'::text, 'sketch'::text])))
--
-- AFTER A TEST:
--   SELECT kind, text, meta_message_id, created_at FROM public.social_bot_replies
--   WHERE kind = 'sketch' ORDER BY created_at DESC LIMIT 10;
