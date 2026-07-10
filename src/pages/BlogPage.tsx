import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import { format } from "date-fns";
import { Newspaper } from "lucide-react";

// Public blog listing — published posts, newest first (RLS already scopes the
// anon SELECT to published = true; the .eq is belt-and-braces).

interface PostCard {
  slug: string;
  title_ka: string;
  cover_path: string | null;
  meta_description_ka: string | null;
  published_at: string | null;
  created_at: string;
}

const coverUrl = (path: string) =>
  transformedDisplayUrl(supabase.storage.from("blog").getPublicUrl(path).data.publicUrl, { width: 800 });

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

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title="ბლოგი — Maika.ge სიახლეები და ივენთები"
        description="Maika.ge-ის სიახლეები: პარტნიორული ივენთები, ბანაკები, კოლაბორაციები და ბექსთეიჯი."
        url={`${SITE_URL}/blog`}
      />
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-foreground">ბლოგი</h1>
            <p className="text-sm text-muted-foreground mt-1">სიახლეები, ივენთები და კოლაბორაციები</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[16/10] rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Newspaper className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">სტატიები მალე დაემატება</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {posts.map((p) => (
                <Link
                  key={p.slug}
                  to={`/blog/${p.slug}`}
                  className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/60 hover:shadow-sm transition-all"
                >
                  <div className="aspect-[16/10] bg-muted/30 overflow-hidden">
                    {p.cover_path ? (
                      <img
                        src={coverUrl(p.cover_path)}
                        alt={p.title_ka}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Newspaper className="h-8 w-8 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-1.5">
                    <h2 className="text-base font-semibold text-foreground line-clamp-2">{p.title_ka}</h2>
                    {p.meta_description_ka && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{p.meta_description_ka}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(p.published_at ?? p.created_at), "dd.MM.yyyy")}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
