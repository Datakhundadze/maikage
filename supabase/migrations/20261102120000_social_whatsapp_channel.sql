-- WhatsApp as a third social channel (meta-webhook whatsapp.ts, add-only).
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record. Run it BEFORE subscribing the
-- WhatsApp webhook fields: until then every WhatsApp row is refused by the
-- channel CHECK, the webhook answers 500 and Meta keeps retrying.
--
-- WHAT CHANGES. Only the channel CHECK of two tables gains 'whatsapp':
--   social_messages.channel        inbound WhatsApp messages, the operator's
--                                  phone-app echoes and the bot's sends
--   social_order_drafts.channel    DM order drafts of a WhatsApp conversation
-- Nothing else: no column, no policy, no index. Existing rows are untouched
-- ('messenger' / 'instagram' stay valid). conversation_key stays the generated
-- channel || ':' || page_id || ':' || customer_id → for WhatsApp
-- "whatsapp:<phone_number_id>:<wa_id>".
-- order_attribution.manual_channel already allows 'whatsapp' (20261021120000).
--
-- The inline CHECKs are auto-named <table>_channel_check; drop whatever CHECK
-- on `channel` exists, whatever its name, then add the widened one.

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.social_messages'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%(channel = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.social_messages DROP CONSTRAINT %I', c);
  END LOOP;
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.social_order_drafts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%(channel = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.social_order_drafts DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.social_messages
  ADD CONSTRAINT social_messages_channel_check CHECK (channel IN ('messenger', 'instagram', 'whatsapp'));

ALTER TABLE public.social_order_drafts
  ADD CONSTRAINT social_order_drafts_channel_check CHECK (channel IN ('messenger', 'instagram', 'whatsapp'));

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect exactly two rows, each listing messenger, instagram, whatsapp;
-- social_messages' direction CHECK and the drafts' status / delivery_type
-- CHECKs are not touched and do not appear here):
--
--   SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
--   FROM pg_constraint
--   WHERE conrelid IN ('public.social_messages'::regclass, 'public.social_order_drafts'::regclass)
--     AND contype = 'c'
--     AND pg_get_constraintdef(oid) ILIKE '%channel%';
--   -- social_messages     | social_messages_channel_check     | CHECK ((channel = ANY (ARRAY['messenger'::text, 'instagram'::text, 'whatsapp'::text])))
--   -- social_order_drafts | social_order_drafts_channel_check | CHECK ((channel = ANY (ARRAY['messenger'::text, 'instagram'::text, 'whatsapp'::text])))
--
--   -- and the other CHECKs are still there (expect direction / status / delivery_type):
--   SELECT conrelid::regclass, conname FROM pg_constraint
--   WHERE conrelid IN ('public.social_messages'::regclass, 'public.social_order_drafts'::regclass)
--     AND contype = 'c' ORDER BY 1, 2;
--
-- AFTER A TEST MESSAGE from the allow-listed number:
--   SELECT conversation_key, direction, left(text, 60) AS text, attachments, sent_at
--   FROM public.social_messages WHERE channel = 'whatsapp'
--   ORDER BY sent_at DESC LIMIT 10;
--
-- ALLOW-LIST the test number (the bot answers ONLY listed WhatsApp keys).
-- Easiest: send one message from that phone first, then copy its key from
--   SELECT DISTINCT conversation_key FROM public.social_messages WHERE channel = 'whatsapp';
-- (<phone_number_id> is also under WhatsApp → API Setup in the Meta dashboard;
-- <wa_id> is the number in E.164 digits without "+"; logs mask both):
--   UPDATE public.social_bot_settings
--   SET allow_keys = array_append(allow_keys, 'whatsapp:<phone_number_id>:<wa_id>')
--   WHERE id;
