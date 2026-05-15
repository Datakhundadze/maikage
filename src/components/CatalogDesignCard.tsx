import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { compositeDesignOnProduct } from "@/lib/catalogCompositing";

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

  useEffect(() => {
    if (mockup || failed) return;
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
  }, [cacheKey, printFileUrl, productType, subProduct, color, mockup, failed]);

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
      fetchPriority={priority ? "high" : "auto"}
    />
  );
}
