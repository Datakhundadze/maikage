import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { writeConstructorSeed } from "@/lib/constructorSeed";
import { fromPrice } from "@/lib/landingPrice";
import { RACK_CARD_WIDE_PX, rackItemImage, rackItemName } from "@/lib/tour/rackItem";
import type { RackItem, ShowroomRack } from "@/lib/tour/showroomRacks";

// The card a rack opens in /showroom once the walk has stopped and turned to
// it: beside the rack, never over it — on wide screens a panel on the right
// (the walk turns so the rack sits in the free left part), on phones a slim
// card above the destination buttons (the rack stays in the upper part of
// the picture). Not modal: the visitor can keep looking around, or tap the
// next rack straight away. The garment swings in on its hanger.
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

export default function RackSheet({ rack, onClose }: RackSheetProps) {
  const navigate = useNavigate();
  const item = useMemo(() => {
    if (rack.items === "catalog") return null;
    const it = rack.items[0];
    return { ...it, name: rackItemName(it), price: fromPrice(it.product, it.brand), image: rackItemImage(it) };
  }, [rack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    writeConstructorSeed({ product: it.product, subProduct: it.brand });
    openPage("/");
  };

  const cta =
    "inline-flex items-center justify-center gap-1.5 rounded-full bg-amber-400 font-semibold text-black transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return (
    <aside
      role="dialog"
      aria-label={rack.title}
      style={{ ["--card-w" as string]: `${RACK_CARD_WIDE_PX}px` }}
      className="maika-rack-card absolute inset-x-3 bottom-[7.25rem] z-30 text-white md:inset-x-auto md:bottom-auto md:right-5 md:top-1/2 md:w-[var(--card-w)] md:-translate-y-1/2"
    >
      <style>{`
        @keyframes maika-card-up { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
        @keyframes maika-card-in { from { opacity: 0; transform: translate(32px, -50%) } to { opacity: 1; transform: translate(0, -50%) } }
        @keyframes maika-swing { 0% { transform: rotate(-12deg) } 45% { transform: rotate(6deg) } 75% { transform: rotate(-2.5deg) } 100% { transform: rotate(0) } }
        .maika-rack-card { animation: maika-card-up 320ms cubic-bezier(.2,.8,.2,1) both }
        @media (min-width: 768px) { .maika-rack-card { animation-name: maika-card-in } }
        .maika-swing { transform-origin: 50% 0; animation: maika-swing 1100ms cubic-bezier(.3,.7,.3,1) 180ms both }
        @media (prefers-reduced-motion: reduce) { .maika-rack-card, .maika-swing { animation: none !important } }
      `}</style>
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111]/85 shadow-[0_18px_50px_-12px_rgba(0,0,0,.8)] backdrop-blur-md">
        {/* thin amber line: the same accent as the destination buttons */}
        <div className="h-0.5 w-full bg-gradient-to-r from-amber-400 via-amber-300/60 to-transparent" aria-hidden />
        <button
          type="button"
          onClick={onClose}
          aria-label="დახურვა"
          className="absolute right-2 top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        {item === null ? (
          <div className="p-4 pr-12 md:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-400">ყვითელი საკიდი</p>
            <h2 className="mt-1 text-lg font-semibold leading-tight">{rack.title}</h2>
            <p className="mt-2 text-sm leading-snug text-white/75">აქ ყველა დიზაინი კიდია, რაც გვაქვს. აირჩიე და შეუკვეთე.</p>
            <button type="button" onClick={() => openPage("/designs")} className={`${cta} mt-4 w-full px-5 py-2.5 text-sm`}>
              კატალოგის ნახვა <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex items-stretch gap-3 p-3 md:block md:p-5">
            {/* the garment on its hanger */}
            <div className="w-24 shrink-0 md:mx-auto md:w-full md:max-w-[220px]">
              <div className="maika-swing">
                <svg viewBox="0 0 40 18" className="mx-auto -mb-1 h-3.5 w-8 text-zinc-400 md:h-5 md:w-10" aria-hidden>
                  <path d="M20 0 v5 M20 5 L3 16 h34 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
                <div className="overflow-hidden rounded-xl bg-gradient-to-b from-white to-zinc-100 ring-1 ring-black/5">
                  {item.image ? (
                    <img src={item.image} alt={item.name} decoding="async" className="aspect-square w-full object-contain p-1" />
                  ) : (
                    <div className="aspect-square w-full bg-zinc-200" />
                  )}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between pr-8 md:mt-4 md:pr-0">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-400">{rack.title}</p>
                <h2 className="mt-0.5 line-clamp-2 text-base font-semibold leading-tight md:text-lg">{item.name}</h2>
                <p className="mt-1 text-sm text-white/70">
                  <span className="text-lg font-semibold text-white">{item.price} ₾</span>-დან
                </p>
              </div>
              <button type="button" onClick={() => choose(item)} className={`${cta} mt-2 self-start px-5 py-2 text-sm md:mt-4 md:w-full md:py-2.5`}>
                არჩევა და დიზაინი <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
