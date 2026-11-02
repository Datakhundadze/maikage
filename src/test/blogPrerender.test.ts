// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as blogSeo from "@/lib/blogSeo";
import { BLOG_OTHER_POSTS_HEADING, blogPostSchemas, blogPostTitle } from "@/lib/blogSeo";
import { PRINT_SERVICES_HEADING, printServiceLinksFor } from "@/lib/serviceRouteSlugs";
import { blogPostPage, printServicesHtml } from "../../scripts/lib/seo.mjs";
import { loadAppModules } from "../../scripts/lib/appModules.mjs";

// The prerender loads lib/blogSeo.ts through its own Vite loader; the static
// /blog/:slug page must carry the same title / JSON-LD as the live one, plus
// the services block and "სხვა სტატიები".

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const style = { main: "", nav: "", h1: "", h2: "", h3: "", p: "", ul: "list-style:disc", li: "", footer: "", meta: "", img: "", a: "" };
const h = { esc, link, style };

const POST = {
  slug: "dtf-tu-shelkografia",
  title_ka: "DTF თუ შელკოგრაფია",
  body_md: "შესავალი [DTF ბეჭდვა](/dtf-bechdva).\n\n## რა არის DTF\nტექსტი",
  meta_description_ka: "DTF და შელკოგრაფიის შედარება.",
  published_at: "2026-11-01T10:00:00+00:00",
  created_at: "2026-10-31T10:00:00+00:00",
  updated_at: "2026-11-02T09:00:00+00:00",
};

describe("blogPostPage (prerender) uses lib/blogSeo.ts", () => {
  it("loadAppModules exposes the same builders; page has title, h1, JSON-LD, services, others", async () => {
    const app = await loadAppModules("[test]");
    expect(app).not.toBeNull();
    expect(app!.BLOG_INDEX_SEO).toEqual(blogSeo.BLOG_INDEX_SEO);
    expect(app!.blogPostTitle(POST.title_ka)).toBe(blogPostTitle(POST.title_ka));
    expect(app!.blogPostSchemas(POST, null)).toEqual(blogPostSchemas(POST, null));

    const others = [{ slug: "other-1", title_ka: "სხვა 1", published_at: "2026-10-01", created_at: "" }];
    const services = printServicesHtml(
      { heading: PRINT_SERVICES_HEADING, links: printServiceLinksFor(`/blog/${POST.slug}`) },
      h,
      `/blog/${POST.slug}`,
    );
    const page = blogPostPage(POST, null, app!, h, { servicesHtml: services, others });
    expect(page.title).toBe("DTF თუ შელკოგრაფია | maika.ge");
    expect(page.description).toBe(POST.meta_description_ka);
    expect(page.jsonLd.map((s: { "@type"?: string }) => s["@type"])).toEqual(["BlogPosting", "BreadcrumbList"]);
    expect(page.rootHtml).toContain(`<h1 style="">${POST.title_ka}</h1>`);
    expect(page.rootHtml.match(/<h1/g)).toHaveLength(1);
    expect(page.rootHtml).toContain(services);
    for (const l of printServiceLinksFor()) expect(page.rootHtml).toContain(link(l.href, l.label));
    expect(page.rootHtml).toContain(BLOG_OTHER_POSTS_HEADING);
    expect(page.rootHtml).toContain('<a href="/blog/other-1">სხვა 1</a>');
  }, 30_000);
});

