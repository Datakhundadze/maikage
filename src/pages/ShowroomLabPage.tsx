import { useCallback, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ImagePlus, RefreshCw, Trash2, Type } from "lucide-react";
import { COLORS } from "@/lib/catalog";

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

type Side = "front" | "back";
const W = 1200;
const H = 1500;
// where a print sits on the garment in the photo (px of the 1200×1500 photo)
const AREA: Record<Side, { x: number; y: number; w: number; h: number }> = {
  front: { x: 395, y: 470, w: 430, h: 560 },
  back: { x: 375, y: 400, w: 430, h: 620 },
};
const SRC: Record<Side, { photo: string; mask: string }> = {
  front: { photo: "/tour/lab/oversize-front.webp", mask: "/tour/lab/oversize-front-mask.png" },
  back: { photo: "/tour/lab/oversize-back.webp", mask: "/tour/lab/oversize-back-mask.png" },
};
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

interface SideLayers {
  photo: HTMLImageElement;
  mask: HTMLCanvasElement; // alpha = the garment
  shade: HTMLCanvasElement; // grey: the white garment's light, 1 = flat lit cloth
}

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
const canvas = (w = W, h = H) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

async function loadSide(side: Side): Promise<SideLayers> {
  const [photo, maskImg] = await Promise.all([loadImg(SRC[side].photo), loadImg(SRC[side].mask)]);
  // mask file is a grey picture → alpha
  const mask = canvas();
  const mg = mask.getContext("2d", { willReadFrequently: true })!;
  mg.drawImage(maskImg, 0, 0, W, H);
  const md = mg.getImageData(0, 0, W, H);
  // shade = photo luminance over the garment's bright level (90th percentile inside the mask)
  const pc = canvas();
  const pg = pc.getContext("2d", { willReadFrequently: true })!;
  pg.drawImage(photo, 0, 0, W, H);
  const pd = pg.getImageData(0, 0, W, H);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < md.data.length; i += 4) {
    const a = md.data[i];
    md.data[i + 3] = a;
    md.data[i] = md.data[i + 1] = md.data[i + 2] = 255;
    if (a > 200) {
      const l = Math.round(0.2126 * pd.data[i] + 0.7152 * pd.data[i + 1] + 0.0722 * pd.data[i + 2]);
      hist[l]++;
      n++;
    }
  }
  let ref = 255;
  for (let l = 255, acc = 0; l >= 0; l--) {
    acc += hist[l];
    if (acc > n * 0.1) {
      ref = l;
      break;
    }
  }
  mg.putImageData(md, 0, 0);
  for (let i = 0; i < pd.data.length; i += 4) {
    const l = 0.2126 * pd.data[i] + 0.7152 * pd.data[i + 1] + 0.0722 * pd.data[i + 2];
    const s = Math.min(255, (l / ref) * 255);
    pd.data[i] = pd.data[i + 1] = pd.data[i + 2] = s;
    pd.data[i + 3] = 255;
  }
  const shade = canvas();
  shade.getContext("2d")!.putImageData(pd, 0, 0);
  return { photo, mask, shade };
}

function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

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

      <p className={`relative z-10 mt-3 px-3 py-1 text-[11px] font-semibold ${glass}`}>ნიმუში · Oversize · შეკვეთა ჯერ არ მუშაობს</p>

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
        <button type="button" disabled className="h-12 rounded-full bg-amber-400/50 text-base font-bold text-black/70">
          შეკვეთა — მალე
        </button>
      </div>
    </div>
  );
}
