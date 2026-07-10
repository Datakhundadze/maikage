import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import MarkdownView from "@/components/MarkdownView";
import { buildBreadcrumbList } from "@/lib/seoSchemas";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import { format } from "date-fns";
import { ArrowLeft, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";

// Public article page (/blog/:slug). SEO: per-post meta description (authored,
// with a body-derived fallback), og:image from the cover, canonical URL,
// BlogPosting + BreadcrumbList JSON-LD. Body is markdown rendered by the
// shared MarkdownView (raw HTML disabled — no XSS surface).

interface Post {
  slug: string;
  title_ka: string;
  body_md: string;
  cover_path: string | null;
  meta_description_ka: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// Rough markdown → plain-text excerpt for the meta-description fallback.
function excerpt(md: string, max = 155): string {
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~-]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      // blog_posts is schema-ahead-of-types — cast mirrors the gallery pages.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("blog_posts")
        .select("slug, title_ka, body_md, cover_path, meta_description_ka, published_at, created_at, updated_at")
        .eq("slug", slug)
        .eq("published", true)
        .limit(1);
      if (cancelled) return;
      const row: Post | undefined = (data as Post[] | null)?.[0];
      if (!row) setNotFound(true);
      else setPost(row);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="flex flex-col h-screen">
        <AppHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <Newspaper className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">სტატია ვერ მოიძებნა</p>
          <Button variant="outline" onClick={() => navigate("/blog")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> ბლოგზე დაბრუნება
          </Button>
        </div>
      </div>
    );
  }

  const canonical = `${SITE_URL}/blog/${post.slug}`;
  const coverOriginal = post.cover_path
    ? supabase.storage.from("blog").getPublicUrl(post.cover_path).data.publicUrl
    : null;
  const description = post.meta_description_ka || excerpt(post.body_md);
  const dateISO = post.published_at ?? post.created_at;

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title_ka,
    description,
    url: canonical,
    ...(coverOriginal ? { image: coverOriginal } : {}),
    datePublished: dateISO,
    dateModified: post.updated_at,
    inLanguage: "ka",
    author: { "@type": "Organization", name: "Maika.ge", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Maika.ge", url: SITE_URL },
    mainEntityOfPage: canonical,
  };

  const breadcrumbJsonLd = buildBreadcrumbList([
    { name: "მთავარი", url: SITE_URL },
    { name: "ბლოგი", url: `${SITE_URL}/blog` },
    { name: post.title_ka },
  ]);

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title={`${post.title_ka} — Maika.ge ბლოგი`}
        description={description}
        image={coverOriginal ?? undefined}
        url={canonical}
        type="article"
        schemas={[blogPostingJsonLd, breadcrumbJsonLd]}
      />
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
          <button
            onClick={() => navigate("/blog")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> ბლოგი
          </button>

          <h1 className="text-3xl font-bold text-foreground">{post.title_ka}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {format(new Date(dateISO), "dd.MM.yyyy")}
          </p>

          {coverOriginal && (
            <img
              src={transformedDisplayUrl(coverOriginal, { width: 800 })}
              alt={post.title_ka}
              className="mt-5 w-full rounded-2xl border border-border"
            />
          )}

          <div className="mt-6">
            <MarkdownView markdown={post.body_md} />
          </div>
        </article>
      </div>
    </div>
  );
}
