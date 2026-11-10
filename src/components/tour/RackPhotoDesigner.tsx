import { useEffect, useRef, useState } from "react";
import { ImagePlus, Printer, Trash2 } from "lucide-react";
import PrintAnimation, { type PrintAnimationProps } from "@/components/PrintAnimation";
import { AREA, BOX, canvas, H, loadImg, loadSide, W, type SideLayers } from "@/lib/tour/garmentPhoto";

// The rack's large photo with an upload frame on the garment (David
// 2026-11-10: "can't the upload frame appear on this same photo? this is
// exactly what I want"). Tap the dashed frame → pick a photo → it lies on the
// garment with the cloth's folds through it; drag to move, slider for size,
// "ბეჭდვა" plays the print film. LOOK ONLY: nothing is ordered, priced, saved
// or uploaded anywhere — the photo never leaves the visitor's device. The
// order still goes through "არჩევა" (the constructor). One rack for now
// (Oversize, front) — the only one with a garment mask.

const A = AREA.front;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export default function RackPhotoDesigner({ alt }: { alt: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const layers = useRef<SideLayers | null>(null);
  const printCv = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.4 }); // centre, 0..1 of the frame
  const [scale, setScale] = useState(0.8); // 1 = as wide as the frame
  const [film, setFilm] = useState<Omit<PrintAnimationProps, "onDone" | "onSkip"> | null>(null);
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    let off = false;
    printCv.current = canvas();
    void loadSide("front").then((l) => {
      if (off) return;
      layers.current = l;
      setReady(true);
    });
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    const L = layers.current;
    const cv = ref.current;
    const pc = printCv.current;
    if (!ready || !L || !cv || !pc) return;
    const g = cv.getContext("2d")!;
    g.globalAlpha = 1;
    g.drawImage(L.photo, 0, 0, W, H);
    const b = pc.getContext("2d")!;
    b.globalCompositeOperation = "source-over";
    b.clearRect(0, 0, W, H);
    if (!img) return;
    const w = A.w * scale;
    const h = (w * img.naturalHeight) / img.naturalWidth;
    b.drawImage(img, A.x + pos.x * A.w - w / 2, A.y + pos.y * A.h - h / 2, w, h);
    // the cloth's folds through the print, and nothing outside the garment
    const sh = canvas();
    const c = sh.getContext("2d")!;
    c.drawImage(L.shade, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(pc, 0, 0);
    b.globalCompositeOperation = "multiply";
    b.drawImage(sh, 0, 0);
    b.globalCompositeOperation = "destination-in";
    b.drawImage(L.mask, 0, 0);
    g.globalAlpha = 0.95;
    g.drawImage(pc, 0, 0);
    g.globalAlpha = 1;
  }, [ready, img, pos, scale]);

  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const k = W / e.currentTarget.getBoundingClientRect().width;
    setPos({
      x: Math.min(1.1, Math.max(-0.1, d.x + ((e.clientX - d.px) * k) / A.w)),
      y: Math.min(1.1, Math.max(-0.1, d.y + ((e.clientY - d.py) * k) / A.h)),
    });
  };
  const onUp = () => {
    drag.current = null;
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    void loadImg(URL.createObjectURL(f)).then((i) => {
      setImg(i);
      setPos({ x: 0.5, y: 0.4 });
      setScale(0.8);
      setPrinted(false);
    });
  };

  // the pictures the print film needs, from what is on the photo now
  const startPrint = () => {
    const L = layers.current;
    const pc = printCv.current;
    if (!L || !pc || !img) return;
    const B = BOX.front;
    const crop = (src: HTMLCanvasElement, x = B.x, y = B.y, w = B.w, h = B.h) => {
      const c = canvas(w, h);
      c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, w, h);
      return c;
    };
    const garment = canvas();
    const g = garment.getContext("2d")!;
    g.drawImage(L.photo, 0, 0, W, H);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(L.mask, 0, 0);
    const blank = crop(garment);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 0.95;
    g.drawImage(pc, 0, 0);
    const done = crop(garment);
    const d = pc.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
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
      designSrc: crop(pc, x0, y0, x1 - x0 + 2, y1 - y0 + 2).toDataURL("image/png"),
      garmentBlankSrc: blank.toDataURL("image/png"),
      garmentPrintedSrc: done.toDataURL("image/png"),
      printLayerSrc: crop(pc).toDataURL("image/png"),
    });
  };

  const glass = "rounded-full bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";

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
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl" style={{ width: "min(92vw, calc((100dvh - 13rem) * 0.8))" }}>
        <canvas
          ref={ref}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={alt}
          className="h-full w-full touch-none select-none"
          style={{ cursor: img ? "grab" : "default", opacity: ready ? 1 : 0, transition: "opacity 200ms" }}
        />
        {ready && !img && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-500/80 bg-white/25 text-zinc-800 transition-colors hover:bg-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            style={{ left: pct(A.x, W), top: pct(A.y, H), width: pct(A.w, W), height: pct(A.h, H) }}
          >
            <ImagePlus className="h-8 w-8" aria-hidden />
            <span className="px-2 text-center text-sm font-bold leading-tight">ატვირთე ფოტო</span>
          </button>
        )}
      </div>

      {img ? (
        <div className="mt-3 flex w-full max-w-md flex-col gap-2 px-1">
          <label className="flex items-center gap-3 text-xs text-white/80">
            ზომა
            <input type="range" min={0.2} max={1.1} step={0.01} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="h-2 flex-1 accent-amber-400" />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="სხვა ფოტო" className={`inline-flex h-11 w-11 shrink-0 items-center justify-center ${glass}`}>
              <ImagePlus className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setImg(null)} aria-label="პრინტის წაშლა" className={`inline-flex h-11 w-11 shrink-0 items-center justify-center ${glass}`}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={startPrint}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-amber-400 text-base font-bold text-black hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Printer className="h-5 w-5" aria-hidden /> ბეჭდვა
            </button>
          </div>
          <p className="text-center text-[11px] leading-tight text-white/65">
            {printed ? "ნიმუშია — შეკვეთისთვის დახურე და დააჭირე „არჩევა“" : "თითით გადაადგილე პრინტი · ნიმუშია, შეკვეთა აქედან ჯერ არ ფორმდება"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-center text-xs text-white/70">დააჭირე ჩარჩოს — ნახე შენი ფოტო ამ მაისურზე</p>
      )}
    </div>
  );
}
