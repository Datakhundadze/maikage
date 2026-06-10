-- Multi-logo support for corporate inquiries (repo record — this was
-- already applied manually on prod via the SQL editor; ADD COLUMN IF NOT
-- EXISTS makes re-running it a no-op).
--
-- New inquiries store every uploaded logo path in logo_paths and keep the
-- first one mirrored into the legacy logo_path column, so old rows (NULL
-- logo_paths) and legacy readers keep working with no backfill.

ALTER TABLE public.corporate_inquiries ADD COLUMN IF NOT EXISTS logo_paths text[];

NOTIFY pgrst, 'reload schema';
