import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { fromPrice } from "@/lib/landingPrice";
import { rackPhoto } from "@/lib/tour/rackItem";
import type { ShowroomRack } from "@/lib/tour/showroomRacks";

// Choosing a rack at the operators' desk (/showroom). David 2026-11-10: the
// list of 18 small name buttons was not it — the operator asks "which product
// are you interested in?", three big buttons answer (T-shirts · hoodies ·
// other), and a category opens photo cards of its racks: the rack's own
// photo, the brand and the price it starts from. A card walks there.
//
// PRICES: fromPrice → calculatePrice (the constructor's own price), never a
// number written here.

export interface PickerDest {
  id: string;
  title: string;
  rack?: ShowroomRack;
}

interface Props {
  groups: { title: string; dests: PickerDest[] }[];
  onPick: (id: string) => void;
}

function priceOf(rack: ShowroomRack): number | null {
  if (rack.items === "catalog") return null;
  const ps = rack.items.map((it) => fromPrice(it.product, it.brand)).filter((p): p is number => typeof p === "number" && p > 0);
  return ps.length ? Math.min(...ps) : null;
}

export default function RackPicker({ groups, onPick }: Props) {
  const [cat, setCat] = useState<number | null>(null);
  const g = cat === null ? null : groups[cat];
  return (
    <nav
      id="maika-rack-picker"
      aria-label="რომელი პროდუქტი გაინტერესებთ?"
      className="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-50 mx-auto flex max-w-3xl flex-col px-3 text-white"
    >
      <style>{`
        @keyframes maika-pick-in { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
        .maika-pick { animation: maika-pick-in 260ms cubic-bezier(.2,.8,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .maika-pick { animation: none } }
      `}</style>
      {!g ? (
        <ul className="maika-pick flex justify-center gap-2">
          {groups.map((x, i) => (
            <li key={x.title} className="pointer-events-auto min-w-0 flex-1 md:flex-none">
              <button
                type="button"
                onClick={() => setCat(i)}
                className="h-12 w-full rounded-full bg-white/15 px-4 text-sm font-bold text-white shadow-[0_6px_22px_-6px_rgba(0,0,0,.7)] ring-1 ring-white/40 backdrop-blur-md transition-colors [text-shadow:0_1px_4px_rgba(0,0,0,.7)] hover:bg-white/25 active:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 md:w-auto md:px-8 md:text-base"
              >
                {x.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="maika-pick pointer-events-auto flex max-h-[min(70vh,34rem)] flex-col rounded-2xl bg-black/55 p-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,.8)] ring-1 ring-white/15 backdrop-blur-md">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCat(null)}
              aria-label="უკან"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
            <h3 className="text-sm font-bold">{g.title}</h3>
          </div>
          <ul className="grid grid-cols-4 gap-2 overflow-y-auto md:grid-cols-6">
            {g.dests.map((d) => {
              const price = d.rack ? priceOf(d.rack) : null;
              return (
                <li key={d.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onPick(d.id)}
                    className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {d.rack && (
                      <img
                        src={rackPhoto(d.rack)}
                        alt=""
                        width={240}
                        height={300}
                        loading="lazy"
                        decoding="async"
                        className="aspect-[4/5] w-full rounded-xl bg-white/10 object-cover ring-1 ring-white/15 transition-transform group-active:scale-95"
                      />
                    )}
                    <span className="mt-1 block text-[10.5px] font-semibold leading-tight md:text-xs">{d.title}</span>
                    {price !== null && <span className="block text-[10.5px] font-bold leading-tight text-amber-400 md:text-xs">{price} ₾-დან</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );
}
