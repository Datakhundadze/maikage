import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import {
  BLOG_CARD_COVER,
  BLOG_INDEX_H1,
  BLOG_INDEX_INTRO,
  BLOG_INDEX_SEO,
  blogCover,
  blogIndexSections,
  blogPostPath,
} from "@/lib/blogSeo";
import { format } from "date-fns";
import { Newspaper } from "lucide-react";

// Public blog listing — published posts in two sections (lib/blogSeo.ts
// blogIndexSections): "სტატიები და რჩევები" first, then
// "პარტნიორობები და კოლაბორაციები" (slug "maikage-x-…"), each newest first.
// The prerender writes the same structure (scripts/lib/seo.mjs blogIndexHtml).
// RLS already scopes the anon SELECT to published = true; the .eq is
// belt-and-braces.

interface PostCard {
  slug: string;
  title_ka: string;
  cover_path: string | null;
  meta_description_ka: string | null;
  published_at: string | null;
  created_at: string;
}

const storageUrl = (key: string) => supabase.storage.from("blog").getPublicUrl(key).data.publicUrl;

/** Card image src: a storage cover downscaled, a site / https cover as it is. */
function cardCoverSrc(coverPath: string | null): string | null {
  const c = blogCover(coverPath, storageUrl);
  if (!c) return null;
  return c.kind === "storage" ? transformedDisplayUrl(c.src, { width: 800 }) : c.src;
}

function PostCardView({ post }: { post: PostCard }) {
  const src = cardCoverSrc(post.cover_path);
  const href = blogPostPath(post.slug);
  return (
    <article className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/60 hover:shadow-sm transition-all">
      <Link to={href} tabIndex={-1} aria-hidden="true" className="block aspect-[16/10] bg-muted/30 overflow-hidden">
        {src ? (
          <img
            src={src}
            alt={post.title_ka}
            width={BLOG_CARD_COVER.width}
            height={BLOG_CARD_COVER.height}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Newspaper className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
      </Link>
      <div className="p-4 space-y-1.5">
        <h3 className="text-base font-semibold text-foreground line-clamp-2">
          <Link to={href} className="hover:text-primary transition-colors">
            {post.title_ka}
          </Link>
        </h3>
        {post.meta_description_ka && (
          <p className="text-sm text-muted-foreground line-clamp-2">{post.meta_description_ka}</p>
        )}
        <p className="text-xs text-muted-foreground">
          <time dateTime={String(post.published_at ?? post.created_at).slice(0, 10)}>
            {format(new Date(post.published_at ?? post.created_at), "dd.MM.yyyy")}
          </time>
        </p>
      </div>
    </article>
  );
}

export default function BlogPage() {
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // blog_posts is schema-ahead-of-types — cast mirrors the gallery pages.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("blog_posts")
        .select("slug, title_ka, cover_path, meta_description_ka, published_at, created_at")
        .eq("published", true)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setPosts((data as PostCard[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const sections = blogIndexSections(posts);

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title={BLOG_INDEX_SEO.title}
        description={BLOG_INDEX_SEO.description}
        url={`${SITE_URL}/blog`}
      />
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 space-y-8">
          <header>
            <h1 className="text-2xl font-bold text-foreground">{BLOG_INDEX_H1}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{BLOG_INDEX_INTRO}</p>
          </header>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[16/10] rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : sections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Newspaper className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">სტატიები მალე დაემატება</p>
            </div>
          ) : (
            sections.map((s) => (
              <section key={s.key} aria-labelledby={`blog-${s.key}`} className="space-y-4">
                <h2 id={`blog-${s.key}`} className="text-lg font-bold text-foreground">
                  {s.heading}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {s.posts.map((p) => (
                    <PostCardView key={p.slug} post={p} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
