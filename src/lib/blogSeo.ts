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
  title: "ბლოგი — მაისურებზე ბეჭდვის რჩევები და იდეები | maika.ge",
  description: "რჩევები მაისურებზე და ჰუდებზე ბეჭდვაზე: ფაილის მომზადება, ზომები, DTF თუ ქარგვა, საჩუქრის იდეები, გუნდის და კომპანიის ფორმა. Maika.ge ბლოგი.",
} as const;

/** /blog heading, intro and the two sections (BlogPage + the /blog prerender). */
export const BLOG_INDEX_H1 = "maika.ge ბლოგი";
export const BLOG_INDEX_INTRO =
  "რჩევები ტანსაცმელზე ბეჭდვაზე, დიზაინსა და შეკვეთაზე — და ჩვენი პარტნიორობები, კოლაბორაციები და ივენთები.";
export const BLOG_ARTICLES_HEADING = "სტატიები და რჩევები";
export const BLOG_PARTNERS_HEADING = "პარტნიორობები და კოლაბორაციები";
/** Posts whose slug starts with this are partnership / collab posts. */
export const BLOG_PARTNER_SLUG_PREFIX = "maikage-x-";
/** Card cover box (16:10) — the width / height attributes of a /blog card image. */
export const BLOG_CARD_COVER = { width: 800, height: 500 } as const;

export const isPartnershipPost = (slug: string | null | undefined) =>
  String(slug ?? "").startsWith(BLOG_PARTNER_SLUG_PREFIX);

export interface BlogIndexSection<T> {
  key: "articles" | "partners";
  heading: string;
  posts: T[];
}

/**
 * /blog sections: "სტატიები და რჩევები" (every slug NOT starting with
 * "maikage-x-") first, then "პარტნიორობები და კოლაბორაციები". Each newest
 * first; an empty section is left out.
 */
export function blogIndexSections<T extends Pick<BlogPostSeoInput, "slug" | "published_at" | "created_at">>(
  posts: T[],
): BlogIndexSection<T>[] {
  const sorted = sortPostsNewestFirst(posts);
  const sections: BlogIndexSection<T>[] = [
    { key: "articles", heading: BLOG_ARTICLES_HEADING, posts: sorted.filter((p) => !isPartnershipPost(p.slug)) },
    { key: "partners", heading: BLOG_PARTNERS_HEADING, posts: sorted.filter((p) => isPartnershipPost(p.slug)) },
  ];
  return sections.filter((s) => s.posts.length > 0);
}

/** A cover: what an <img src> uses (`src`) and the absolute URL for og:image / JSON-LD (`absolute`). */
export interface BlogCover {
  src: string;
  absolute: string;
  /** Where it lives: the site's own public/ folder, an https URL, or the "blog" storage bucket. */
  kind: "site" | "url" | "storage";
}

/**
 * blog_posts.cover_path → the cover's URLs. Three forms:
 *   "/blog/storefront.webp"      a file under public/ (site-relative)
 *   "https://…/x.jpg"            an absolute https URL, used as is
 *   "covers/x.jpg"               a key in the public storage bucket "blog"
 * `storageUrl(key)` builds the bucket URL (supabase getPublicUrl on the live
 * page, the same URL by hand in the prerender). Anything else — empty, a
 * protocol-relative "//host", http: or another scheme — is no cover.
 */
export function blogCover(
  coverPath: string | null | undefined,
  storageUrl: (key: string) => string,
): BlogCover | null {
  const raw = String(coverPath ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("/")) {
    if (!isInternalHref(raw) || /\s/.test(raw)) return null;
    return { src: raw, absolute: `${SITE_URL}${raw}`, kind: "site" };
  }
  if (/^https:\/\/[^/\s]+/i.test(raw)) return { src: raw, absolute: raw, kind: "url" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const url = storageUrl(raw);
  return url ? { src: url, absolute: url, kind: "storage" } : null;
}

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
