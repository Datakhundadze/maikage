import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ImagePlus, MessageCircle, Printer, RefreshCw, Trash2, Type, X } from "lucide-react";
import PrintAnimation, { type PrintAnimationProps } from "@/components/PrintAnimation";
import { BRAND_COLORS, COLORS } from "@/lib/catalog";
import type { ConstructorSeed } from "@/lib/constructorSeed";
import { TEXT_COLORS as PALETTE } from "@/lib/textColors";
import { drawGarment, garmentFilm, garmentScratch, H, loadImg, loadSide, W, type GarmentDesign, type GarmentScratch, type GarmentSpec, type Side, type SideLayers } from "@/lib/tour/garmentPhoto";

// The rack's large photo as the place to design (David 2026-11-10/11: "the
// upload frame on this same photo… and the tools right there around it:
// colours, back side, fonts — on exactly the background the enlarged view
// opens, no separate panel"). Everything floats on the photo itself:
//   dashed frame on the chest  → pick a photo
//   colour circles (left)      → the brand's real colours (catalog)
//   "ზურგი" (top right)        → the other side, with its own design
//   ფოტო / წარწერა (bottom)    → photo; text with font and colour
//   drag = move the print, slider = its size, "ბეჭდვა" = the print film
// LOOK ONLY: nothing is ordered, priced, saved or uploaded anywhere — the
// photo never leaves the visitor's device. The order still goes through
// "არჩევა" (the constructor). Racks listed in GARMENTS (garmentPhoto.ts):
// Oversize (front + a stand-in back), GIORDANO, the washed tee and the GILDAN
// hoodie (front only so far).

// the constructor's own fonts (SimplePage FONT_GROUPS), the ones the site loads
const FONTS = [
  { name: "Noto Sans", family: "'Noto Sans Georgian', sans-serif" },
  { name: "Noto Serif", family: "'Noto Serif Georgian', serif" },
  { name: "BPG Arial", family: "'BPG Arial', sans-serif" },
  { name: "Montserrat", family: "'Montserrat', sans-serif" },
  { name: "Oswald", family: "'Oswald', sans-serif" },
  { name: "Anton", family: "'Anton', Impact, sans-serif" },
  { name: "Bebas Neue", family: "'Bebas Neue', Impact, sans-serif" },
  { name: "Playfair", family: "'Playfair Display', serif" },
  { name: "Pacifico", family: "'Pacifico', cursive" },
  { name: "Dancing", family: "'Dancing Script', cursive" },
];
// text colours: the constructor's own palette (so the order carries the same colour); null = automatic
const TEXT_COLORS: (string | null)[] = [null, ...PALETTE.slice(0, 7).map((c) => c.hex)];

/** The uploaded photo as a data URL small enough for the handoff (localStorage): longest side ≤ max px. */
function photoDataUrl(img: HTMLImageElement, max: number): string {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  // keep transparency when the picture has any (a corner is enough to tell a cut-out)
  const d = g.getImageData(0, 0, 1, 1).data;
  return d[3] < 250 ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
}
const hexOf = (name: string) => COLORS.find((c) => c.name === name)?.hex ?? "#FFFFFF";
const emptyDesign = (): GarmentDesign => ({ img: null, text: "", font: FONTS[0].family, textColor: null, x: 0.5, y: 0.4, scale: 0.8 });
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

interface Props {
  alt: string;
  /** The rack's garment: photos, masks, print areas (GARMENTS). */
  garment: GarmentSpec;
  /** Catalog brand whose colours are offered (BRAND_COLORS). */
  brand: string;
  /** CSS width of the photo — the same as the plain large view, so nothing jumps. */
  width: string;
  /**
   * "შეკვეთა": hand the design to the site's constructor (colour, side, photo,
   * text) — the caller writes the seed and opens it. Returns false when the
   * browser refused to store it (photo too big); the designer then retries
   * with a smaller photo.
   */
  onOrder: (seed: ConstructorSeed) => boolean;
}

export default function RackPhotoDesigner({ alt, garment, brand, width, onOrder }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const layers = useRef<Partial<Record<Side, SideLayers>>>({});
  const scratch = useRef<GarmentScratch | null>(null);
  const colors = BRAND_COLORS[brand] ?? ["White"];
  const [ready, setReady] = useState(false);
  const [side, setSide] = useState<Side>("front");
  const [turn, setTurn] = useState(0);
  const [color, setColor] = useState<string>(garment.start && (colors as readonly string[]).includes(garment.start) ? garment.start : colors[0]);
  const [designs, setDesigns] = useState<Record<Side, GarmentDesign>>({ front: emptyDesign(), back: emptyDesign() });
  const [textOpen, setTextOpen] = useState(false);
  const [fontTick, setFontTick] = useState(0);
  const [film, setFilm] = useState<Omit<PrintAnimationProps, "onDone" | "onSkip"> | null>(null);
  const [printed, setPrinted] = useState(false);
  const [orderFailed, setOrderFailed] = useState(false);
  const design = designs[side];
  const setDesign = useCallback((patch: Partial<GarmentDesign>) => setDesigns((d) => ({ ...d, [side]: { ...d[side], ...patch } })), [side]);
  const has = !!design.img || !!design.text;
  // any change after the film: print again before ordering
  useEffect(() => {
    setPrinted(false);
    setOrderFailed(false);
  }, [design, color, side]);
  const recolor = color !== "White";
  const A = garment.sides[side]?.area ?? { x: 0, y: 0, w: W, h: H };
  const canFlip = !!garment.sides.front && !!garment.sides.back;
  // a ready photo of this colour and side, once it has loaded
  const [basePhotos, setBasePhotos] = useState<Record<string, HTMLImageElement>>({});
  const baseKey = `${color}|${side}`;
  const baseSrc = garment.colorPhoto?.[color]?.[side];
  const base = baseSrc ? (basePhotos[baseKey] ?? null) : null;
  useEffect(() => {
    if (!baseSrc || basePhotos[baseKey]) return;
    let off = false;
    void loadImg(baseSrc).then((img) => {
      if (!off) setBasePhotos((m) => ({ ...m, [baseKey]: img }));
    });
    return () => {
      off = true;
    };
  }, [baseSrc, baseKey, basePhotos]);

  useEffect(() => {
    let off = false;
    scratch.current = garmentScratch();
    const sides = (["front", "back"] as const).filter((sd) => garment.sides[sd]);
    void Promise.all(sides.map((sd) => loadSide(sd, garment.sides[sd]))).then((ls) => {
      if (off) return;
      layers.current = Object.fromEntries(sides.map((sd, i) => [sd, ls[i]]));
      setReady(true);
    });
    return () => {
      off = true;
    };
  }, [garment]);

  useEffect(() => {
    const L = layers.current[side];
    const g = ref.current?.getContext("2d");
    if (!ready || !L || !g || !scratch.current) return;
    // a colour with its own photo that has not loaded yet: wait, do not flash the white one
    if (baseSrc && !base) return;
    drawGarment(g, L, A, hexOf(color), recolor, design, scratch.current, base);
  }, [ready, side, color, recolor, design, fontTick, base, baseSrc, A]);

  // a web font is only there once it has been asked for: draw again when it arrives
  useEffect(() => {
    if (!design.text || !document.fonts?.load) return;
    let off = false;
    void document.fonts.load(`700 40px ${design.font}`, design.text).then(() => {
      if (!off) setFontTick((n) => n + 1);
    });
    return () => {
      off = true;
    };
  }, [design.font, design.text]);

  // the site chat may open over this overlay while it is on screen (index.css)
  useEffect(() => {
    document.documentElement.classList.add("maika-chat-over");
    return () => document.documentElement.classList.remove("maika-chat-over");
  }, []);

  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!has) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: design.x, y: design.y };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const k = W / e.currentTarget.getBoundingClientRect().width;
    setDesign({
      x: Math.min(1.1, Math.max(-0.1, d.x + ((e.clientX - d.px) * k) / A.w)),
      y: Math.min(1.1, Math.max(-0.1, d.y + ((e.clientY - d.py) * k) / A.h)),
    });
  };
  const onUp = () => {
    drag.current = null;
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    void loadImg(URL.createObjectURL(f)).then((img) => {
      setDesign({ img });
      setPrinted(false);
    });
  };

  const flip = () => {
    if (turn !== 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSide((s) => (s === "front" ? "back" : "front"));
      return;
    }
    setTurn(1);
    window.setTimeout(() => {
      setSide((s) => (s === "front" ? "back" : "front"));
      setTurn(0);
    }, 260);
  };

  const startPrint = () => {
    const L = layers.current[side];
    if (!L || !scratch.current) return;
    const f = garmentFilm(L, garment.sides[side]?.box ?? { x: 0, y: 0, w: W, h: H }, recolor, scratch.current, base);
    if (f) setFilm(f);
  };

  // the order: the same handoff the site chat uses — the constructor opens with
  // this colour, side, photo and text on the garment; price, order form and
  // payment are the constructor's own, untouched
  const order = () => {
    const base: ConstructorSeed = {
      color,
      side,
      ...(design.text.trim() ? { text: design.text.trim() } : {}),
      ...(design.textColor ? { textColor: PALETTE.find((c) => c.hex === design.textColor)?.name } : {}),
    };
    for (const max of design.img ? [2400, 1600, 1100] : [0]) {
      if (onOrder(design.img ? { ...base, image: photoDataUrl(design.img, max) } : base)) return;
    }
    setOrderFailed(true);
  };

  const glass = "bg-black/40 text-white ring-1 ring-white/30 backdrop-blur-md hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";

  return (
    <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
      {film && (
        <PrintAnimation
          {...film}
          onDone={() => {
            setFilm(null);
            setPrinted(true);
          }}
        />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      <div className="relative aspect-[4/5]" style={{ width, perspective: "1400px" }}>
        <canvas
          ref={ref}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={`${alt} — ${side === "front" ? "წინა მხარე" : "ზურგი"}`}
          className="h-full w-full touch-none select-none rounded-2xl bg-zinc-900 shadow-2xl"
          style={{
            cursor: has ? "grab" : "default",
            opacity: ready ? 1 : 0,
            transform: `rotateY(${turn * (side === "front" ? 90 : -90)}deg)`,
            transition: "transform 260ms cubic-bezier(.5,0,.5,1), opacity 200ms",
          }}
        />

        {/* the upload frame on the garment: only an outline, the photo shows through */}
        {ready && !has && turn === 0 && !textOpen && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`absolute flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              recolor ? "border-white/70 text-white hover:bg-white/10" : "border-zinc-500/80 text-zinc-700 hover:bg-black/5"
            }`}
            style={{ left: pct(A.x, W), top: pct(A.y, H), width: pct(A.w, W), height: pct(A.h, H) }}
          >
            <ImagePlus className="h-7 w-7" aria-hidden />
            <span className="px-2 text-center text-sm font-bold leading-tight">ატვირთე ფოტო</span>
          </button>
        )}

        {/* colours: the brand's own, as circles on the photo */}
        <div className={`absolute left-2 top-2 grid gap-2 ${colors.length > 8 ? "grid-cols-2" : "grid-cols-1"}`} role="radiogroup" aria-label="ფერი">
          {colors.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={color === name}
              aria-label={name}
              title={name}
              onClick={() => setColor(name)}
              className={`${colors.length > 5 ? "h-7 w-7" : "h-9 w-9"} rounded-full shadow-[0_2px_8px_rgba(0,0,0,.55)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                color === name ? "scale-110 ring-2 ring-amber-400 ring-offset-2 ring-offset-black/30" : "ring-1 ring-white/60"
              }`}
              style={{ backgroundColor: hexOf(name) }}
            />
          ))}
        </div>

        {/* the other side */}
        {canFlip && (
          <button type="button" onClick={flip} className={`absolute right-2 top-2 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${glass}`}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {side === "front" ? "ზურგი" : "წინა მხარე"}
          </button>
        )}

        {/* tools along the bottom of the photo */}
        <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
          {textOpen && (
            <div className="flex flex-col gap-1.5 rounded-2xl bg-black/45 p-2 ring-1 ring-white/25 backdrop-blur-md">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={design.text}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => {
                    setDesign({ text: e.target.value });
                    setPrinted(false);
                  }}
                  placeholder="დაწერე ტექსტი"
                  aria-label="წარწერა"
                  className="h-9 min-w-0 flex-1 rounded-full bg-black/50 px-3 text-sm text-white ring-1 ring-white/25 placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  style={{ fontFamily: design.font }}
                />
                <button type="button" onClick={() => setTextOpen(false)} aria-label="წარწერის დახურვა" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" role="radiogroup" aria-label="ფონტი">
                {FONTS.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    role="radio"
                    aria-checked={design.font === f.family}
                    onClick={() => setDesign({ font: f.family })}
                    className={`h-8 shrink-0 rounded-full px-3 text-sm ${design.font === f.family ? "bg-amber-400 text-black" : "bg-white/15 text-white hover:bg-white/25"}`}
                    style={{ fontFamily: f.family }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2" role="radiogroup" aria-label="წარწერის ფერი">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c ?? "auto"}
                    type="button"
                    role="radio"
                    aria-checked={design.textColor === c}
                    aria-label={c ?? "ავტომატური ფერი"}
                    onClick={() => setDesign({ textColor: c })}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${design.textColor === c ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-black/40" : "ring-1 ring-white/50"}`}
                    style={c ? { backgroundColor: c } : { background: "linear-gradient(135deg,#141414 50%,#f6f6f6 50%)" }}
                  />
                ))}
              </div>
            </div>
          )}
          {has && !textOpen && (
            <label className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-[11px] text-white ring-1 ring-white/25 backdrop-blur-md">
              ზომა
              <input type="range" min={0.2} max={1.1} step={0.01} value={design.scale} onChange={(e) => setDesign({ scale: Number(e.target.value) })} className="h-2 min-w-0 flex-1 accent-amber-400" />
            </label>
          )}
          {!textOpen && (
            <div className="flex items-center justify-center gap-1.5">
              <button type="button" onClick={() => fileRef.current?.click()} className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${glass}`}>
                <ImagePlus className="h-4 w-4" aria-hidden /> ფოტო
              </button>
              <button type="button" onClick={() => setTextOpen(true)} className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${glass}`}>
                <Type className="h-4 w-4" aria-hidden /> წარწერა
              </button>
              {/* the site's own chat, opened over this view (the operators answer there) */}
              <button type="button" onClick={() => window.dispatchEvent(new Event("maika:open-chat"))} className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${glass}`}>
                <MessageCircle className="h-4 w-4" aria-hidden /> ჩატი
              </button>
              {has && (
                <button type="button" onClick={() => setDesign(emptyDesign())} aria-label="პრინტის წაშლა" className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${glass}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-white/70">
        {orderFailed
          ? "ფოტო ძალიან დიდია გადასაცემად — დახურე და დააჭირე „არჩევა“, იქ ატვირთე"
          : printed
            ? "მზადაა! „შეკვეთა“ გახსნის შეკვეთის გვერდს ამ დიზაინით"
            : has
              ? "თითით გადაადგილე პრინტი, მერე დააჭირე „ბეჭდვა“"
              : "დააჭირე ჩარჩოს — ნახე შენი ფოტო ამ მაისურზე"}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!has}
          onClick={startPrint}
          className={
            printed
              ? "inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              : "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-amber-400 px-8 text-base font-bold text-black transition-opacity hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-45"
          }
          aria-label={printed ? "ბეჭდვის ანიმაცია ხელახლა" : undefined}
        >
          <Printer className="h-5 w-5" aria-hidden /> {!printed && "ბეჭდვა"}
        </button>
        {printed && has && (
          <button
            type="button"
            onClick={order}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-amber-400 px-8 text-base font-bold text-black hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            შეკვეთა <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
