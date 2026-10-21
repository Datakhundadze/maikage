import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { catalog, type ProductColor } from "@/lib/catalog";
import { writeConstructorSeed } from "@/lib/constructorSeed";
import { productTypeKa } from "@/lib/i18n";
import { fromPrice } from "@/lib/landingPrice";
import type { RackItem, ShowroomRack } from "@/lib/tour/showroomRacks";

// The sheet a rack marker opens in /showroom: the garments of that rack
// hanging on a rail (they swing in), each with its name, its "from" price and
// "არჩევა" → the constructor with that product and brand picked (the same seed
// handoff the product landing pages use). The yellow rack opens the whole
// design catalog instead.
//
// PRICES: fromPrice → calculatePrice, the constructor's own price for that
// product + brand with nothing added yet — the same "from" price the landing
// pages show, so the showroom can never disagree with the constructor.

const BRAND_LABEL: Record<string, string> = {
  "JEL T-Shirt": "JEL Washed",
  "GILDAN Hoodie": "GILDAN",
  "Premium Washed Hoodie": "Premium Washed",
  "Sport Set": "ფეხბურთის ფორმა",
};

function itemImage(it: RackItem): string | null {
  const colors = catalog.getAvailableColors(it.product, it.brand);
  const color = (colors.includes("White" as ProductColor) ? "White" : colors[0]) as ProductColor | undefined;
  if (!color) return null;
  return catalog.findImageForColor(it.product, it.brand, color, "front")?.entry.imageUrl ?? null;
}

interface RackSheetProps {
  rack: ShowroomRack;
  onClose: () => void;
}

export default function RackSheet({ rack, onClose }: RackSheetProps) {
  const navigate = useNavigate();
  const items = useMemo(
    () =>
      rack.items === "catalog"
        ? []
        : rack.items.map((it) => ({
            ...it,
            name: `${BRAND_LABEL[it.brand] ?? it.brand} ${it.product === "Sport" ? "" : productTypeKa(it.product)}`.trim(),
            price: fromPrice(it.product, it.brand),
            image: itemImage(it),
          })),
    [rack],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (it: RackItem) => {
    writeConstructorSeed({ product: it.product, subProduct: it.brand });
    navigate("/");
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end" role="dialog" aria-modal="true" aria-label={rack.title}>
      <style>{`
        @keyframes maika-rack-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes maika-rack-swing { 0% { transform: rotate(-14deg) } 45% { transform: rotate(7deg) } 75% { transform: rotate(-3deg) } 100% { transform: rotate(0) } }
        @media (prefers-reduced-motion: reduce) { .maika-rack-anim { animation: none !important } }
      `}</style>
      <button type="button" aria-label="დახურვა" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="maika-rack-anim relative w-full rounded-t-2xl bg-[#141414]/95 pb-[max(5.5rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl backdrop-blur"
        style={{ animation: "maika-rack-up 260ms ease-out" }}
      >
        <div className="flex items-center justify-between px-4">
          <h2 className="text-base font-semibold">{rack.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="დახურვა"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {rack.items === "catalog" ? (
          <div className="px-4 pb-2 pt-3">
            <p className="text-sm text-white/80">აქ მთელი კატალოგი კიდია — ყველა დიზაინი, რაც კი გვაქვს. აირჩიე და შეუკვეთე.</p>
            <button
              type="button"
              onClick={() => navigate("/designs")}
              className="mt-4 w-full rounded-full bg-amber-400 px-5 py-3 text-sm font-semibold text-black hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              კატალოგის ნახვა
            </button>
          </div>
        ) : (
          <div className="relative mt-2">
            {/* the rail the garments hang from */}
            <div className="mx-4 h-1.5 rounded-full bg-gradient-to-b from-zinc-300 to-zinc-500" aria-hidden />
            <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {items.map((it, i) => (
                <li key={`${it.product}|${it.brand}`} className="w-40 shrink-0 snap-center">
                  <div
                    className="maika-rack-anim origin-top"
                    style={{ animation: `maika-rack-swing 900ms ease-out ${120 + i * 90}ms both` }}
                  >
                    {/* hanger */}
                    <svg viewBox="0 0 40 18" className="mx-auto -mb-1 h-5 w-10 text-zinc-300" aria-hidden>
                      <path d="M20 0 v5 M20 5 L3 16 h34 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                    <div className="overflow-hidden rounded-xl bg-white">
                      {it.image ? (
                        <img src={it.image} alt={it.name} loading="lazy" className="aspect-square w-full object-contain" />
                      ) : (
                        <div className="aspect-square w-full bg-zinc-200" />
                      )}
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight">{it.name}</p>
                  <p className="text-xs text-white/70">{it.price} ₾-დან</p>
                  <button
                    type="button"
                    onClick={() => choose(it)}
                    className="mt-2 w-full rounded-full bg-amber-400 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    არჩევა
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
