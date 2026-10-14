import { Link } from "react-router-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductType } from "@/lib/catalog";
import { fromPrice } from "@/lib/landingPrice";
import { LEAD_TIME_KA } from "@/lib/leadTime";
import { useLandingPhotos } from "@/hooks/useLandingPhotos";

// Above-the-fold hero for the product landing routes (/hoodie,
// /hoodie/premium-washed, …): what an ad visitor needs on the first mobile
// screen — what this is, what it costs, how long it takes, real examples, and
// one thing to do. Rendered by SimplePage at the top of the sidebar only when
// ProductLandingPage passes it; "/" never does.
//
// Compact on purpose (≈180px with photos at 390px wide): the thumbnails share
// the price row, so the top of the product preview below still lands on the
// first screen.

interface LandingHeroProps {
  product: ProductType;
  /** The brand from the URL, or null for /<product> (default brand). */
  brand: string | null;
  /** H1 name — the brand alone, or the product label (heroTitle). */
  title: string;
  /** Opens the constructor's own photo picker (SimplePage's file input). */
  onUploadClick: () => void;
}

export default function LandingHero({ product, brand, title, onUploadClick }: LandingHeroProps) {
  const photos = useLandingPhotos(product);
  const price = fromPrice(product, brand);

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="rounded-2xl border-2 border-[#26BB89]/40 bg-[#26BB89]/[0.06] p-3 space-y-2"
    >
      <h1 id="landing-hero-title" className="text-[15px] font-bold leading-snug text-card-foreground">
        {title} — შენი დიზაინით
      </h1>

      {/* Price left, thumbnails right on one row. The strip shows three 48px
          thumbs (156px) and scrolls sideways for the fourth, which leaves the
          price column room for the lead-time line on one line. */}
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 leading-tight">
          <span className="block text-base font-bold text-primary">{price} ₾-დან</span>
          <span className="block text-xs text-muted-foreground">მზადდება {LEAD_TIME_KA}</span>
        </p>
        {photos.length > 0 && (
          <ul className="flex gap-1.5 overflow-x-auto max-w-[156px] shrink-0" aria-label="ჩვენი ნამუშევრები">
            {photos.map((p) => (
              <li key={p.url} className="shrink-0">
                <img
                  src={p.url}
                  srcSet={p.srcSet}
                  sizes="48px"
                  alt={p.alt}
                  width={48}
                  height={48}
                  loading="lazy"
                  decoding="async"
                  className="h-12 w-12 rounded-lg object-cover border border-border bg-muted"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        type="button"
        onClick={onUploadClick}
        className="w-full h-10 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base"
      >
        <Upload className="h-4 w-4" />
        ატვირთე ფოტო
      </Button>

      {/* The floating chat widget has no open API or event, so this goes to
          the full-page chat instead. */}
      <Link
        to="/chat"
        className="block text-center text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        იდეა არ გაქვს? მოგვწერე
      </Link>
    </section>
  );
}
