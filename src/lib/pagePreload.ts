// Build-time page data written by the prerender (scripts/lib/seo.mjs
// preloadScript) into <script id="page-preload" type="application/json">,
// outside #root. /blog/:slug and /design/:slug read it so their first render
// shows the real content instead of a spinner while Supabase answers.
//
// Why: Googlebot snapshots the rendered page. With a spinner and SeoHead's
// default title, every post and design looked the same, and Google folded
// them into one canonical ("Duplicate, Google chose different canonical").
//
// The data only applies to the page it was built for: kind + slug must match
// the current route, so a client-side navigation to another post/design gets
// null and fetches as before.

export const PAGE_PRELOAD_ID = "page-preload";

export type PagePreloadKind = "blog" | "design";

/** What the prerender writes for /design/:slug (DesignPreloadView). */
export interface DesignPreload {
  /** designSeoTitle(...) — the page <title>. */
  title: string;
  /** Meta description, as the prerender computed it. */
  description: string;
  image: string | null;
  /** The design's name (h1). */
  name: string;
  /** description_ka, or the meta description when it is empty. */
  body: string;
  categoryLabel: string | null;
}

export function readPagePreload<T>(kind: PagePreloadKind, slug: string | undefined): T | null {
  if (!slug || typeof document === "undefined") return null;
  const el = document.getElementById(PAGE_PRELOAD_ID);
  const text = el?.textContent;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { kind?: unknown; slug?: unknown; data?: unknown };
    if (parsed && parsed.kind === kind && parsed.slug === slug && parsed.data && typeof parsed.data === "object") {
      return parsed.data as T;
    }
  } catch {
    // Malformed preload: behave as if there were none.
  }
  return null;
}
