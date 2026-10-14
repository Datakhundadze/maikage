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
// Compact on purpose (≈250px with photos at 390px wide) so the constructor
// below still starts on the first screen.

interface LandingHeroProps {
  product: ProductType;
  /** The brand from the URL, or null for /<product> (default brand). */
  brand: string | null;
  /** Display name — the same string the page's SEO title uses. */
  name: string;
  /** Opens the constructor's own photo picker (SimplePage's file input). */
  onUploadClick: () => void;
}

export default function LandingHero({ product, brand, name, onUploadClick }: LandingHeroProps) {
  const photos = useLandingPhotos(product);
  const price = fromPrice(product, brand);

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="rounded-2xl border-2 border-[#26BB89]/40 bg-[#26BB89]/[0.06] p-3 space-y-2.5"
    >
      <div className="space-y-1">
        <h1 id="landing-hero-title" className="text-base font-bold leading-snug text-card-foreground">
          {name} — შენი დიზაინით
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-primary">{price} ₾-დან</span>
          {" · "}მზადდება {LEAD_TIME_KA}
        </p>
      </div>

      {photos.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-0.5" aria-label="ჩვენი ნამუშევრები">
          {photos.map((p) => (
            <li key={p.url} className="shrink-0">
              <img
                src={p.url}
                srcSet={p.srcSet}
                sizes="64px"
                alt={p.alt}
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
                className="h-16 w-16 rounded-xl object-cover border border-border bg-muted"
              />
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        onClick={onUploadClick}
        className="w-full h-11 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base"
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
