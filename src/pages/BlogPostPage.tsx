import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import MarkdownView from "@/components/MarkdownView";
import PrintServicesLinks from "@/components/PrintServicesLinks";
import {
  BLOG_OTHER_POSTS_HEADING,
  BLOG_OTHER_POSTS_MAX,
  blogPostDate,
  blogPostDescription,
  blogPostPath,
  blogPostSchemas,
  blogPostTitle,
  otherBlogPosts,
} from "@/lib/blogSeo";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import { format } from "date-fns";
import { ArrowLeft, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";

// Public article page (/blog/:slug). SEO: per-post meta description (authored,
// with a body-derived fallback), og:image from the cover, canonical URL,
// BlogPosting + BreadcrumbList JSON-LD (lib/blogSeo.ts — the prerender uses
// the same builders). Body is markdown rendered by the shared MarkdownView
// (raw HTML disabled — no XSS surface). After the body: the
// "ბეჭდვის სერვისები" links and "სხვა სტატიები" (up to 3 other posts).

// One automatic retry for a failed post query before the error state shows.
const POST_RETRY_DELAY_MS = 1500;

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

interface OtherPost {
  slug: string;
  title_ka: string;
  published_at: string | null;
  created_at: string;
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // A failed query is not a missing post — kept separate so a transient
  // failure never renders the noindex not-found state. Mirrors DesignDetailPage.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [others, setOthers] = useState<OtherPost[]>([]);

  // "სხვა სტატიები" — best effort: a failed query just leaves the list out.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("blog_posts")
        .select("slug, title_ka, published_at, created_at")
        .eq("published", true)
        .neq("slug", slug)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(BLOG_OTHER_POSTS_MAX);
      if (cancelled) return;
      setOthers(otherBlogPosts((data as OtherPost[] | null) ?? [], slug));
    })();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    const fetchPost = async (attempt: number) => {
      // blog_posts is schema-ahead-of-types — cast mirrors the gallery pages.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("slug, title_ka, body_md, cover_path, meta_description_ka, published_at, created_at, updated_at")
        .eq("slug", slug)
        .eq("published", true)
        .limit(1);
      if (cancelled) return;
      // Only a successful query with zero rows means "not found". On error,
      // retry once, then show the (indexable) error state.
      if (error) {
        if (attempt === 0) {
          retryTimer = setTimeout(() => { void fetchPost(1); }, POST_RETRY_DELAY_MS);
          return;
        }
        setLoadError(true);
        setLoading(false);
        return;
      }
      const row: Post | undefined = (data as Post[] | null)?.[0];
      if (!row) setNotFound(true);
      else setPost(row);
      setLoading(false);
    };
    void fetchPost(0);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [slug, reloadKey]);

  // Self-canonical to the requested URL for every early exit below.
  const requestedUrl = `${SITE_URL}/blog/${slug}`;

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <SeoHead url={requestedUrl} />
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  // Load error: the post may exist — only the query failed. Indexable, never
  // noindex; checked before `!post` because a previous slug's post can still
  // be in state.
  if (loadError) {
    return (
      <div className="flex flex-col h-screen">
        <SeoHead url={requestedUrl} />
        <AppHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <Newspaper className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">სტატიის ჩატვირთვა ვერ მოხერხდა</p>
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            ხელახლა ცდა
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="flex flex-col h-screen">
        {/* A slug with no published post is a soft 404 — keep it out of the
            index, consistent with DesignDetailPage. */}
        <SeoHead url={requestedUrl} noindex />
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
  const description = blogPostDescription(post);
  const dateISO = blogPostDate(post) ?? post.created_at;
  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title={blogPostTitle(post.title_ka)}
        description={description}
        image={coverOriginal ?? undefined}
        url={canonical}
        type="article"
        schemas={blogPostSchemas(post, coverOriginal)}
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

          <PrintServicesLinks excludeHref={blogPostPath(post.slug)} />

          {others.length > 0 && (
            <nav aria-label={BLOG_OTHER_POSTS_HEADING} className="mt-8 border-t border-border pt-6 text-sm">
              <h2 className="text-lg font-bold text-foreground mb-2">{BLOG_OTHER_POSTS_HEADING}</h2>
              <ul className="space-y-1">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link
                      to={blogPostPath(o.slug)}
                      className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                    >
                      {o.title_ka}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </article>
      </div>
    </div>
  );
}
