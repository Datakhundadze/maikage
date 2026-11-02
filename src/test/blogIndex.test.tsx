import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

// /blog sections + cover_path forms (lib/blogSeo.ts), the same on the live
// pages (BlogPage, BlogPostPage) and in the prerender (scripts/lib/seo.mjs).

const ROWS = vi.hoisted(() => ({
  blog_posts: [] as Record<string, unknown>[],
}));

vi.mock("@/components/AppHeader", () => ({ default: () => null }));
vi.mock("@/components/PrintServicesLinks", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  // Every query-builder call returns the builder; awaiting it yields the rows.
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve({ data: ROWS.blog_posts, error: null });
    return q;
  };
  return {
    supabase: {
      from: () => query(),
      storage: {
        from: (bucket: string) => ({
          getPublicUrl: (key: string) => ({
            data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${key}` },
          }),
        }),
      },
    },
  };
});

import BlogPage from "@/pages/BlogPage";
import BlogPostPage from "@/pages/BlogPostPage";
import MarkdownView from "@/components/MarkdownView";
import {
  BLOG_ARTICLES_HEADING,
  BLOG_CARD_COVER,
  BLOG_INDEX_H1,
  BLOG_INDEX_INTRO,
  BLOG_PARTNERS_HEADING,
  blogCover,
  blogIndexSections,
  blogPostSchemas,
} from "@/lib/blogSeo";
import { LIST_PAGES, blogIndexHtml, blogPostPage } from "../../scripts/lib/seo.mjs";
import * as blogSeo from "@/lib/blogSeo";

const ROOT = path.resolve(__dirname, "../..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const style = { main: "", nav: "", h1: "", h2: "", h3: "", p: "", ul: "list-style:disc", li: "", footer: "", meta: "", img: "", a: "" };
const h = { esc, link, style };

const storageUrl = (key: string) => `https://x.supabase.co/storage/v1/object/public/blog/${key}`;

const POSTS = [
  { slug: "dtf-tu-shologkrafia", title_ka: "DTF თუ შოლკოგრაფია", cover_path: "/blog/storefront.webp", meta_description_ka: "შედარება.", published_at: "2026-10-01T10:00:00Z", created_at: "2026-10-01T10:00:00Z" },
  { slug: "maikage-x-dinamo", title_ka: "Maika.ge x დინამო", cover_path: "covers/dinamo.jpg", meta_description_ka: "კოლაბორაცია.", published_at: "2026-10-20T10:00:00Z", created_at: "2026-10-20T10:00:00Z" },
  { slug: "rogor-avirchiot-zoma", title_ka: "როგორ ავირჩიოთ ზომა", cover_path: "https://cdn.example.com/a.webp", meta_description_ka: "ზომები.", published_at: "2026-10-25T10:00:00Z", created_at: "2026-10-25T10:00:00Z" },
  { slug: "maikage-x-nike", title_ka: "Maika.ge x Nike", cover_path: null, meta_description_ka: null, published_at: "2026-09-01T10:00:00Z", created_at: "2026-09-01T10:00:00Z" },
];

describe("blogCover — cover_path forms", () => {
  it("site-relative path: src as is, absolute on maika.ge", () => {
    expect(blogCover("/blog/storefront.webp", storageUrl)).toEqual({
      src: "/blog/storefront.webp",
      absolute: "https://maika.ge/blog/storefront.webp",
      kind: "site",
    });
  });

  it("https URL: used as is", () => {
    expect(blogCover("https://cdn.example.com/a.webp", storageUrl)).toEqual({
      src: "https://cdn.example.com/a.webp",
      absolute: "https://cdn.example.com/a.webp",
      kind: "url",
    });
  });

  it("storage key: the blog bucket's public URL", () => {
    expect(blogCover("covers/x.jpg", storageUrl)).toEqual({ src: storageUrl("covers/x.jpg"), absolute: storageUrl("covers/x.jpg"), kind: "storage" });
    expect(blogCover("  x.jpg ", storageUrl)?.absolute).toBe(storageUrl("x.jpg"));
  });

  it("nothing, protocol-relative, http and other schemes: no cover", () => {
    for (const bad of [null, undefined, "", "   ", "//evil.example/x.jpg", "/\\evil", "http://x.com/a.jpg", "javascript:alert(1)", "data:image/png;base64,xx", "/blog/a b.webp"]) {
      expect(blogCover(bad, storageUrl), String(bad)).toBeNull();
    }
  });

  it("JSON-LD image and og:image get the absolute URL", () => {
    const post = { ...POSTS[0], body_md: "ტექსტი", updated_at: null };
    const cover = blogCover(post.cover_path, storageUrl)!;
    const [posting] = blogPostSchemas(post, cover.absolute) as [{ image: string }];
    expect(posting.image).toBe("https://maika.ge/blog/storefront.webp");
  });

  it("prerender resolves cover_path with the same helper for og:image, JSON-LD and <img>", () => {
    const pre = source("scripts/prerender.mjs");
    expect(pre).toContain("if (blogApp) return blogApp.blogCover(p.cover_path, storageUrl);");
    expect(pre).toContain("const coverUrl = coverOf(p)?.absolute ?? null;");
    expect(pre).toContain("image: coverUrl ?? DEFAULT_OG_IMAGE,");
    expect(source("src/pages/BlogPostPage.tsx")).toContain("image={coverOriginal ?? undefined}");
    expect(source("src/pages/BlogPostPage.tsx")).toContain("schemas={blogPostSchemas(post, coverOriginal)}");
  });

  it("static /blog/:slug: cover first, then the single h1", () => {
    const post = { ...POSTS[0], body_md: "# სათაური ტექსტში\n\nტექსტი", updated_at: null };
    const app = { ...blogSeo };
    const page = blogPostPage(post, "https://maika.ge/blog/storefront.webp", app, h);
    expect(page.rootHtml).toContain('<img src="https://maika.ge/blog/storefront.webp" alt="DTF თუ შოლკოგრაფია"');
    expect(page.rootHtml.indexOf("<img")).toBeLessThan(page.rootHtml.indexOf("<h1"));
    expect(page.rootHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(page.rootHtml).toContain("<h2 style=\"\">სათაური ტექსტში</h2>");
    expect((page.jsonLd[0] as { image: string }).image).toBe("https://maika.ge/blog/storefront.webp");
  });
});

describe("/blog sections", () => {
  it("articles first, then maikage-x- partnerships; each newest first", () => {
    const sections = blogIndexSections(POSTS);
    expect(sections.map((s) => s.heading)).toEqual([BLOG_ARTICLES_HEADING, BLOG_PARTNERS_HEADING]);
    expect(sections[0].posts.map((p) => p.slug)).toEqual(["rogor-avirchiot-zoma", "dtf-tu-shologkrafia"]);
    expect(sections[1].posts.map((p) => p.slug)).toEqual(["maikage-x-dinamo", "maikage-x-nike"]);
    expect(BLOG_ARTICLES_HEADING).toBe("სტატიები და რჩევები");
    expect(BLOG_PARTNERS_HEADING).toBe("პარტნიორობები და კოლაბორაციები");
  });

  it("an empty section is left out", () => {
    expect(blogIndexSections(POSTS.filter((p) => p.slug.startsWith("maikage-x-"))).map((s) => s.key)).toEqual(["partners"]);
    expect(blogIndexSections([])).toEqual([]);
  });

  it("H1 / intro: one source for BlogPage, the prerender and llms.txt", () => {
    expect(BLOG_INDEX_H1).toBe("maika.ge ბლოგი");
    expect(LIST_PAGES.blog).toEqual({ h1: BLOG_INDEX_H1, intro: BLOG_INDEX_INTRO });
    expect(BLOG_INDEX_INTRO).toMatch(/[ა-ჰ]/);
    expect(BLOG_INDEX_INTRO).not.toMatch(/[Ѐ-ӿ]|₾|ლარ/);
  });

  it("static /blog: h1, intro, two sections, cards with lazy cover, size, alt and crawlable links", () => {
    const html = blogIndexHtml(blogIndexSections(POSTS), h, {
      h1: BLOG_INDEX_H1,
      intro: BLOG_INDEX_INTRO,
      cover: BLOG_CARD_COVER,
      coverFor: (p: { cover_path: string | null }) => blogCover(p.cover_path, storageUrl)?.src ?? null,
      dateOf: (p: { published_at: string }) => ({ iso: p.published_at.slice(0, 10), text: p.published_at.slice(0, 10) }),
      excerptOf: (p: { meta_description_ka: string | null }) => p.meta_description_ka ?? "",
    });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`<h1 style="">${BLOG_INDEX_H1}</h1>`);
    expect(html).toContain(BLOG_INDEX_INTRO);
    expect(html.indexOf(BLOG_ARTICLES_HEADING)).toBeLessThan(html.indexOf(BLOG_PARTNERS_HEADING));
    expect(html.indexOf("/blog/rogor-avirchiot-zoma")).toBeLessThan(html.indexOf("/blog/dtf-tu-shologkrafia"));
    expect(html.indexOf("/blog/dtf-tu-shologkrafia")).toBeLessThan(html.indexOf(BLOG_PARTNERS_HEADING));
    expect(html).toContain(
      `<a href="/blog/dtf-tu-shologkrafia"><img src="/blog/storefront.webp" alt="DTF თუ შოლკოგრაფია" width="${BLOG_CARD_COVER.width}" height="${BLOG_CARD_COVER.height}" loading="lazy"`,
    );
    for (const p of POSTS) expect(html).toContain(link(`/blog/${p.slug}`, p.title_ka));
    expect(html).toContain("<p style=\"\">შედარება.</p>");
    expect(html).toContain('<time datetime="2026-10-01">');
    // No cover → no <img> for that card.
    expect(html.match(/<img\b/g)).toHaveLength(3);
  });

  it("the prerender writes /blog with blogIndexHtml when the app modules load", () => {
    const pre = source("scripts/prerender.mjs");
    expect(pre).toContain("blogIndexHtml(blogApp.blogIndexSections(listed), { esc, link, style: STYLE }, {");
    expect(pre).toContain("h1: blogApp.BLOG_INDEX_H1,");
  });
});

describe("BlogPage (live)", () => {
  it("renders the h1, intro, both sections in order, and cards with cover, title link, excerpt and date", async () => {
    ROWS.blog_posts = POSTS;
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/blog"]}>
          <BlogPage />
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: BLOG_INDEX_H1 })).toBeInTheDocument();
    expect(screen.getByText(BLOG_INDEX_INTRO)).toBeInTheDocument();
    const h2s = await screen.findAllByRole("heading", { level: 2 });
    expect(h2s.map((e) => e.textContent)).toEqual([BLOG_ARTICLES_HEADING, BLOG_PARTNERS_HEADING]);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((e) => e.textContent);
    expect(titles).toEqual(["როგორ ავირჩიოთ ზომა", "DTF თუ შოლკოგრაფია", "Maika.ge x დინამო", "Maika.ge x Nike"]);
    const img = document.querySelector('img[alt="DTF თუ შოლკოგრაფია"]')!;
    expect(img.getAttribute("src")).toBe("/blog/storefront.webp");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe(String(BLOG_CARD_COVER.width));
    expect(img.getAttribute("height")).toBe(String(BLOG_CARD_COVER.height));
    expect(document.querySelector('img[alt="Maika.ge x დინამო"]')!.getAttribute("src")).toContain(
      "/storage/v1/render/image/public/blog/covers/dinamo.jpg",
    );
    expect(document.querySelector('img[alt="როგორ ავირჩიოთ ზომა"]')!.getAttribute("src")).toBe("https://cdn.example.com/a.webp");
    expect(screen.getByRole("link", { name: "DTF თუ შოლკოგრაფია" }).getAttribute("href")).toBe("/blog/dtf-tu-shologkrafia");
    expect(screen.getByText("შედარება.")).toBeInTheDocument();
  });
});

describe("BlogPostPage (live)", () => {
  it('cover_path "/blog/storefront.webp": cover above the single h1; og:image absolute; markdown "#" is an h2', async () => {
    ROWS.blog_posts = [{ ...POSTS[0], body_md: "# შიდა სათაური\n\nტექსტი", updated_at: "2026-10-02T10:00:00Z" }];
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/blog/dtf-tu-shologkrafia"]}>
          <Routes>
            <Route path="/blog/:slug" element={<BlogPostPage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const h1 = await screen.findByRole("heading", { level: 1, name: "DTF თუ შოლკოგრაფია" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "შიდა სათაური" })).toBeInTheDocument();
    const img = document.querySelector('img[alt="DTF თუ შოლკოგრაფია"]')!;
    expect(img.getAttribute("src")).toBe("/blog/storefront.webp");
    expect(img.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://maika.ge/blog/storefront.webp"),
    );
  });
});

describe("MarkdownView", () => {
  it('a markdown "# " renders as <h2> — the page owns the single <h1>', () => {
    const { container } = render(
      <MemoryRouter>
        <MarkdownView markdown={"# სათაური\n\n## ქვესათაური\n\nტექსტი"} />
      </MemoryRouter>,
    );
    expect(container.querySelector("h1")).toBeNull();
    expect([...container.querySelectorAll("h2")].map((e) => e.textContent)).toEqual(["სათაური", "ქვესათაური"]);
  });
});

describe("public/blog covers", () => {
  const EXPECTED = [
    "hoodies.webp",
    "racks-typewriter.webp",
    "racks.webp",
    "showroom.webp",
    "storefront.webp",
    "tshirts-colors.webp",
    "wall-printed-tees.webp",
    "white-tees.webp",
  ];

  it("the eight covers exist as WebP, at most 1600 px wide", () => {
    expect(readdirSync(path.join(ROOT, "public/blog")).sort()).toEqual(EXPECTED);
    for (const f of EXPECTED) {
      const buf = readFileSync(path.join(ROOT, "public/blog", f));
      expect(buf.subarray(0, 4).toString("ascii"), f).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii"), f).toBe("WEBP");
      // VP8 / VP8L / VP8X width lives at a format-specific offset; sharp wrote VP8 (lossy).
      const chunk = buf.subarray(12, 16).toString("ascii");
      if (chunk === "VP8 ") {
        const width = buf.readUInt16LE(26) & 0x3fff;
        expect(width, f).toBeLessThanOrEqual(1600);
        expect(width, f).toBeGreaterThan(0);
      }
    }
  });
});
