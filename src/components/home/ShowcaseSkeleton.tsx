import type { HomeShowcaseCopy } from "@/lib/homeShowcaseCopy";

// Shared by the home showcase slot (main LandingPage chunk, shown before the
// lazy chunk arrives) and HomeCatalogShowcase (while its data loads), so the
// section keeps the same box from the first paint to the real rail: no
// layout shift. Panel heights match .hs-panel in homeShowcase.css.

export const SHOWCASE_PANEL_CLASS = "h-[290px] sm:h-[362px]";

export function ShowcaseHeading({ copy, isGreen }: { copy: HomeShowcaseCopy; isGreen: boolean }) {
  return (
    <div className="mb-5 text-center">
      <h2 id="home-catalog-title" className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: isGreen ? "white" : undefined }}>
        {copy.catalogTitle}
      </h2>
      <p className="text-sm sm:text-base" style={{ color: isGreen ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.6)" }}>
        {copy.catalogSubtitle}
      </p>
    </div>
  );
}

export default function ShowcaseSkeleton({ copy, isGreen }: { copy: HomeShowcaseCopy; isGreen: boolean }) {
  return (
    <section aria-labelledby="home-catalog-title" aria-busy="true" className="w-full max-w-5xl mx-auto mb-16 sm:mb-20">
      <ShowcaseHeading copy={copy} isGreen={isGreen} />
      <div className={`${SHOWCASE_PANEL_CLASS} overflow-hidden rounded-3xl bg-[#c7c1ba]/90 px-5 pt-[50px]`}>
        <div className="flex gap-3 sm:gap-[18px]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="shrink-0 animate-pulse rounded-2xl bg-white/35 h-[190px] w-[129px] sm:h-[260px] sm:w-[177px]" />
          ))}
        </div>
      </div>
    </section>
  );
}
