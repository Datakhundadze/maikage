// On-demand sitemap.xml generator. Static routes plus every published
// catalog_designs row. Reachable as
//   https://<project-ref>.supabase.co/functions/v1/sitemap
// and proxied at https://maika.ge/sitemap.xml via vercel.json / netlify.toml
// rewrites so robots.txt's existing Sitemap directive keeps working.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://maika.ge";

interface DesignRow {
  slug: string;
  updated_at: string | null;
  published_at: string | null;
}

const STATIC_URLS: { loc: string; priority: string; changefreq: string }[] = [
  { loc: "/",          priority: "1.0", changefreq: "daily" },
  { loc: "/designs",   priority: "0.8", changefreq: "daily" },
  { loc: "/community", priority: "0.7", changefreq: "weekly" },
  { loc: "/corporate", priority: "0.5", changefreq: "monthly" },
];

const ESCAPE: Record<string, string> = {
  "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
};
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ESCAPE[c]);
const isoDate = (s: string | null | undefined) =>
  (s ?? new Date().toISOString()).slice(0, 10);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      // Anon key is enough — RLS already restricts SELECT to is_published=true rows.
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("catalog_designs")
      .select("slug, updated_at, published_at")
      .eq("is_published", true)
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    const blocks: string[] = [];

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

    for (const d of (data as DesignRow[] | null) ?? []) {
      blocks.push(
        `  <url>\n` +
        `    <loc>${SITE_URL}/design/${escapeXml(d.slug)}</loc>\n` +
        `    <lastmod>${isoDate(d.updated_at ?? d.published_at)}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.7</priority>\n` +
        `  </url>`,
      );
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      blocks.join("\n") +
      `\n</urlset>\n`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("[sitemap]", e);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
});
