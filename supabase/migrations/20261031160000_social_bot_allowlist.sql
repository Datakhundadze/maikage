-- Testing allowlist for the social DM bot: when non-empty, only these
-- conversation keys (channel:page_id:customer_id) get bot replies.
ALTER TABLE public.social_bot_settings ADD COLUMN IF NOT EXISTS allow_keys text[] NOT NULL DEFAULT '{}';
NOTIFY pgrst, 'reload schema';
