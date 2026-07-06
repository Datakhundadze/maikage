-- Hybrid gallery ordering: pinned first, then newest first.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- New semantics for portfolio_items.sort_order / showroom_photos.sort_order:
--   NULL   → not manually positioned; sorts in the newest-first group
--            (all queries order: sort_order ASC NULLS LAST, created_at DESC).
--   number → manually pinned; pinned rows come first, in ascending order.
-- The admin upload flow previously auto-assigned max+1 (append-to-end); it now
-- inserts NULL, so new uploads surface at the top of the unpinned group with
-- no manual step. Clearing the position input in admin unpins a row.

-- 1. Default NULL for new rows (the frontend inserts explicitly; this keeps
--    any other writer consistent).
ALTER TABLE public.portfolio_items ALTER COLUMN sort_order DROP DEFAULT;
ALTER TABLE public.showroom_photos ALTER COLUMN sort_order DROP DEFAULT;

-- 2. Backfill — CLEAN SLATE (recommended): every existing value was assigned
--    by the old append-to-end upload flow, not by deliberate curation, so
--    reset all rows to unpinned (pure newest-first). Re-pin the few photos
--    you want up front by typing a number in the admin position field.
UPDATE public.portfolio_items SET sort_order = NULL;
UPDATE public.showroom_photos SET sort_order = NULL;

-- ALTERNATIVE to step 2 (skip the two UPDATEs above): keep the current
-- ordering pinned as-is. Existing photos then stay in today's order ahead of
-- every new upload, and only new uploads use newest-first. Choose ONE.

-- VERIFY (SQL Editor):
--   SELECT column_default FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('portfolio_items', 'showroom_photos')
--     AND column_name = 'sort_order';
--   -- expect: NULL for both rows
--
--   SELECT count(*) FILTER (WHERE sort_order IS NULL) AS unpinned,
--          count(*) FILTER (WHERE sort_order IS NOT NULL) AS pinned
--   FROM public.portfolio_items;
--   -- clean slate: pinned = 0
