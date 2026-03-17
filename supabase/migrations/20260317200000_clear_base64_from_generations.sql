-- Clear base64 data URLs stored directly in generations table.
-- These large values cause statement timeouts when querying the table.
-- New generations will upload images to storage and store only the path.
UPDATE generations SET mockup_image_path = NULL WHERE mockup_image_path LIKE 'data:%';
UPDATE generations SET transparent_image_path = NULL WHERE transparent_image_path LIKE 'data:%';
