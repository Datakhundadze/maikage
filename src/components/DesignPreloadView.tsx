import { Link } from "react-router-dom";
import { ImageOff } from "lucide-react";
import SeoHead from "@/components/SeoHead";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import type { DesignPreload } from "@/lib/pagePreload";

// /design/:slug while the live page is still loading its design + product:
// the prerender's data for this design (lib/pagePreload.ts) instead of a bare
// spinner, so the first render — and Googlebot's snapshot — carries the
// design's own title, description, name, image and text. Read-only: no
// colours, sizes, price or order controls; DesignDetailPage replaces it as
// soon as its data arrives.
//
// `onRetry`: the load failed (twice) — the design may well exist, so this
// stays indexable and offers a retry instead of the generic error state.

interface Props {
  preload: DesignPreload;
  url: string;
  onRetry?: () => void;
}

export default function DesignPreloadView({ preload, url, onRetry }: Props) {
  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title={preload.title}
        description={preload.description}
        image={preload.image ?? undefined}
        url={url}
        type="product"
      />
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
          <nav className="text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">მთავარი</Link>
            {" › "}
            <Link to="/designs" className="hover:text-foreground">კატალოგი</Link>
            {preload.categoryLabel ? ` › ${preload.categoryLabel}` : ""}
          </nav>
          <h1 className="text-2xl font-bold mb-4">{preload.name}</h1>
          {preload.image ? (
            <img
              src={transformedDisplayUrl(preload.image, { width: 800 })}
              alt={preload.name}
              width={800}
              height={800}
              className="w-full max-w-md aspect-square object-contain rounded-xl border border-border bg-muted/30"
            />
          ) : (
            <div className="w-full max-w-md aspect-square rounded-xl border border-border flex items-center justify-center">
              <ImageOff className="h-10 w-10 text-muted-foreground/40" />
            </div>
          )}
          {preload.body ? <p className="mt-4 text-[15px] leading-relaxed text-foreground">{preload.body}</p> : null}
          {onRetry ? (
            <div className="mt-6 flex items-center gap-3">
              <p className="text-sm text-muted-foreground">დიზაინის ჩატვირთვა ვერ მოხერხდა</p>
              <Button variant="outline" onClick={onRetry}>ხელახლა ცდა</Button>
            </div>
          ) : (
            <div className="mt-6 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="იტვირთება" />
          )}
        </main>
      </div>
    </div>
  );
}
