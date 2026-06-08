// Dynamic sitemap.xml — public, cacheable, includes static routes, the
// catalog list, one URL per distinct category, and one URL per published
// catalog_design with an <image:image> tag pointing at the thumbnail.
//
// Reachable as
//   https://<project-ref>.supabase.co/functions/v1/sitemap
// and proxied to https://maika.ge/sitemap.xml via vercel.json /
// netlify.toml rewrites so the robots.txt Sitemap directive resolves.
//
// Auth: public (verify_jwt = false in supabase/config.toml).
//
// Route note: the catalog list URL is `/designs`, not `/catalog` — the
// spec mentioned /catalog but the actual React Router path in src/App.tsx
// is `/designs`. Emitting /catalog would point crawlers at a 404. The
// category URLs use `/designs?category=<slug>` which currently canonicalize
// to `/designs` because CatalogPage filters in-memory rather than from the
// URL; that's safe (Google merges duplicates via canonical) but a future
// frontend tweak to read the query param would make these URLs uniquely
// indexable.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://maika.ge";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const xmlHeaders = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
  ...corsHeaders,
};

interface DesignRow {
  slug: string;
  title_ka: string;
  updated_at: string | null;
  thumbnail_url: string | null;
  category: string | null;
}

const STATIC_URLS: { loc: string; priority: string; changefreq: string }[] = [
  { loc: "/",          priority: "1.0", changefreq: "daily" },
  { loc: "/designs",   priority: "0.9", changefreq: "daily" },
  { loc: "/corporate", priority: "0.6", changefreq: "monthly" },
];

const ESCAPE: Record<string, string> = {
  "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
};
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ESCAPE[c]);

// Trim a timestamp to YYYY-MM-DD per W3C sitemap spec. Falls back to today
// when the input is missing.
const toDate = (s: string | null | undefined) =>
  (s ?? new Date().toISOString()).slice(0, 10);

function renderStaticOnly(): string {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = STATIC_URLS.map(
    ({ loc, priority, changefreq }) =>
      `  <url>\n` +
      `    <loc>${SITE_URL}${loc}</loc>\n` +
      `    <lastmod>${today}</lastmod>\n` +
      `    <changefreq>${changefreq}</changefreq>\n` +
      `    <priority>${priority}</priority>\n` +
      `  </url>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset\n` +
    `    xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `    xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    blocks.join("\n") +
    `\n</urlset>\n`
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      console.error("[sitemap] missing SUPABASE_URL or SUPABASE_ANON_KEY env");
      // Fall through to static-only rather than 500 — robots prefer a
      // partial sitemap over a broken one.
      return new Response(renderStaticOnly(), { headers: xmlHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from("catalog_designs")
      .select("slug, title_ka, updated_at, thumbnail_url, category")
      .eq("is_published", true)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[sitemap] catalog_designs query failed:", error.message);
      return new Response(renderStaticOnly(), { headers: xmlHeaders });
    }

    const designs = (data ?? []) as DesignRow[];
    const today = new Date().toISOString().slice(0, 10);
    const blocks: string[] = [];

    // Static pages first.
    for (const { loc, priority, changefreq } of STATIC_URLS) {
      blocks.push(
        `  <url>\n` +
        `    <loc>${SITE_URL}${loc}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>`,
      );
    }

    // Category pages — one URL per distinct non-null category, lastmod set
    // to the most recent updated_at among that category's designs so search
    // engines re-crawl the listing when new designs land.
    const categoryLastmod = new Map<string, string>();
    for (const d of designs) {
      if (!d.category) continue;
      const cat = d.category;
      const stamp = toDate(d.updated_at);
      if (!categoryLastmod.has(cat) || stamp > categoryLastmod.get(cat)!) {
        categoryLastmod.set(cat, stamp);
      }
    }
    const categories = [...categoryLastmod.keys()].sort();
    for (const cat of categories) {
      const lastmod = categoryLastmod.get(cat)!;
      blocks.push(
        `  <url>\n` +
        `    <loc>${SITE_URL}/designs?category=${encodeURIComponent(cat)}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.7</priority>\n` +
        `  </url>`,
      );
    }

    // Design detail pages with <image:image> per design so Google Images
    // can index the catalog thumbnails.
    for (const d of designs) {
      const detailUrl = `${SITE_URL}/design/${escapeXml(d.slug)}`;
      const imageBlock = d.thumbnail_url
        ? `    <image:image>\n` +
          `      <image:loc>${escapeXml(d.thumbnail_url)}</image:loc>\n` +
          `      <image:title>${escapeXml(d.title_ka)}</image:title>\n` +
          `    </image:image>\n`
        : "";
      blocks.push(
        `  <url>\n` +
        `    <loc>${detailUrl}</loc>\n` +
        `    <lastmod>${toDate(d.updated_at)}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.8</priority>\n` +
        imageBlock +
        `  </url>`,
      );
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset\n` +
      `    xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
      `    xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
      blocks.join("\n") +
      `\n</urlset>\n`;

    return new Response(xml, { headers: xmlHeaders });
  } catch (e) {
    console.error("[sitemap] unexpected error:", e);
    // Last-resort fallback: still return a valid sitemap with the static
    // routes so robots get *something* indexable.
    return new Response(renderStaticOnly(), { headers: xmlHeaders });
  }
});
