import { useCallback, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ImagePlus, Printer, RefreshCw, Trash2, Type } from "lucide-react";
import PrintAnimation, { type PrintAnimationProps } from "@/components/PrintAnimation";
import { COLORS } from "@/lib/catalog";
import { AREA, BOX, canvas, H, loadImg, loadSide, lum, SRC, W, type Side, type SideLayers } from "@/lib/tour/garmentPhoto";

// /showroom/lab — a LOOK PROTOTYPE, not a constructor (David 2026-11-10).
// The idea under test: design a garment right on the showroom's own rack
// photo — colour circles, the garment turning round to its back, a photo or
// a line of text printed on it — before any of it is wired to the real
// constructor. One rack only (Oversize). Nothing here touches the site's
// constructor, prices, cart or orders; there is no order button that works.
// noindex, linked from nowhere.
//
// How the picture is made (canvas 2D, all on the GPU):
//   colour  = the colour × the white garment's own light and folds (a "shade"
//             map taken from the photo), clipped to a mask of the front garment
//   print   = the design × the same shade map, clipped to the mask — so the
//             folds run through the print as they would on cloth

// the brand's real colours first, then a few catalog colours only to judge the recolouring
const REAL = ["White", "Black"];
const DEMO = ["Beige", "Gray", "Red", "Burgundy", "Pink", "Yellow", "Green", "Light Blue", "Blue"];
const hexOf = (name: string) => COLORS.find((c) => c.name === name)?.hex ?? "#FFFFFF";

interface Design {
  img: HTMLImageElement | null;
  text: string;
  x: number; // centre, 0..1 of the print area
  y: number;
  scale: number; // 1 = as wide as the print area
}
const emptyDesign = (): Design => ({ img: null, text: "", x: 0.5, y: 0.38, scale: 0.7 });

export default function ShowroomLabPage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const layers = useRef<Partial<Record<Side, SideLayers>>>({});
  const tmpA = useRef<HTMLCanvasElement | null>(null);
  const tmpB = useRef<HTMLCanvasElement | null>(null);
  const tmpC = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [side, setSide] = useState<Side>("front");
  const [turn, setTurn] = useState(0); // 0 flat … 1 edge-on (the turn animation)
  const [color, setColor] = useState("White");
  const [designs, setDesigns] = useState<Record<Side, Design>>({ front: emptyDesign(), back: emptyDesign() });
  const [textOpen, setTextOpen] = useState(false);
  const [film, setFilm] = useState<Omit<PrintAnimationProps, "onDone" | "onSkip"> | null>(null);
  const [printed, setPrinted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const design = designs[side];
  const setDesign = useCallback((patch: Partial<Design>) => setDesigns((d) => ({ ...d, [side]: { ...d[side], ...patch } })), [side]);

  useEffect(() => {
    let off = false;
    tmpA.current = canvas();
    tmpB.current = canvas();
    tmpC.current = canvas();
    void Promise.all([loadSide("front"), loadSide("back")]).then(([f, b]) => {
      if (off) return;
      layers.current = { front: f, back: b };
      setReady(true);
    });
    return () => {
      off = true;
    };
  }, []);

  // ── draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = layers.current[side];
    const cv = ref.current;
    if (!ready || !L || !cv || !tmpA.current || !tmpB.current || !tmpC.current) return;
    const g = cv.getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.drawImage(L.photo, 0, 0, W, H);

    // colour
    const hex = hexOf(color);
    if (color !== "White") {
      const a = tmpA.current.getContext("2d")!;
      a.globalCompositeOperation = "source-over";
      a.globalAlpha = 1;
      const dark = 1 - lum(hex);
      // very dark cloth still shows its folds: lift the colour a little
      const v = parseInt(hex.slice(1), 16);
      const lift = Math.round(34 * dark * dark);
      a.fillStyle = `rgb(${Math.min(255, ((v >> 16) & 255) + lift)}, ${Math.min(255, ((v >> 8) & 255) + lift)}, ${Math.min(255, (v & 255) + lift)})`;
      a.fillRect(0, 0, W, H);
      a.globalCompositeOperation = "multiply";
      a.drawImage(L.shade, 0, 0);
      a.globalCompositeOperation = "destination-in";
      a.drawImage(L.mask, 0, 0);
      g.drawImage(tmpA.current, 0, 0);
    }

    // print
    if (design.img || design.text) {
      const A = AREA[side];
      const b = tmpB.current.getContext("2d")!;
      b.globalCompositeOperation = "source-over";
      b.globalAlpha = 1;
      b.clearRect(0, 0, W, H);
      const cx = A.x + design.x * A.w;
      const cy = A.y + design.y * A.h;
      const w = A.w * design.scale;
      if (design.img) {
        const h = (w * design.img.naturalHeight) / design.img.naturalWidth;
        b.drawImage(design.img, cx - w / 2, cy - h / 2, w, h);
      }
      if (design.text) {
        const size = Math.max(18, w * 0.16);
        b.font = `800 ${size}px "Noto Sans Georgian", system-ui, sans-serif`;
        b.textAlign = "center";
        b.textBaseline = "middle";
        b.fillStyle = lum(hex) > 0.55 ? "#141414" : "#f6f6f6";
        const ty = design.img ? cy + (w * design.img.naturalHeight) / design.img.naturalWidth / 2 + size * 0.9 : cy;
        b.fillText(design.text, cx, ty, A.w * 1.05);
      }
      // the cloth's folds through the print: shade kept only where the print is, multiplied in
      const c = tmpC.current.getContext("2d")!;
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, W, H);
      c.drawImage(L.shade, 0, 0);
      c.globalCompositeOperation = "destination-in";
      c.drawImage(tmpB.current, 0, 0);
      b.globalCompositeOperation = "multiply";
      b.drawImage(tmpC.current, 0, 0);
      b.globalCompositeOperation = "destination-in";
      b.drawImage(L.mask, 0, 0);
      g.globalAlpha = 0.95;
      g.drawImage(tmpB.current, 0, 0);
      g.globalAlpha = 1;
    }
  }, [ready, side, color, design]);

  // ── drag the print ────────────────────────────────────────────────────────
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!design.img && !design.text) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: design.x, y: design.y };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const k = W / r.width;
    const A = AREA[side];
    setDesign({
      x: Math.min(1.1, Math.max(-0.1, d.x + ((e.clientX - d.px) * k) / A.w)),
      y: Math.min(1.1, Math.max(-0.1, d.y + ((e.clientY - d.py) * k) / A.h)),
    });
  };
  const onUp = () => {
    drag.current = null;
  };

  // the pictures the print film needs, from what is on the canvas now
  const startPrint = () => {
    const L = layers.current[side];
    if (!L || !tmpA.current || !tmpB.current) return;
    const B = BOX[side];
    const crop = (src: HTMLCanvasElement, x = B.x, y = B.y, w = B.w, h = B.h) => {
      const c = canvas(w, h);
      c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, w, h);
      return c;
    };
    const garment = canvas();
    const g = garment.getContext("2d")!;
    g.drawImage(L.photo, 0, 0, W, H);
    if (color !== "White") g.drawImage(tmpA.current, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(L.mask, 0, 0);
    const blank = crop(garment);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 0.95;
    g.drawImage(tmpB.current, 0, 0);
    const done = crop(garment);
    // the print alone, cropped to what is drawn
    const d = tmpB.current.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2)
        if (d[(y * W + x) * 4 + 3] > 20) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 <= x0 || y1 <= y0) return;
    setFilm({
      designSrc: crop(tmpB.current, x0, y0, x1 - x0 + 2, y1 - y0 + 2).toDataURL("image/png"),
      garmentBlankSrc: blank.toDataURL("image/png"),
      garmentPrintedSrc: done.toDataURL("image/png"),
      printLayerSrc: crop(tmpB.current).toDataURL("image/png"),
    });
  };

  const flip = () => {
    if (turn !== 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setSide((s) => (s === "front" ? "back" : "front"));
      return;
    }
    setTurn(1);
    window.setTimeout(() => {
      setSide((s) => (s === "front" ? "back" : "front"));
      setTurn(0);
    }, 260);
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    void loadImg(url).then((img) => setDesign({ img }));
  };

  const glass = "rounded-full bg-black/45 text-white ring-1 ring-white/25 backdrop-blur-md";
  const has = !!design.img || !!design.text;

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center overflow-hidden bg-black text-white">
      <Helmet>
        <title>შოურუმის კონსტრუქტორი — ნიმუში</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div aria-hidden className="absolute -inset-10 bg-cover bg-center opacity-70 blur-2xl" style={{ backgroundImage: `url(${SRC.front.photo})` }} />
      <div aria-hidden className="absolute inset-0 bg-black/35" />
      {film && (
        <PrintAnimation
          {...film}
          onDone={() => {
            setFilm(null);
            setPrinted(true);
          }}
        />
      )}

      <p className={`relative z-10 mt-3 px-3 py-1 text-[11px] font-semibold ${glass}`}>ნიმუში · Oversize · შეკვეთა არ ფორმდება</p>

      <div className="relative z-10 mt-2 flex w-full flex-1 items-center justify-center px-3" style={{ perspective: "1400px" }}>
        <canvas
          ref={ref}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={side === "front" ? "მაისური — წინა მხარე" : "მაისური — ზურგი"}
          className="max-h-[50dvh] w-auto max-w-full touch-none rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,.9)]"
          style={{
            aspectRatio: `${W} / ${H}`,
            transform: `rotateY(${turn * (side === "front" ? 90 : -90)}deg)`,
            transition: "transform 260ms cubic-bezier(.5,0,.5,1)",
            cursor: has ? "grab" : "default",
            opacity: ready ? 1 : 0,
          }}
        />
        {!ready && <span className="absolute text-sm text-white/80">იტვირთება…</span>}
      </div>

      <div className="relative z-10 flex w-full max-w-xl flex-col gap-2 px-3 pb-20 pt-2">
        {/* colours */}
        <div className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup" aria-label="ფერი">
          {[...REAL, ...DEMO].map((name, i) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={color === name}
              aria-label={name}
              title={name}
              onClick={() => setColor(name)}
              className={`h-8 w-8 rounded-full shadow-[0_2px_8px_rgba(0,0,0,.5)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${color === name ? "scale-110 ring-2 ring-amber-400 ring-offset-2 ring-offset-black/40" : "ring-1 ring-white/40"} ${i === REAL.length ? "ml-2" : ""}`}
              style={{ backgroundColor: hexOf(name) }}
            />
          ))}
        </div>
        <p className="text-center text-[10.5px] leading-tight text-white/65">პირველი ორი ნამდვილი ფერია, დანარჩენი — ფერის ცვლის შესამოწმებლად</p>

        {/* tools */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} className={`inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold ${glass}`}>
            <ImagePlus className="h-4 w-4" aria-hidden /> ფოტო
          </button>
          <button type="button" onClick={() => setTextOpen((o) => !o)} aria-expanded={textOpen} className={`inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold ${glass}`}>
            <Type className="h-4 w-4" aria-hidden /> წარწერა
          </button>
          <button type="button" onClick={flip} className={`inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold ${glass}`}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {side === "front" ? "ზურგი" : "წინა მხარე"}
          </button>
          {has && (
            <button type="button" onClick={() => setDesign(emptyDesign())} aria-label="პრინტის წაშლა" className={`inline-flex h-11 w-11 items-center justify-center ${glass}`}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        {textOpen && (
          <input
            type="text"
            value={design.text}
            maxLength={40}
            onChange={(e) => setDesign({ text: e.target.value })}
            placeholder="დაწერე ტექსტი"
            aria-label="წარწერა"
            className="h-11 w-full rounded-full bg-black/55 px-4 text-sm text-white ring-1 ring-white/25 backdrop-blur-md placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        )}
        {has && (
          <label className="flex items-center gap-3 px-1 text-xs text-white/80">
            ზომა
            <input type="range" min={0.2} max={1.1} step={0.01} value={design.scale} onChange={(e) => setDesign({ scale: Number(e.target.value) })} className="h-2 flex-1 accent-amber-400" />
          </label>
        )}
        <button
          type="button"
          disabled={!has}
          onClick={startPrint}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-amber-400 text-base font-bold text-black transition-opacity disabled:opacity-45"
        >
          <Printer className="h-5 w-5" aria-hidden /> ბეჭდვა
        </button>
        <p className="text-center text-[10.5px] leading-tight text-white/65">
          {printed ? "ნამდვილ საიტზე აქ შეკვეთის ფანჯარა გაიხსნება" : has ? "ნიმუშია: ანიმაციის მერე შეკვეთა არ გაფორმდება" : "ჯერ დაადე ფოტო ან წარწერა"}
        </p>
      </div>
    </div>
  );
}
