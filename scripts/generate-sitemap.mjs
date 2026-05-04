// Generates public/sitemap.xml from the list of crawlable routes below.
// Runs as part of `npm run build` (see package.json), so the file always
// reflects the current build's routes.
//
// Note on architecture: this is a Vite SPA whose mode-based pseudo-routes
// (landing, simple, terms, privacy, sport, about, cart) all live at "/"
// with internal state — they don't have unique URLs and therefore can't
// appear in a sitemap. Only the React Router URL paths in App.tsx that
// are public + crawlable are included. Auth-only routes (/my-designs,
// /admin) and interactive ones (/try-on) are excluded on purpose.
//
// There is no DB-driven product catalog (products are TypeScript types
// in src/lib/catalog.ts, not separate URLs), so there's nothing to fetch
// at build time. If product-specific URLs are added later, query them
// here and append to the `urls` array.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_URL = "https://maika.ge";
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "public", "sitemap.xml");

const today = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: "/",          changefreq: "daily",   priority: "1.0" },
  { loc: "/community", changefreq: "weekly",  priority: "0.7" },
  { loc: "/corporate", changefreq: "monthly", priority: "0.5" },
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, changefreq, priority }) => `  <url>
    <loc>${SITE_URL}${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, xml, "utf8");
console.log(`[sitemap] wrote ${urls.length} URLs to ${OUTPUT}`);
