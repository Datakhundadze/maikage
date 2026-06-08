-- Security fix: design_likes had a public SELECT policy with USING (true),
-- exposing every like row (user_id + design_id) to any anon caller — i.e.
-- which user liked which design, for all users.
--
-- Investigation confirmed nothing needs that broad read:
--   - The only SELECT caller (CommunityPage fetchLikes) reads OWN rows only
--     (.eq("user_id", user.id)) to drive the filled/unfilled heart, and
--     runs authed-only.
--   - Aggregate like counts come from the denormalized designs.likes_count
--     column (trigger-maintained), NOT from design_likes — so no
--     get_like_counts RPC is needed.
--   - Logged-out visitors never read design_likes.
--
-- INSERT / DELETE own-row policies ("Users can insert own likes",
-- "Users can delete own likes", both auth.uid() = user_id) are NOT touched.

DROP POLICY IF EXISTS "Users can read likes" ON public.design_likes;

CREATE POLICY "Users can read own likes" ON public.design_likes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
