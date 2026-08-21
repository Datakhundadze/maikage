import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { compositeDesignOnProduct } from "@/lib/catalogCompositing";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  printFileUrl: string;
  fallbackUrl?: string | null;
  alt: string;
  productType?: string;
  subProduct?: string;
  color?: string;
  /** Mark this card as the LCP candidate — the first card in the
   *  catalog grid should set this so the browser fetches it eagerly. */
  priority?: boolean;
}

// Small in-memory cache so re-rendering the catalog (filter switching)
// doesn't recompose the same mockup over and over.
const mockupCache = new Map<string, string>();

// How early a card starts compositing, in px of scroll ahead of the viewport.
//
// compositeDesignOnProduct is main-thread canvas work — loading the print file,
// tinting the garment, drawing, toDataURL. Every mounted card used to start it
// at once: on a 192-design category that was 192 composites racing on one
// thread, 3.4s of blocking time and 11s before the grid settled, with the FIRST
// card taking 5.6s because it was queued behind everything else.
//
// 600px is roughly one viewport of lead time at desktop sizes and about two
// card-rows on mobile, so a composite is normally finished before the card is
// scrolled into view and the customer never sees the skeleton during ordinary
// scrolling. Larger would start reclaiming the cost this exists to avoid.
const NEAR_VIEWPORT_MARGIN = "600px";

export default function CatalogDesignCard({
  printFileUrl,
  fallbackUrl,
  alt,
  productType = "T-Shirt",
  subProduct = "GILDAN",
  color = "White",
  priority = false,
}: Props) {
  const cacheKey = `${productType}|${subProduct}|${color}|${printFileUrl}`;
  const [mockup, setMockup] = useState<string | null>(() => mockupCache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);

  // Has this card come close enough to the viewport to be worth compositing?
  //
  // `priority` (the LCP card) never waits. Neither does a browser without
  // IntersectionObserver — there the old always-composite behaviour is the
  // correct fallback, since the alternative is a skeleton that never resolves.
  const [near, setNear] = useState(
    () => priority || typeof IntersectionObserver === "undefined",
  );
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (near) return;
    const node = slotRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [near]);

  // Recomposite whenever the cache key (color/product/design) changes.
  // Cached keys swap in instantly; uncached keys clear the previous
  // mockup first so the loading state shows instead of the stale color.
  // mockup/failed must NOT be deps — the effect writes them, and keying
  // the reset on cacheKey alone is what prevents a re-render loop.
  useEffect(() => {
    const cached = mockupCache.get(cacheKey);
    if (cached) {
      setMockup(cached);
      setFailed(false);
      return;
    }
    setMockup(null);
    setFailed(false);
    // Not near the viewport yet: stay on the skeleton and spend nothing. The
    // observer above flips `near` and re-runs this effect when the card
    // approaches. A cache hit above is exempt — that costs a Map lookup, so
    // there is no reason to make a filter switch redraw skeletons.
    if (!near) return;
    let cancelled = false;
    (async () => {
      const url = await compositeDesignOnProduct({
        printFileUrl,
        productName: productType,
        subProduct,
        color,
        view: "front",
      });
      if (cancelled) return;
      if (url) {
        mockupCache.set(cacheKey, url);
        setMockup(url);
      } else {
        setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [cacheKey, printFileUrl, productType, subProduct, color, near]);

  // While compositing is in flight, show a skeleton that fills the same
  // aspect-square slot so nothing shifts when the composite lands. We do NOT
  // fall back to fallbackUrl / printFileUrl here: that rendered the design
  // print PNG alone — without the t-shirt mockup behind it — which caused a
  // visible flash on slow connections (the design floating on the grid bg,
  // then the composited mockup swapping in once the canvas work finished).
  if (!mockup && !failed) {
    // Also the IntersectionObserver target — this is the element that exists
    // for exactly as long as the card has not composited yet.
    return <Skeleton ref={slotRef} className="w-full h-full" />;
  }
  const src = mockup ?? fallbackUrl ?? printFileUrl;
  if (!src) {
    return <ImageOff className="h-8 w-8 text-muted-foreground/40" />;
  }
  return (
    <img
      src={src}
      alt={alt}
      // width/height are the mockup's intrinsic aspect (square) so the
      // browser reserves a 1:1 box during load and avoids layout shift.
      // CSS w-full/h-full sets the rendered size; these attrs only
      // contribute the aspect-ratio hint.
      width={800}
      height={800}
      className="w-full h-full object-contain p-3 group-hover:scale-[1.02] transition-transform"
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
    />
  );
}
