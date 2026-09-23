-- designs bucket — STEP 3 (phase A): close anonymous LISTING and anonymous
-- OVERWRITE. The bucket STAYS public; every URL already stored in orders keeps
-- working. Making the bucket private is a later, separate project.
--
-- ⚠️ APPLY MANUALLY in the Lovable SQL Editor — Lovable does NOT auto-apply
-- migrations; this file is the repo record.
--
-- ⚠️ DEPLOYMENT ORDER. Apply this LAST, after:
--   1. 20260924100000 (step 0, the no-op sync) is applied;
--   2. the mirror-order-originals edge function is deployed;
--   3. the frontend that calls it (CartPage) and that uploads order mockups
--      with upsert: false (OrderDialog) is live.
-- If this runs first, the old CartPage still lists cart-items/ from the
-- browser, that list is now denied, and guest cart checkouts silently stop
-- copying originals into order-originals/ — nothing errors, the admin just
-- never sees the photos.
--
-- WHAT WAS WRONG (live audit 2026-09-23, 7,081 objects, 7.4 GB):
--   "Public read designs cart-items"     let ANY anonymous caller list
--       cart-items/ — 1,633 files including 509 customers' original photos —
--       so no path needed guessing.
--   "Public read designs order-mockups"  same for order-mockups/ (960 files),
--       which is where print files are uploaded.
--   "Anyone can update order mockups"    let ANY anonymous caller OVERWRITE a
--       file under order-mockups/. Together with the list above: replace a
--       paid order's print file, and the wrong design gets printed.
--
-- WHY THE POLICIES CAN GO NOW:
--   - The one legitimate anonymous LIST — CartPage's browser-side copy of
--     cart originals into order-originals/ (a storage copy needs SELECT on
--     the source) — now runs server-side in mirror-order-originals with the
--     service role, which bypasses RLS.
--   - The one legitimate anonymous UPDATE was uploadBlobWithRetry's
--     `upsert: true`. Every customer-side upload path is unique per call
--     (a fresh UUID in the folder or file name), so a real overwrite never
--     happens; the helper now defaults to upsert: false.
--     ⚠️ THIS IS NOT OPTIONAL. An upsert upload is an INSERT … ON CONFLICT
--     at the storage layer, and under RLS Postgres refuses that statement
--     unless the role also has a SELECT policy covering the row, even with
--     no conflict. That is why OrderDialog's original-photo uploads have
--     silently failed since the week of 2026-06-22, when the SELECT on
--     order-originals/ became admin-only (orders.design_state photo urls
--     went from 0 nulls/week to nearly all null). Dropping the SELECT on
--     cart-items/ below would do the same to add-to-cart — and those
--     uploads are not best-effort, they would throw — unless the frontend
--     with upsert: false is live first. Hence the deployment order.
--
-- WHAT STAYS: every INSERT policy (customers still upload), the admin-only
-- SELECT on order-originals/, the per-user UPDATE/DELETE, the bucket flag.
--
-- WHAT IS ADDED: admin-only SELECT on cart-items/ and order-mockups/,
-- modelled on the live "Admins read designs order-originals", so an admin can
-- still list them if a tool ever needs to (nothing in the admin lists these
-- two folders today), and admin-only UPDATE on order-mockups/, which the
-- admin's "regenerate print file" needs: it writes a DETERMINISTIC path
-- (order-mockups/<orderId>-transparent.png, AdminOrders.tsx) and legitimately
-- overwrites it on a second regeneration.

-- 1. Close the three holes -----------------------------------------------------
DROP POLICY IF EXISTS "Public read designs cart-items"    ON storage.objects;
DROP POLICY IF EXISTS "Public read designs order-mockups" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update order mockups"   ON storage.objects;

-- 2. Admin-only replacements ----------------------------------------------------
DROP POLICY IF EXISTS "Admins read designs cart-items" ON storage.objects;
CREATE POLICY "Admins read designs cart-items" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'cart-items'
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read designs order-mockups" ON storage.objects;
CREATE POLICY "Admins read designs order-mockups" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups'
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update designs order-mockups" ON storage.objects;
CREATE POLICY "Admins update designs order-mockups" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups'
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'designs' AND (storage.foldername(name))[1] = 'order-mockups'
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- VERIFY (SQL Editor):
--   -- 1. the three holes are gone, the three admin policies exist
--   SELECT policyname, cmd, roles::text
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname IN ('Public read designs cart-items', 'Public read designs order-mockups',
--                        'Anyone can update order mockups',
--                        'Admins read designs cart-items', 'Admins read designs order-mockups',
--                        'Admins update designs order-mockups')
--   ORDER BY policyname;
--   -- expect exactly the three "Admins …" rows, all TO {authenticated}
--
--   -- 2. no policy on this bucket grants anon anything but INSERT
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND coalesce(qual,'') || coalesce(with_check,'') ILIKE '%''designs''%'
--     AND 'anon' = ANY(roles) AND cmd <> 'INSERT';
--   -- expect 0 rows
--
--   -- 3. the bucket is still public (phase A does not change this)
--   SELECT id, public FROM storage.buckets WHERE id = 'designs';
--   -- expect: designs | true
