// Build-time prerender for /design/:slug and /blog/:slug. Runs AFTER
// `vite build` and writes one static HTML file per published row:
//
//   dist/design/<slug>/index.html
//   dist/blog/<slug>/index.html
//
// Why this exists: the SPA shell (dist/index.html) is byte-identical for every
// URL, so a crawler that doesn't run JS — or snapshots before the data fetch
// lands — sees the generic homepage title and an empty <div id="root">. The
// static host serves dist/<path>/index.html for a request to /<path> (verified
// on production with a probe), so a file here becomes the raw response.
//
// Each file is dist/index.html with:
//   - <head>: title, description, canonical, og:title/description/url/image
//     set per row. Every tag except <title> carries data-rh="true", the marker
//     react-helmet-async 2.x uses to find the tags it owns (`meta[data-rh]`,
//     `link[data-rh]`). On mount Helmet adopts or replaces them instead of
//     appending duplicates; <title> is set through document.title, so there is
//     only ever one.
//   - <div id="root">: plain semantic HTML (h1, image, text, links). React's
//     createRoot replaces it on mount.
//
// No price is rendered and no Product JSON-LD is emitted: price comes from
// pricing.ts at runtime only, and the runtime page still emits its JSON-LD.
//
// Data: Supabase REST with the public anon key and the same filters the pages
// use (catalog_designs.is_published = true, blog_posts.published = true).
//
// Failure mode: never fails the build. A fetch error, zero rows, a missing
// template or a throw inside one page logs a warning; the process exits 0 and
// the SPA fallback keeps serving those URLs exactly as before.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const TEMPLATE = resolve(DIST, "index.html");
const SITE_URL = "https://maika.ge";
const LOG = "[prerender]";

const FETCH_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 1000;

// ── Helpers ─────────────────────────────────────────────────────────────────

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);

/** Slugs become directory names — reject anything that could escape dist/<kind>/. */
function unsafeSlugReason(slug) {
  if (typeof slug !== "string" || slug.trim() === "") return "empty";
  if (slug.includes("/")) return 'contains "/"';
  if (slug.includes("\\")) return 'contains "\\"';
  if (slug.includes("..")) return 'contains ".."';
  if (/[\u0000-\u001f\u007f]/.test(slug)) return "contains a control character";
  return null;
}

/** Resolve dist/<kind>/<slug>/index.html and prove it stays inside dist/<kind>/. */
function outputPath(kind, slug) {
  const base = resolve(DIST, kind);
  const file = resolve(base, slug, "index.html");
  if (!file.startsWith(base + sep)) throw new Error(`path escapes dist/${kind}: ${file}`);
  return file;
}

// Mirrors src/lib/categories.ts (label_ka by slug). Used only for the
// no-price description fallback below.
const CATEGORY_LABEL = {
  georgian: "ქართული",
  patriotic: "პატრიოტული",
  humor: "სასაცილო",
  music: "მუსიკა",
  movies: "კინო",
  "georgian-table": "ქართული სუფრა",
  couples: "წყვილები",
  art: "ხელოვნება",
  animals: "ცხოველები",
  "auto-moto": "აუტო-მოტო",
  sports: "სპორტი",
  professions: "პროფესიები",
  seasonal: "სეზონური",
  travel: "მოგზაურობა",
  various: "სხვადასხვა",
};

/**
 * Design meta description WITHOUT price. Follows the order of
 * src/lib/designMetaDescription.ts — and is identical to it whenever
 * meta_description_ka is set — but drops the "ფასი ₾…" segment, because the
 * price is computed by pricing.ts at runtime and must not be baked in here.
 * Where it differs, SeoHead replaces it on mount.
 */
function designDescription(d) {
  const explicit = d.meta_description_ka?.trim();
  if (explicit) return explicit;

  const longForm = d.description_ka?.trim();
  if (longForm && longForm.length >= 40) {
    const MAX_PREFIX = 120;
    let prefix = longForm.length > MAX_PREFIX ? longForm.slice(0, MAX_PREFIX) : longForm;
    if (longForm.length > MAX_PREFIX) {
      const lastSpace = prefix.lastIndexOf(" ");
      if (lastSpace > 60) prefix = prefix.slice(0, lastSpace);
      prefix = prefix.trimEnd().replace(/[,.;:!?—–-]+$/u, "");
    }
    const tail = /maika\.ge/i.test(prefix) ? "" : " შეუკვეთე Maika.ge-ზე.";
    return (prefix + tail).trim();
  }

  const label = d.category ? CATEGORY_LABEL[d.category] ?? d.category : null;
  return label
    ? `${d.title_ka} — უნიკალური ${label} დიზაინი მაისურზე. DTF ბეჭდვა მაღალი ხარისხით. შეუკვეთე ონლაინ Maika.ge-ზე.`
    : `${d.title_ka} — უნიკალური დიზაინი მაისურზე. DTF ბეჭდვა მაღალი ხარისხით. შეუკვეთე ონლაინ Maika.ge-ზე.`;
}

// Same rough markdown → plain text as BlogPostPage's excerpt().
function excerpt(md, max = 155) {
  const text = String(md ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~-]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Inline styles for the static #root content. It is on screen until the JS
// bundle runs, so it should look intentional — but it must not touch the app:
// inline style attributes only (no <style> block, no class names), and no
// colours. Before main.tsx runs <html> has no theme class, so the shipped CSS
// paints body with the light :root palette (hsl(0 0% 95%) / hsl(240 6% 10%));
// main.tsx then adds .dark (default) or .green. Inheriting colour from body
// keeps the text readable in all three. Tailwind preflight zeroes heading and
// paragraph margins/sizes and strips link underlines, hence the explicit
// values below. Top padding clears the 56px (h-14) AppHeader.
const STYLE = {
  main: "box-sizing:border-box;max-width:720px;margin:0 auto;padding:80px 20px 48px;line-height:1.6;font-size:16px",
  nav: "font-size:14px;opacity:.75;margin:0 0 16px",
  h1: "font-size:28px;line-height:1.25;font-weight:700;margin:0 0 16px",
  h2: "font-size:22px;line-height:1.3;font-weight:700;margin:28px 0 12px",
  h3: "font-size:18px;line-height:1.35;font-weight:700;margin:24px 0 8px",
  p: "margin:0 0 16px",
  meta: "font-size:14px;opacity:.75;margin:0 0 16px",
  img: "display:block;max-width:100%;height:auto;margin:0 auto 24px;border-radius:16px",
  a: "color:inherit;text-decoration:underline;text-underline-offset:2px",
  footer: "margin:32px 0 0;font-size:14px",
};
const link = (href, text) => `<a href="${esc(href)}" style="${STYLE.a}">${esc(text)}</a>`;

/**
 * Markdown → minimal escaped HTML for crawlers: headings and paragraphs only.
 * Images are dropped, links keep their text, inline markers are stripped.
 * Every text node is escaped; no markup from the source passes through.
 */
function markdownToHtml(md) {
  const inline = (s) =>
    esc(
      s
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`~]+/g, "")
        .trim(),
    );
  return String(md ?? "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const h = /^(#{1,6})\s+(.*)$/s.exec(block);
      if (h) {
        const level = Math.min(Math.max(h[1].length, 2), 6); // the page owns the single <h1>
        const text = inline(h[2].replace(/\s+/g, " "));
        return text ? `<h${level} style="${level === 2 ? STYLE.h2 : STYLE.h3}">${text}</h${level}>` : "";
      }
      const text = block
        .split("\n")
        .map((line) => inline(line.replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, "")))
        .filter(Boolean)
        .join("<br>");
      return text ? `<p style="${STYLE.p}">${text}</p>` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Shell + per-page head tags + root content. */
function renderPage(template, { title, description, canonical, image, rootHtml }) {
  const tags = [
    `<meta data-rh="true" name="description" content="${esc(description)}" />`,
    `<link data-rh="true" rel="canonical" href="${esc(canonical)}" />`,
    `<meta data-rh="true" property="og:title" content="${esc(title)}" />`,
    `<meta data-rh="true" property="og:description" content="${esc(description)}" />`,
    `<meta data-rh="true" property="og:url" content="${esc(canonical)}" />`,
    ...(image ? [`<meta data-rh="true" property="og:image" content="${esc(image)}" />`] : []),
  ].join("\n    ");

  let html = template;
  // The shell's own description has no data-rh, so Helmet would never remove
  // it; drop it here so the file carries exactly one description.
  html = html.replace(/[ \t]*<meta\s+name="description"[^>]*>[ \t]*\n?/i, "");
  html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${esc(title)}</title>`);
  html = html.replace(/<\/head>/i, () => `    ${tags}\n  </head>`);
  html = html.replace(/<div id="root"><\/div>/, () => `<div id="root">${rootHtml}</div>`);
  return html;
}

/** One-line cause for a failed fetch: timeout, socket error code, or HTTP status. */
function reason(e) {
  if (e?.name === "AbortError") return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  const c = e?.cause;
  const detail = c?.code ?? c?.errors?.[0]?.code ?? c?.message;
  return String(detail ? `${e.message} (${detail})` : e?.message ?? e).replace(/\.$/, "");
}

// ── Data ────────────────────────────────────────────────────────────────────

function supabaseConfig() {
  // loadEnv reads the same .env files vite build just used.
  const env = { ...loadEnv("production", ROOT, "VITE_"), ...process.env };
  const url = env.PRERENDER_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not set");
  return { url: url.replace(/\/+$/, ""), publicUrl: (env.VITE_SUPABASE_URL || url).replace(/\/+$/, ""), key };
}

async function fetchAll({ url, key }, table, select, filter) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const qs = `select=${select}&${filter}&order=slug.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`${table}: response is not an array`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// ── Pages ───────────────────────────────────────────────────────────────────

function designRoot(d, description) {
  const image = d.thumbnail_url || d.print_file_url;
  const label = d.category ? CATEGORY_LABEL[d.category] ?? d.category : null;
  const body = d.description_ka?.trim() || description;
  return [
    `<main style="${STYLE.main}">`,
    `<nav style="${STYLE.nav}">${link("/", "მთავარი")} › ${link("/designs", "კატალოგი")}${label ? ` › ${esc(label)}` : ""}</nav>`,
    `<h1 style="${STYLE.h1}">${esc(d.title_ka)}</h1>`,
    image ? `<img src="${esc(image)}" alt="${esc(d.title_ka)}" width="800" height="800" style="${STYLE.img}">` : "",
    `<p style="${STYLE.p}">${esc(body)}</p>`,
    `<p style="${STYLE.footer}">${link("/designs", "ყველა დიზაინი კატალოგში")} · ${link("/", "Maika.ge მთავარი")}</p>`,
    `</main>`,
  ].filter(Boolean).join("\n");
}

function blogRoot(p, coverUrl) {
  const date = String(p.published_at ?? p.created_at ?? "").slice(0, 10);
  return [
    `<main style="${STYLE.main}">`,
    `<nav style="${STYLE.nav}">${link("/", "მთავარი")} › ${link("/blog", "ბლოგი")}</nav>`,
    `<article>`,
    `<h1 style="${STYLE.h1}">${esc(p.title_ka)}</h1>`,
    date ? `<p style="${STYLE.meta}"><time datetime="${esc(date)}">${esc(date)}</time></p>` : "",
    coverUrl ? `<img src="${esc(coverUrl)}" alt="${esc(p.title_ka)}" style="${STYLE.img}">` : "",
    markdownToHtml(p.body_md),
    `</article>`,
    `<p style="${STYLE.footer}">${link("/blog", "ყველა სტატია")} · ${link("/", "Maika.ge მთავარი")}</p>`,
    `</main>`,
  ].filter(Boolean).join("\n");
}

async function emit(kind, rows, build, stats) {
  for (const row of rows) {
    const reason = unsafeSlugReason(row?.slug);
    if (reason) {
      stats.skipped.push(`${kind}: ${JSON.stringify(row?.slug)} (${reason})`);
      continue;
    }
    try {
      const file = outputPath(kind, row.slug);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, build(row), "utf8");
      stats[kind]++;
    } catch (e) {
      stats.failed.push(`${kind}/${row.slug}: ${e?.message ?? e}`);
    }
  }
}

async function main() {
  const started = Date.now();
  let template;
  try {
    template = await readFile(TEMPLATE, "utf8");
  } catch {
    console.warn(`${LOG} dist/index.html not found — run after vite build. Skipping prerender.`);
    return;
  }
  if (!/<div id="root"><\/div>/.test(template) || !/<\/head>/i.test(template)) {
    console.warn(`${LOG} dist/index.html has no empty <div id="root"> or </head> — template changed? Skipping prerender.`);
    return;
  }

  let cfg;
  try {
    cfg = supabaseConfig();
  } catch (e) {
    console.warn(`${LOG} ${e.message}. Skipping prerender; SPA fallback serves these URLs.`);
    return;
  }

  const stats = { design: 0, blog: 0, skipped: [], failed: [] };

  // Designs
  try {
    const designs = await fetchAll(
      cfg,
      "catalog_designs",
      "slug,title_ka,thumbnail_url,print_file_url,category,meta_description_ka,description_ka",
      "is_published=eq.true",
    );
    if (designs.length === 0) console.warn(`${LOG} catalog_designs returned 0 published rows — no design pages written.`);
    await emit("design", designs, (d) => {
      const description = designDescription(d);
      return renderPage(template, {
        title: `${d.title_ka} — Maika.ge`,
        description,
        canonical: `${SITE_URL}/design/${d.slug}`,
        image: d.thumbnail_url || d.print_file_url,
        rootHtml: designRoot(d, description),
      });
    }, stats);
  } catch (e) {
    console.warn(`${LOG} WARNING: design fetch failed: ${reason(e)}. No design pages written; SPA fallback serves /design/*.`);
  }

  // Blog posts
  try {
    const posts = await fetchAll(
      cfg,
      "blog_posts",
      "slug,title_ka,body_md,cover_path,meta_description_ka,published_at,created_at",
      "published=eq.true",
    );
    if (posts.length === 0) console.warn(`${LOG} blog_posts returned 0 published rows — no blog pages written.`);
    await emit("blog", posts, (p) => {
      // Same URL supabase.storage.from("blog").getPublicUrl(cover_path) builds.
      const coverUrl = p.cover_path ? `${cfg.publicUrl}/storage/v1/object/public/blog/${p.cover_path}` : null;
      return renderPage(template, {
        title: `${p.title_ka} — Maika.ge ბლოგი`,
        description: p.meta_description_ka || excerpt(p.body_md),
        canonical: `${SITE_URL}/blog/${p.slug}`,
        image: coverUrl,
        rootHtml: blogRoot(p, coverUrl),
      });
    }, stats);
    // With dist/blog/ now a real directory, keep /blog itself (the list page)
    // on the SPA shell regardless of how the host treats a directory without
    // an index: write the shell there byte-for-byte.
    if (stats.blog > 0) await writeFile(resolve(DIST, "blog", "index.html"), template, "utf8");
  } catch (e) {
    console.warn(`${LOG} WARNING: blog fetch failed: ${reason(e)}. No blog pages written; SPA fallback serves /blog/*.`);
  }

  for (const s of stats.skipped) console.warn(`${LOG} skipped unsafe slug — ${s}`);
  for (const f of stats.failed) console.warn(`${LOG} WARNING: page failed — ${f}`);
  console.log(
    `${LOG} wrote ${stats.design} design + ${stats.blog} blog pages` +
      ` (${stats.skipped.length} skipped, ${stats.failed.length} failed) in ${Date.now() - started}ms.`,
  );
}

main()
  .catch((e) => console.warn(`${LOG} unexpected error: ${e?.message ?? e}. Build continues.`))
  .finally(() => {
    process.exitCode = 0;
  });
