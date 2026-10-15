// Build-time sitemap generator. Fetches https://<ref>.supabase.co/functions/v1/sitemap
// and writes the result to public/sitemap.xml so the Vite build picks it up
// as a static asset.
//
// Why this exists: Lovable's hosting serves public/ files directly and does
// not honour the vercel.json / netlify.toml rewrites from /sitemap.xml to
// the Supabase Edge Function. Hitting the function URL from inside the build
// step keeps the Edge Function as the single source of truth for sitemap
// content (static pages, categories, designs, image:image tags) while still
// delivering a real static .xml file to the hosting CDN.
//
// Trade-off: sitemap is only refreshed on each deploy, not in real time.
// New catalog_designs become indexable on the next deploy. Acceptable for
// SEO — Google re-crawls a sitemap at most a few times a day; an end-to-end
// build/deploy cycle is well within that window.
//
// Failure mode: if the function is down or returns garbage, leave the
// previously-deployed public/sitemap.xml alone and let the build continue
// with a console.warn. Better to ship a slightly stale sitemap than to
// fail the deploy.
//
// App routes: after the fetch (or, if it failed, on the previous file) the
// product landing routes App.tsx registers (/t-shirt, /hoodie/premium-washed,
// …) and — only while lib/showroomSeo.ts marks it indexable — /showroom are
// appended if the sitemap lacks them. Their slugs are read from the same
// src/ modules the app routes come from (scripts/lib/appModules.mjs), never
// retyped here; entries already present are left as the function wrote them.
// The edge function carries the same landing routes (its product-routes
// block), so once that deploy is live this step adds nothing.

import { readFile, writeFile, access, constants } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/appModules.mjs";
import { SITE_URL, landingRoutes, landingSitemapEntries, mergeSitemapEntries } from "./lib/seo.mjs";

const SITEMAP_FN_URL =
  "https://ykoseamefoabptuijsza.supabase.co/functions/v1/sitemap";
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "public", "sitemap.xml");

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SITEMAP_FN_URL, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const body = await res.text();
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry() {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchOnce();
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[generate-sitemap] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message} — retrying in ${BACKOFF_MS * attempt}ms`,
        );
        await sleep(BACKOFF_MS * attempt);
      }
    }
  }
  throw lastErr;
}

function looksLikeSitemapXml(body) {
  if (typeof body !== "string" || body.length < 50) return false;
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<urlset");
}

function countUrls(body) {
  const matches = body.match(/<url\b/g);
  return matches ? matches.length : 0;
}

async function previousFileExists() {
  try {
    await access(OUTPUT, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends the app routes the sitemap lacks (see header). Returns the xml to
 * write, or null when nothing was added. Never throws.
 */
async function withAppRoutes(xml) {
  try {
    const app = await loadAppModules("[generate-sitemap]");
    if (!app) {
      console.warn("[generate-sitemap] Landing routes not added (app modules unavailable). Build continues.");
      return null;
    }
    const entries = landingSitemapEntries(landingRoutes(app));
    if (app.SHOWROOM_INDEXABLE) entries.push({ loc: `${SITE_URL}/showroom`, priority: "0.6", changefreq: "monthly" });
    const before = countUrls(xml);
    const { xml: merged, added } = mergeSitemapEntries(xml, entries);
    console.log(
      `[generate-sitemap] App routes: ${entries.length} checked, ${added.length} added — ${before} → ${countUrls(merged)} URLs.` +
        (app.SHOWROOM_INDEXABLE ? "" : " /showroom not listed (noindex, lib/showroomSeo.ts)."),
    );
    return added.length > 0 ? merged : null;
  } catch (e) {
    console.warn(`[generate-sitemap] Landing routes not added: ${e?.message ?? e}. Build continues.`);
    return null;
  }
}

/** The sitemap already on disk, if it looks like one. */
async function previousSitemap() {
  try {
    const body = await readFile(OUTPUT, "utf8");
    return looksLikeSitemapXml(body) ? body : null;
  } catch {
    return null;
  }
}

async function main() {
  let body;
  try {
    body = await fetchWithRetry();
  } catch (e) {
    const hadPrev = await previousFileExists();
    console.warn(
      `[generate-sitemap] FETCH FAILED after ${MAX_ATTEMPTS} attempts: ${e.message}`,
    );
    console.warn(
      hadPrev
        ? "[generate-sitemap] Keeping previously-built public/sitemap.xml in place. Build continues."
        : "[generate-sitemap] No previous public/sitemap.xml on disk — /sitemap.xml will 404 after deploy. Build continues anyway.",
    );
    await addAppRoutesToPrevious();
    process.exitCode = 0;
    return;
  }

  if (!looksLikeSitemapXml(body)) {
    const hadPrev = await previousFileExists();
    console.warn(
      `[generate-sitemap] Edge Function returned non-XML body (first 100 chars): ${body.slice(0, 100)}`,
    );
    console.warn(
      hadPrev
        ? "[generate-sitemap] Keeping previously-built public/sitemap.xml in place. Build continues."
        : "[generate-sitemap] No previous public/sitemap.xml on disk — /sitemap.xml will 404 after deploy. Build continues anyway.",
    );
    await addAppRoutesToPrevious();
    process.exitCode = 0;
    return;
  }

  const n = countUrls(body);
  console.log(
    `[generate-sitemap] Sitemap regenerated from Edge Function: ${n} URL${n === 1 ? "" : "s"} found.`,
  );
  if (n < 4) {
    console.warn(
      `[generate-sitemap] Suspiciously low URL count (${n}). Verify the Edge Function "sitemap" is on the latest deploy.`,
    );
  }
  await writeFile(OUTPUT, (await withAppRoutes(body)) ?? body, "utf8");
}

/** Fetch failed: the kept file still gets the app routes it lacks. */
async function addAppRoutesToPrevious() {
  const prev = await previousSitemap();
  if (!prev) return;
  const merged = await withAppRoutes(prev);
  if (merged) await writeFile(OUTPUT, merged, "utf8");
}

main().catch((e) => {
  // Defensive: any unexpected throw shouldn't fail the build. Switch to a
  // warning + zero exit.
  console.warn(`[generate-sitemap] unexpected error: ${e?.message ?? e}`);
  process.exitCode = 0;
});
