import { useEffect, useRef, useState } from "react";

// "ბეჭდვა" — the order's print played as a short film (David 2026-11-10):
// the chosen print comes out of a DTF printer on film, gets its powder and
// heat, then the chosen garment lies on the heat press, the film goes on,
// the press closes (3-2-1, steam), opens, the film is peeled off — the print
// stays on the garment; then it is folded and dropped into the shop's paper
// bag (David 2026-11-12, his photo of the bag). ~12 s, can be skipped; with reduced motion only the
// finished garment is shown for a moment.
//
// The printer and the press are pictures drawn with ChatGPT (2026-11-11,
// public/tour/print/*.webp, transparent): the printer from the front, the
// press from above in two parts — the base with its grey pad, and the upper
// plate that slides over it.
//
// Pure presentation: it gets four pictures and calls onDone. It knows
// nothing about products, prices or orders.

export interface PrintAnimationProps {
  /** The print alone (transparent), cropped to itself — what the printer prints. */
  designSrc: string;
  /** The garment without the print, and with it (same frame, transparent background). */
  garmentBlankSrc: string;
  garmentPrintedSrc: string;
  /** The print alone in the garment's frame (lies over the blank garment as the film's picture). */
  printLayerSrc: string;
  /** The garment's colour (hex) and kind, for the folded garment that goes into the bag at the end. */
  garmentColor?: string;
  folded?: "tee" | "hoodie";
  onDone: () => void;
  onSkip?: () => void;
}

type Phase = "print" | "cure" | "lay" | "press" | "open" | "peel" | "fold" | "bag" | "done";
const ORDER: [Phase, number][] = [
  ["print", 2600],
  ["cure", 1500],
  ["lay", 800],
  ["press", 2100],
  ["open", 600],
  ["peel", 1000],
  ["fold", 900],
  ["bag", 1500],
  ["done", 1300],
];
const CAPTION: Record<Phase, string> = {
  print: "პრინტი იბეჭდება ფირზე…",
  cure: "ფხვნილი და გაშრობა…",
  lay: "ფირი მაისურზე…",
  press: "თერმოპრესი…",
  open: "თერმოპრესი…",
  peel: "ფირი ძვრება…",
  fold: "იკეცება…",
  bag: "იფუთება…",
  done: "მზადაა!",
};

// the folded garment's picture and where the print lies on it (its chest)
const FOLDED = {
  tee: { src: "/tour/print/folded-tee.webp", aspect: "469 / 661", print: { left: "24%", top: "38%", width: "52%", height: "36%" } },
  hoodie: { src: "/tour/print/folded-hoodie.webp", aspect: "466 / 713", print: { left: "29%", top: "45%", width: "42%", height: "22%" } },
} as const;

export default function PrintAnimation({ designSrc, garmentBlankSrc, garmentPrintedSrc, printLayerSrc, garmentColor = "#f4f4f2", folded = "tee", onDone, onSkip }: PrintAnimationProps) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<Phase>(reduce ? "done" : "print");
  const [count, setCount] = useState(3);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const ids: number[] = [];
    if (reduce) {
      ids.push(window.setTimeout(() => doneRef.current(), 900));
      return () => ids.forEach((id) => window.clearTimeout(id));
    }
    let at = 0;
    for (const [p, ms] of ORDER) {
      ids.push(window.setTimeout(() => setPhase(p), at));
      if (p === "press") {
        ids.push(window.setTimeout(() => setCount(3), at));
        ids.push(window.setTimeout(() => setCount(2), at + 700));
        ids.push(window.setTimeout(() => setCount(1), at + 1400));
      }
      at += ms;
    }
    ids.push(window.setTimeout(() => doneRef.current(), at));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [reduce]);

  const printer = phase === "print" || phase === "cure";
  const pressed = phase === "press";
  const afterPress = phase === "open" || phase === "peel";
  // the end: the printed garment is folded and goes into the shop's paper bag
  const packing = phase === "fold" || phase === "bag" || phase === "done";
  const fold = FOLDED[folded];
  const bagMove = { transform: "translate(-50%, 0)", animation: phase === "bag" ? "pa-bag-in 480ms cubic-bezier(.2,.8,.2,1) both, pa-bag-nod 380ms ease-out 1200ms" : undefined } as const;

  return (
    <div role="dialog" aria-modal="true" aria-label="ბეჭდვა" className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_30%,#2b2620_0%,#0c0c0c_75%)] text-white">
      <style>{`
        @keyframes pa-feed { from { transform: translateY(-100%) } to { transform: translateY(0) } }
        @keyframes pa-head { from { left: 0% } to { left: 84% } }
        @keyframes pa-led { 50% { opacity: .25 } }
        @keyframes pa-powder { from { transform: translateY(-30px); opacity: 0 } 15% { opacity: 1 } to { transform: translateY(250px); opacity: 0 } }
        @keyframes pa-heat { 0%, 100% { opacity: 0 } 50% { opacity: .55 } }
        @keyframes pa-drop { from { transform: translateY(-46%) scale(1.06); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes pa-steam { from { transform: translate(0, 0) scale(.6); opacity: 0 } 30% { opacity: .5 } to { transform: translate(var(--dx), -90px) scale(1.7); opacity: 0 } }
        @keyframes pa-peel { to { transform: translate(-58%, -64%) rotate(-24deg); opacity: 0 } }
        @keyframes pa-pop { from { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } to { transform: scale(1) } }
        @keyframes pa-shine { from { transform: translateX(-140%) skewX(-18deg) } to { transform: translateX(260%) skewX(-18deg) } }
        @keyframes pa-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        @keyframes pa-away { to { transform: translateY(-40px) scale(.45); opacity: 0 } }
        @keyframes pa-folded { from { transform: scale(.3, .5) rotate(-8deg); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes pa-into { 0% { transform: none } 22% { transform: translateY(-12px) } 100% { transform: translateY(236px) scale(.92) } }
        @keyframes pa-bag-in { from { transform: translate(-50%, 130%) } to { transform: translate(-50%, 0) } }
        @keyframes pa-bag-nod { 0%, 100% { transform: translate(-50%, 0) } 45% { transform: translate(-50%, 7px) scale(1.02, .985) } }
      `}</style>

      <p key={CAPTION[phase]} aria-live="polite" className="mb-4 h-7 text-base font-bold tracking-wide" style={{ animation: "pa-in 260ms ease-out both" }}>
        {CAPTION[phase]}
      </p>

      <div className="relative h-[450px] w-[320px] max-w-[92vw]">
        {/* ── scene 1–2: the DTF printer (picture: public/tour/print/printer.webp) ── */}
        {printer && (
          <div className="absolute inset-0" style={{ animation: "pa-in 300ms ease-out both" }}>
            <div className="absolute inset-x-0 top-0 z-10 aspect-[1085/559] drop-shadow-[0_16px_26px_rgba(0,0,0,.75)]">
              <img src="/tour/print/printer.webp" alt="" draggable={false} className="h-full w-full select-none" />
              {/* the head at work: a light running along the rail behind the window */}
              {phase === "print" && (
                <span className="absolute left-[14%] top-[36%] h-[34%] w-[62%] overflow-hidden rounded-xl">
                  <span className="absolute top-0 h-full w-[16%] rounded-full bg-sky-300/70 blur-md" style={{ animation: "pa-head 330ms ease-in-out infinite alternate" }} />
                </span>
              )}
              <span className="absolute left-[84.3%] top-[69.5%] h-[4%] w-[2.2%] rounded-full bg-emerald-300 blur-[1px]" style={{ animation: "pa-led 700ms infinite" }} />
            </div>
            {/* the film coming out of the slot (the slot is at 92.5% of the printer's height) */}
            <div className="absolute left-1/2 z-20 h-[280px] w-[70%] -translate-x-1/2 overflow-hidden" style={{ top: "calc(min(320px, 92vw) * 559 / 1085 * 0.925)" }}>
              <div
                className="relative h-full w-full rounded-b-lg border border-t-0 border-white/25 bg-white/[0.09] backdrop-blur-[1px]"
                style={{ animation: "pa-feed 2400ms cubic-bezier(.3,0,.4,1) both" }}
              >
                <img src={designSrc} alt="" className="absolute inset-0 m-auto max-h-[78%] max-w-[82%] object-contain" />
                <span className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent" />
                {phase === "cure" && (
                  <>
                    {Array.from({ length: 18 }, (_, i) => (
                      <span
                        key={i}
                        className="absolute top-0 h-1 w-1 rounded-full bg-white/90"
                        style={{ left: `${6 + ((i * 53) % 88)}%`, animation: `pa-powder ${700 + ((i * 37) % 400)}ms linear ${(i * 61) % 500}ms both` }}
                      />
                    ))}
                    <span className="absolute inset-0 bg-orange-500 mix-blend-screen" style={{ animation: "pa-heat 900ms ease-in-out 600ms both" }} />
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── scene 3–4: the heat press from above (press-base.webp / press-top.webp, both 2:3) ── */}
        {!printer && !packing && (
          <div className="absolute inset-x-[10px] inset-y-0" style={{ animation: "pa-in 300ms ease-out both" }}>
            <img src="/tour/print/press-base.webp" alt="" draggable={false} className="absolute inset-0 h-full w-full select-none drop-shadow-[0_18px_30px_rgba(0,0,0,.8)]" />
            {/* the garment on the grey pad */}
            <div className="absolute bottom-[14.5%] left-[9%] right-[9%] top-[23.5%]">
              <img src={afterPress ? garmentPrintedSrc : garmentBlankSrc} alt="" className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.35)]" />
              {/* the film with the print, laid on; peeled off at the end */}
              <div
                  className="absolute inset-0"
                  style={{
                    animation: phase === "lay" ? "pa-drop 620ms cubic-bezier(.2,.8,.2,1) both" : phase === "peel" ? "pa-peel 900ms cubic-bezier(.5,0,.8,.4) both" : undefined,
                    transformOrigin: "100% 100%",
                  }}
                >
                  {!afterPress && <img src={printLayerSrc} alt="" className="absolute inset-0 h-full w-full object-contain" />}
                  <span className="absolute left-[16%] right-[16%] top-[10%] h-[62%] rounded-md border border-white/40 bg-white/[0.14]" />
                </div>
            </div>
            {/* the upper plate: comes down over the pad, the count on its display */}
            <div className="pointer-events-none absolute inset-x-0 -top-8 bottom-0 z-10 overflow-hidden">
              <div
                className="absolute inset-x-0 bottom-0 top-8"
                style={{ transform: pressed ? "translateY(3.5%)" : "translateY(-112%)", transition: `transform ${pressed ? 420 : 380}ms cubic-bezier(.4,0,.2,1)` }}
              >
                <img src="/tour/print/press-top.webp" alt="" draggable={false} className="h-full w-full select-none drop-shadow-[0_22px_26px_rgba(0,0,0,.7)]" />
                <span className="absolute left-[36%] top-[42.5%] flex h-[11%] w-[28%] items-center justify-center">
                  <span key={count} className="text-4xl font-black tabular-nums leading-none text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,.8)]" style={{ animation: "pa-pop 320ms ease-out both" }}>
                    {count}
                  </span>
                </span>
                <span className="absolute inset-x-0 top-[56%] text-center text-xs font-semibold tracking-widest text-white/70">160°C</span>
              </div>
            </div>
            {/* steam */}
            {(pressed || phase === "open") &&
              [-1, 1, -1, 1].map((s, i) => (
                <span
                  key={i}
                  className="absolute bottom-[18%] z-20 h-14 w-14 rounded-full bg-white/60 blur-xl"
                  style={{ left: s < 0 ? "-6%" : "88%", ["--dx" as string]: `${s * (26 + i * 9)}px`, animation: `pa-steam 1100ms ease-out ${i * 260}ms infinite` }}
                />
              ))}
          </div>
        )}

        {/* ── scene 5: folded, into the maika.ge paper bag. Pictures drawn with ChatGPT
            (2026-11-12, public/tour/print/): a shop-folded white tee / hoodie — coloured here
            like the garment, the print on its chest — and the black maika.ge bag in two
            layers (bag-back = the whole bag, bag-front = its front panel and handles), so
            the folded garment drops IN between them. ── */}
        {packing && (
          <div className="absolute inset-0">
            {/* a light, warm ground: a black garment and the black bag were lost on the dark screen (David 2026-11-12) */}
            <div
              className="absolute -inset-x-10 -bottom-6 top-1 rounded-[48px]"
              style={{ background: "radial-gradient(ellipse at 50% 46%, #f6ecd9 0%, #e2d2b4 48%, rgba(180,160,125,.55) 68%, transparent 80%)", animation: "pa-in 300ms ease-out both" }}
            />
            {/* the pressed garment leaves… */}
            {phase === "fold" && (
              <div className="absolute inset-x-[10px] bottom-[14.5%] top-[23.5%]" style={{ animation: "pa-away 360ms ease-in both" }}>
                <img src={garmentPrintedSrc} alt="" className="absolute inset-0 h-full w-full object-contain" />
              </div>
            )}
            {(phase === "bag" || phase === "done") && (
              <div className="absolute left-1/2 top-[132px] z-10 w-[200px]" style={bagMove}>
                <img src="/tour/print/bag-back.webp" alt="" draggable={false} className="block w-full select-none drop-shadow-[0_18px_22px_rgba(0,0,0,.8)]" />
              </div>
            )}
            {/* …and comes back folded */}
            {phase !== "done" && (
              <div
                className="absolute left-1/2 top-[14px] z-20 w-[132px]"
                style={{
                  marginLeft: -66,
                  aspectRatio: fold.aspect,
                  animation: phase === "fold" ? "pa-folded 420ms cubic-bezier(.2,.9,.3,1.2) 260ms both" : "pa-into 700ms cubic-bezier(.6,0,.85,.6) 560ms both",
                }}
              >
                <div className="absolute inset-0" style={{ backgroundColor: garmentColor, WebkitMaskImage: `url(${fold.src})`, maskImage: `url(${fold.src})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }}>
                  <img src={fold.src} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none mix-blend-multiply" />
                  <img src={fold.src} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none opacity-[0.14] mix-blend-screen" />
                  <img src={designSrc} alt="" className="absolute object-contain" style={fold.print} />
                </div>
              </div>
            )}
            {(phase === "bag" || phase === "done") && (
              <div className="absolute left-1/2 top-[132px] z-30 w-[200px]" style={bagMove}>
                <img src="/tour/print/bag-front.webp" alt="maika.ge" draggable={false} className="block w-full select-none" />
              </div>
            )}
            {phase === "done" && (
              <div className="absolute left-1/2 top-[52px] z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500 px-5 py-2 text-lg font-extrabold text-white shadow-lg" style={{ animation: "pa-pop 420ms ease-out both" }}>
                ✓ მზადაა
              </div>
            )}
          </div>
        )}
      </div>

      {phase !== "done" && (
        <button
          type="button"
          onClick={() => (onSkip ?? onDone)()}
          className="mt-6 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/20 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          გამოტოვება
        </button>
      )}
    </div>
  );
}
