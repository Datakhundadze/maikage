import { Link } from "react-router-dom";
import type { LandingCopy } from "@/lib/landingCopy";

// The text section under the constructor on a bare product landing route
// (/t-shirt). Purely presentational: the copy is lib/landingCopy.ts, the price
// is handed in by ProductLandingPage (lib/landingPrice.ts, the same "from"
// price the hero shows). With no price the ფასი section simply starts at its
// second sentence — never a placeholder.
//
// Rendered at the end of the constructor's own scroll column (SimplePage
// `afterContent`), so it flows after the order buttons and never sits over
// any of the constructor's controls.

interface LandingCopySectionProps {
  copy: LandingCopy;
  /** Whole lari, or null while unknown. */
  price: number | null;
}

export default function LandingCopySection({ copy, price }: LandingCopySectionProps) {
  // Same format as LandingHero's "{price} ₾-დან".
  const priceText = price != null && Number.isFinite(price) && price > 0 ? `${price} ₾` : null;

  return (
    <section
      aria-labelledby="landing-copy-title"
      className="max-w-prose border-t border-sidebar-border pt-6 space-y-4 text-sm leading-relaxed text-muted-foreground"
    >
      <h2 id="landing-copy-title" className="text-base font-bold leading-snug text-sidebar-foreground">
        {copy.h2}
      </h2>
      <p>{copy.intro}</p>
      {copy.sections.map((s) => (
        <div key={s.h3} className="space-y-1">
          <h3 className="text-sm font-semibold text-sidebar-foreground">{s.h3}</h3>
          <p>{s.priceLead && priceText ? `${s.priceLead(priceText)} ${s.body}` : s.body}</p>
          {s.link && (
            <p>
              <Link
                to={s.link.href}
                className="font-medium text-sidebar-foreground underline underline-offset-2 hover:text-primary"
              >
                {s.link.label}
              </Link>
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
