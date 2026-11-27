-- BOT LABEL (owner 2026-11-27): meta-webhook labels every conversation the bot
-- answers „ბოტმა უპასუხა" in the Page inbox (Business Suite), once per
-- conversation. Add-only: the timestamp of that label on social_contacts.
ALTER TABLE public.social_contacts
  ADD COLUMN IF NOT EXISTS bot_labeled_at timestamptz;

-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='social_contacts' AND column_name='bot_labeled_at';
