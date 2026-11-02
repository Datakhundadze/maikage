import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MarkdownView from "@/components/MarkdownView";
import {
  BLOG_TITLE_MAX,
  blogPostSchemas,
  blogPostTitle,
  isInternalHref,
  otherBlogPosts,
} from "@/lib/blogSeo";
import { markdownHtml } from "../../scripts/lib/seo.mjs";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const style = { main: "", nav: "", h1: "", h2: "", h3: "", p: "", ul: "list-style:disc", li: "", footer: "", meta: "", img: "", a: "" };
const h = { esc, link, style };

const POST = {
  slug: "dtf-tu-shelkografia",
  title_ka: "DTF თუ შელკოგრაფია",
  body_md:
    "შესავალი [DTF ბეჭდვა](/dtf-bechdva) და **მეტი**.\n\n## რა არის DTF\nტექსტი [გარე](https://example.com)\n\n### დეტალები\n\n- [ქარგვა](/logos-kargva)\n- [ცუდი](javascript:alert(1))\n- ![](https://x/y.png) <script>x</script>",
  meta_description_ka: "DTF და შელკოგრაფიის შედარება.",
  published_at: "2026-11-01T10:00:00+00:00",
  created_at: "2026-10-31T10:00:00+00:00",
  updated_at: "2026-11-02T09:00:00+00:00",
};

describe("blogPostTitle", () => {
  it("adds ' | maika.ge' and stays within the limit", () => {
    expect(blogPostTitle("Maika.ge x დინამო")).toBe("Maika.ge x დინამო | maika.ge");
    const long = blogPostTitle("ძალიან გრძელი სათაური რომელიც აუცილებლად უნდა შემოკლდეს რადგან ლიმიტს აჭარბებს ბევრად");
    expect(long.length).toBeLessThanOrEqual(BLOG_TITLE_MAX);
    expect(long.endsWith("… | maika.ge")).toBe(true);
  });
});

describe("blogPostSchemas", () => {
  it("BlogPosting + BreadcrumbList with the required fields", () => {
    const [post, crumbs] = blogPostSchemas(POST, "https://cdn/cover.jpg") as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(post["@type"]).toBe("BlogPosting");
    expect(post.headline).toBe(POST.title_ka);
    expect(post.description).toBe(POST.meta_description_ka);
    expect(post.datePublished).toBe(POST.published_at);
    expect(post.dateModified).toBe(POST.updated_at);
    expect(post.image).toBe("https://cdn/cover.jpg");
    expect(post.author).toEqual(post.publisher);
    expect(post.publisher.name).toBe("maika.ge");
    expect(post.publisher.logo.url).toBe("https://maika.ge/maika-logo.png");
    expect(post.mainEntityOfPage["@id"]).toBe(`https://maika.ge/blog/${POST.slug}`);
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["მთავარი", "ბლოგი", POST.title_ka]);
    expect(crumbs.itemListElement[1].item).toBe("https://maika.ge/blog");
  });
  it("no image key without a cover", () => {
    expect("image" in (blogPostSchemas(POST, null)[0] as object)).toBe(false);
  });
});

describe("otherBlogPosts / isInternalHref", () => {
  it("excludes the current post, newest first, max 3", () => {
    const rows = ["a", "b", "c", "d", "e"].map((slug, i) => ({ slug, published_at: `2026-0${i + 1}-01`, created_at: "x" }));
    expect(otherBlogPosts(rows, "e").map((r) => r.slug)).toEqual(["d", "c", "b"]);
  });
  it("internal = single leading slash", () => {
    expect(isInternalHref("/dtf-bechdva")).toBe(true);
    expect(isInternalHref("//evil.com")).toBe(false);
    expect(isInternalHref("https://x")).toBe(false);
  });
});

describe("MarkdownView (runtime)", () => {
  it("internal links are real same-tab <a href>, headings stay headings", () => {
    const { container } = render(
      <MemoryRouter>
        <MarkdownView markdown={POST.body_md} />
      </MemoryRouter>,
    );
    const internal = container.querySelector('a[href="/dtf-bechdva"]');
    expect(internal?.textContent).toBe("DTF ბეჭდვა");
    expect(internal?.getAttribute("target")).toBeNull();
    expect(container.querySelector('a[href="/logos-kargva"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com"]')?.getAttribute("target")).toBe("_blank");
    expect(container.querySelector("h2")?.textContent).toBe("რა არის DTF");
    expect(container.querySelector("h3")?.textContent).toBe("დეტალები");
  });
});

describe("markdownHtml (prerender)", () => {
  const html = markdownHtml(POST.body_md, h);
  it("internal links → crawlable <a href>", () => {
    expect(html).toContain('<a href="/dtf-bechdva">DTF ბეჭდვა</a>');
    expect(html).toContain('<a href="/logos-kargva">ქარგვა</a>');
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
  });
  it("headings, lists; unsafe schemes and raw HTML never pass", () => {
    expect(html).toContain("<h2 style=\"\">რა არის DTF</h2>");
    expect(html).toContain("<h3 style=\"\">დეტალები</h3>");
    expect(html).toMatch(/<ul [^>]*><li/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("y.png");
    expect(html).not.toContain("**");
  });
});

describe("sources", () => {
  const src = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");
  it("BlogPostPage ends with the services block and uses the shared schemas", () => {
    const s = src("src/pages/BlogPostPage.tsx");
    expect(s).toContain("<PrintServicesLinks excludeHref={blogPostPath(post.slug)} />");
    expect(s).toContain("schemas={blogPostSchemas(post, coverOriginal)}");
    expect(s).toContain("title={blogPostTitle(post.title_ka)}");
  });
  it("sitemap edge function dates blog posts by updated_at", () => {
    const s = src("supabase/functions/sitemap/index.ts");
    expect(s).toMatch(/<lastmod>\$\{toDate\(p\.updated_at\)\}<\/lastmod>/);
  });
});
