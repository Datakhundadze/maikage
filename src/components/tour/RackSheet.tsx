import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Search, X } from "lucide-react";
import MagnifierLens from "@/components/MagnifierLens";
import RackPhotoDesigner from "@/components/tour/RackPhotoDesigner";
import { writeConstructorSeed } from "@/lib/constructorSeed";
import { fromPrice } from "@/lib/landingPrice";
import { RACK_CARD_WIDE_PX, rackItemName, rackLandingPath, rackPhoto } from "@/lib/tour/rackItem";
import type { RackItem, ShowroomRack } from "@/lib/tour/showroomRacks";

// The card a rack opens in /showroom once the walk has stopped and turned to
// it: beside the rack, never over it — on wide screens a panel on the right
// (the walk turns so the rack sits in the free left part), on phones a card
// above the "საკიდები" button. Not modal: the visitor can keep looking
// around, or pick the next rack straight away.
//
// The photo is David's own close-up of that rack (rackPhoto). The site's
// loupe (MagnifierLens) works on it: on a computer by moving the mouse over
// it; a tap opens it large, where pressing and holding shows the lens
// (phones: the card photo is too small for a 150 px lens).
//
// "არჩევა" → the constructor with that product and brand picked (the same
// seed handoff the product landing pages use); the yellow rack opens the
// whole design catalog instead.
//
// PRICES: fromPrice → calculatePrice, the constructor's own price for that
// product + brand with nothing added yet — the same "from" price the landing
// pages show, so the showroom can never disagree with the constructor.

interface RackSheetProps {
  rack: ShowroomRack;
  onClose: () => void;
}

const media = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;

export default function RackSheet({ rack, onClose }: RackSheetProps) {
  const navigate = useNavigate();
  const photo = rackPhoto(rack);
  const [big, setBig] = useState(false);
  // large view: first the product alone, "დაწყება" brings the tools (David 2026-11-10)
  const [designing, setDesigning] = useState(false);
  const closeBig = () => {
    setBig(false);
    setDesigning(false);
  };
  const [hover] = useState(() => media("(hover: hover) and (pointer: fine)"));
  const item = useMemo(() => {
    if (rack.items === "catalog") return null;
    const it = rack.items[0];
    return { ...it, name: rackItemName(it), price: fromPrice(it.product, it.brand) };
  }, [rack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (big) {
        setBig(false);
        setDesigning(false);
      }
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, big]);

  // the constructor and the catalog open in a new tab, so the showroom stays
  // where it is (the seed is in localStorage, made for exactly this handoff);
  // where a new tab is blocked, the same tab (the walk resumes on return)
  const openPage = (path: string) => {
    // (no "noopener" feature: with it window.open returns null even on success)
    const w = window.open(path, "_blank");
    if (w) w.opener = null;
    else navigate(path);
  };
  const choose = (it: RackItem) => {
    // the seed is the fallback for a product without a landing route (then "/")
    writeConstructorSeed({ product: it.product, subProduct: it.brand });
    openPage(rackLandingPath(rack.id, it));
  };

  const cta =
    "inline-flex items-center justify-center gap-1.5 rounded-full bg-amber-400 font-semibold text-black transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  const label = item ? rack.title : "ყვითელი საკიდი";
  const heading = item ? item.name : rack.title;
  // design on the photo (look only): the rack whose photo has a garment mask
  const designable = rack.id === "oversize";

  return (
    <>
      <aside
        role="dialog"
        aria-label={rack.title}
        style={{ ["--card-w" as string]: `${RACK_CARD_WIDE_PX}px` }}
        className="maika-rack-card absolute inset-x-3 bottom-[5.25rem] z-30 text-white md:inset-x-auto md:bottom-auto md:right-5 md:top-1/2 md:w-[var(--card-w)] md:-translate-y-1/2"
      >
        <style>{`
          @keyframes maika-card-up { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
          @keyframes maika-card-in { from { opacity: 0; transform: translate(32px, -50%) } to { opacity: 1; transform: translate(0, -50%) } }
          @keyframes maika-photo-in { from { opacity: 0; transform: scale(1.06) } to { opacity: 1; transform: none } }
          .maika-rack-card { animation: maika-card-up 320ms cubic-bezier(.2,.8,.2,1) both }
          @media (min-width: 768px) { .maika-rack-card { animation-name: maika-card-in } }
          .maika-photo-in { animation: maika-photo-in 600ms cubic-bezier(.2,.8,.2,1) 120ms both }
          @media (prefers-reduced-motion: reduce) { .maika-rack-card, .maika-photo-in { animation: none !important } }
        `}</style>
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111]/90 shadow-[0_18px_50px_-12px_rgba(0,0,0,.85)] backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            aria-label="დახურვა"
            className="absolute right-2 top-2 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>

          <div className="flex items-stretch md:block">
            {/* the photo: hover = loupe (computer); tap = large view */}
            <div className="relative w-[32%] shrink-0 md:w-full">
              <div className="maika-photo-in aspect-[4/5] w-full overflow-hidden bg-zinc-900">
                <MagnifierLens active={hover} zoomSrc={photo}>
                  <button
                    type="button"
                    onClick={() => setBig(true)}
                    aria-label="ფოტოს გადიდება"
                    className="block h-full w-full focus-visible:outline-none"
                    style={hover ? { cursor: "none" } : undefined}
                  >
                    <img src={photo} alt={heading} decoding="async" draggable={false} className="h-full w-full select-none object-cover" />
                  </button>
                </MagnifierLens>
              </div>
              <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
                <Search className="h-3 w-3" aria-hidden />
                {hover ? "გადიდება — მიიტანე მაუსი" : "გადიდება"}
              </span>
              {/* fade into the text below (wide) */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-16 bg-gradient-to-t from-[#111] to-transparent md:block" aria-hidden />
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between p-3 pr-11 md:-mt-6 md:p-5 md:pr-5">
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-400">{label}</p>
                <h2 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-tight md:text-xl">{heading}</h2>
                {item ? (
                  <p className="mt-1 text-sm text-white/70">
                    <span className="text-lg font-semibold text-white">{item.price} ₾</span>-დან
                  </p>
                ) : (
                  <p className="mt-1 text-sm leading-snug text-white/70">აქ ყველა დიზაინი კიდია, რაც გვაქვს.</p>
                )}
              </div>
              {item ? (
                <button type="button" onClick={() => choose(item)} className={`${cta} mt-2 self-start whitespace-nowrap px-4 py-2 text-sm md:mt-4 md:w-full md:py-2.5`}>
                  არჩევა<span className="hidden md:inline"> და დიზაინი</span> <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              ) : (
                <button type="button" onClick={() => openPage("/designs")} className={`${cta} mt-2 self-start whitespace-nowrap px-4 py-2 text-sm md:mt-4 md:w-full md:py-2.5`}>
                  კატალოგის ნახვა <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {big &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={heading}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 p-4"
            onClick={closeBig}
          >
            <button
              type="button"
              onClick={closeBig}
              aria-label="დახურვა"
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            {designable && designing ? (
              // the one rack with a garment mask: the upload frame right on the photo
              <RackPhotoDesigner alt={heading} />
            ) : (
              <>
              <div
                className="aspect-[4/5] overflow-hidden rounded-2xl shadow-2xl"
                style={{ width: `min(92vw, calc((100dvh - ${designable ? 11 : 7}rem) * 0.8))` }}
                onClick={(e) => e.stopPropagation()}
              >
                <MagnifierLens active zoomSrc={photo}>
                  <img src={photo} alt={heading} draggable={false} className="h-full w-full select-none object-cover" />
                </MagnifierLens>
              </div>
              <p className="mt-3 text-center text-xs text-white/70">
                {hover ? "მიიტანე მაუსი — გადიდება" : "დააჭირე და გეჭიროს — გადიდება"}
              </p>
                {designable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDesigning(true);
                    }}
                    className={`${cta} mt-3 h-12 px-8 text-base font-bold`}
                  >
                    დაწყება <ArrowRight className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
