CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_session_id ON generations(session_id);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at DESC);