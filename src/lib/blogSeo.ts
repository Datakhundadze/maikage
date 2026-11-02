// Blog SEO — shared by the live pages (BlogPostPage, BlogPage) and the static
// prerender (scripts/prerender.mjs loads this module through
// scripts/lib/appModules.mjs), so the raw HTML a crawler gets and the page a
// visitor sees carry the same <title>, description and JSON-LD.
//
// Pure: no React, no DOM, no Supabase.

import { SITE_URL, buildBreadcrumbList } from "@/lib/seoSchemas";

export const BLOG_BRAND = "maika.ge";
export const BLOG_LOGO_URL = `${SITE_URL}/maika-logo.png`;
export const BLOG_TITLE_MAX = 65;
export const BLOG_OTHER_POSTS_HEADING = "სხვა სტატიები";
export const BLOG_OTHER_POSTS_MAX = 3;

/** /blog — BlogPage's SeoHead (also the prerendered /blog head). */
export const BLOG_INDEX_SEO = {
  title: "ბლოგი — Maika.ge სიახლეები და ივენთები",
  description: "Maika.ge-ის სიახლეები: პარტნიორული ივენთები, ბანაკები, კოლაბორაციები და ბექსთეიჯი.",
} as const;

export interface BlogPostSeoInput {
  slug: string;
  title_ka: string;
  body_md?: string | null;
  meta_description_ka?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const blogPostPath = (slug: string) => `/blog/${slug}`;
export const blogPostUrl = (slug: string) => `${SITE_URL}${blogPostPath(slug)}`;

/**
 * "<title_ka> | maika.ge", at most BLOG_TITLE_MAX characters: a longer
 * title_ka is cut at the last word boundary that fits and closed with "…".
 */
export function blogPostTitle(titleKa: string): string {
  const suffix = ` | ${BLOG_BRAND}`;
  const title = String(titleKa ?? "").replace(/\s+/g, " ").trim();
  const room = BLOG_TITLE_MAX - suffix.length;
  if (title.length <= room) return `${title}${suffix}`;
  let cut = title.slice(0, room - 1);
  const space = cut.lastIndexOf(" ");
  if (space > room / 2) cut = cut.slice(0, space);
  cut = cut.replace(/[\s,.;:!?|—–-]+$/u, "");
  return `${cut}…${suffix}`;
}

/** Rough markdown → plain-text excerpt (meta-description fallback). */
export function blogExcerpt(md: string | null | undefined, max = 155): string {
  const text = String(md ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~-]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function blogPostDescription(post: BlogPostSeoInput): string {
  return post.meta_description_ka?.trim() || blogExcerpt(post.body_md);
}

/** published_at, else created_at — the date the page shows. */
export const blogPostDate = (post: Pick<BlogPostSeoInput, "published_at" | "created_at">) =>
  post.published_at ?? post.created_at ?? null;

/** BlogPosting + BreadcrumbList (მთავარი → ბლოგი → post). */
export function blogPostSchemas(post: BlogPostSeoInput, coverUrl: string | null): object[] {
  const canonical = blogPostUrl(post.slug);
  const org = {
    "@type": "Organization",
    name: BLOG_BRAND,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: BLOG_LOGO_URL },
  };
  const datePublished = blogPostDate(post);
  const blogPosting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title_ka,
    description: blogPostDescription(post),
    url: canonical,
    ...(coverUrl ? { image: coverUrl } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(post.updated_at || datePublished ? { dateModified: post.updated_at ?? datePublished } : {}),
    inLanguage: "ka",
    author: org,
    publisher: org,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };
  const breadcrumb = buildBreadcrumbList([
    { name: "მთავარი", url: SITE_URL },
    { name: "ბლოგი", url: `${SITE_URL}/blog` },
    { name: post.title_ka },
  ]);
  return [blogPosting, breadcrumb];
}

/** Newest first: published_at desc, then created_at desc (BlogPage's order). */
export function sortPostsNewestFirst<T extends Pick<BlogPostSeoInput, "published_at" | "created_at">>(posts: T[]): T[] {
  const desc = (a?: string | null, b?: string | null) => String(b ?? "").localeCompare(String(a ?? ""));
  return [...posts].sort((a, b) => desc(a.published_at, b.published_at) || desc(a.created_at, b.created_at));
}

/** "სხვა სტატიები": up to BLOG_OTHER_POSTS_MAX other posts, newest first. */
export function otherBlogPosts<T extends Pick<BlogPostSeoInput, "slug" | "published_at" | "created_at">>(
  posts: T[],
  currentSlug: string,
  max = BLOG_OTHER_POSTS_MAX,
): T[] {
  return sortPostsNewestFirst(posts.filter((p) => p.slug !== currentSlug)).slice(0, max);
}

/** A same-site path ("/dtf-bechdva"), not a protocol-relative "//host". */
export function isInternalHref(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}
