import { useEffect, useRef, useState } from "react";

// "ბეჭდვა" — the order's print played as a short film (David 2026-11-10):
// the chosen print comes out of a DTF printer on film, gets its powder and
// heat, then the chosen garment lies on the heat press, the film goes on,
// the press closes (3-2-1, steam), opens, the film is peeled off — the print
// stays on the garment. ~8 s, can be skipped; with reduced motion only the
// finished garment is shown for a moment.
//
// Pure presentation: it gets three pictures and calls onDone. It knows
// nothing about products, prices or orders.

export interface PrintAnimationProps {
  /** The print alone (transparent), cropped to itself — what the printer prints. */
  designSrc: string;
  /** The garment without the print, and with it (same frame, transparent background). */
  garmentBlankSrc: string;
  garmentPrintedSrc: string;
  /** The print alone in the garment's frame (lies over the blank garment as the film's picture). */
  printLayerSrc: string;
  onDone: () => void;
  onSkip?: () => void;
}

type Phase = "print" | "cure" | "lay" | "press" | "open" | "peel" | "done";
const ORDER: [Phase, number][] = [
  ["print", 2600],
  ["cure", 1500],
  ["lay", 800],
  ["press", 2100],
  ["open", 600],
  ["peel", 1000],
  ["done", 1300],
];
const CAPTION: Record<Phase, string> = {
  print: "პრინტი იბეჭდება ფირზე…",
  cure: "ფხვნილი და გაშრობა…",
  lay: "ფირი მაისურზე…",
  press: "თერმოპრესი…",
  open: "თერმოპრესი…",
  peel: "ფირი ძვრება…",
  done: "მზადაა!",
};

export default function PrintAnimation({ designSrc, garmentBlankSrc, garmentPrintedSrc, printLayerSrc, onDone, onSkip }: PrintAnimationProps) {
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
  const afterPress = phase === "open" || phase === "peel" || phase === "done";

  return (
    <div role="dialog" aria-modal="true" aria-label="ბეჭდვა" className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_30%,#2b2620_0%,#0c0c0c_75%)] text-white">
      <style>{`
        @keyframes pa-feed { from { transform: translateY(-100%) } to { transform: translateY(0) } }
        @keyframes pa-head { from { left: 6% } to { left: 82% } }
        @keyframes pa-led { 50% { opacity: .25 } }
        @keyframes pa-powder { from { transform: translateY(-30px); opacity: 0 } 15% { opacity: 1 } to { transform: translateY(250px); opacity: 0 } }
        @keyframes pa-heat { 0%, 100% { opacity: 0 } 50% { opacity: .55 } }
        @keyframes pa-drop { from { transform: translateY(-46%) scale(1.06); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes pa-steam { from { transform: translate(0, 0) scale(.6); opacity: 0 } 30% { opacity: .5 } to { transform: translate(var(--dx), -90px) scale(1.7); opacity: 0 } }
        @keyframes pa-peel { to { transform: translate(-58%, -64%) rotate(-24deg); opacity: 0 } }
        @keyframes pa-pop { from { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } to { transform: scale(1) } }
        @keyframes pa-shine { from { transform: translateX(-140%) skewX(-18deg) } to { transform: translateX(260%) skewX(-18deg) } }
        @keyframes pa-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
      `}</style>

      <p key={CAPTION[phase]} aria-live="polite" className="mb-4 h-7 text-base font-bold tracking-wide" style={{ animation: "pa-in 260ms ease-out both" }}>
        {CAPTION[phase]}
      </p>

      <div className="relative h-[430px] w-[320px] max-w-[92vw]">
        {/* ── scene 1–2: the DTF printer ─────────────────────────────────── */}
        {printer && (
          <div className="absolute inset-0" style={{ animation: "pa-in 300ms ease-out both" }}>
            <div className="absolute left-1/2 top-0 z-10 h-[112px] w-[290px] -translate-x-1/2 rounded-2xl bg-gradient-to-b from-zinc-600 to-zinc-800 shadow-[0_16px_40px_-12px_rgba(0,0,0,.9)] ring-1 ring-white/10">
              <div className="absolute left-4 top-3 text-[11px] font-bold tracking-[0.2em] text-white/80">maika.ge · DTF</div>
              <div className="absolute right-4 top-3 flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" style={{ animation: "pa-led 700ms infinite" }} />
                <span className="h-2 w-2 rounded-full bg-amber-400" />
              </div>
              {/* the carriage rail and the head */}
              <div className="absolute inset-x-5 bottom-5 h-6 rounded bg-black/55">
                {phase === "print" && <span className="absolute top-0.5 h-5 w-[12%] rounded-sm bg-zinc-300 shadow-[0_0_12px_2px_rgba(96,165,250,.8)]" style={{ animation: "pa-head 330ms ease-in-out infinite alternate" }} />}
              </div>
              <div className="absolute inset-x-8 bottom-0 h-1.5 rounded-t bg-black" />
            </div>
            {/* the film coming out of the slot */}
            <div className="absolute left-1/2 top-[108px] h-[260px] w-[226px] -translate-x-1/2 overflow-hidden">
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

        {/* ── scene 3–4: the heat press ──────────────────────────────────── */}
        {!printer && (
          <div className="absolute inset-0" style={{ animation: "pa-in 300ms ease-out both" }}>
            {/* lower platen */}
            <div className="absolute inset-x-0 bottom-0 top-[44px] rounded-[28px] bg-gradient-to-b from-zinc-700 to-zinc-900 shadow-[0_20px_50px_-14px_rgba(0,0,0,.95)] ring-1 ring-white/10" />
            {/* the silicone mat: light, so a dark garment reads on it */}
            <div className="absolute inset-x-3 bottom-3 top-[56px] rounded-[22px] bg-gradient-to-b from-zinc-300 to-zinc-400 ring-1 ring-black/40" />
            {/* the garment */}
            <div className="absolute inset-x-6 bottom-5 top-[66px]">
              <img src={afterPress ? garmentPrintedSrc : garmentBlankSrc} alt="" className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,.5)]" />
              {/* the film with the print, laid on; peeled off at the end */}
              {phase !== "done" && (
                <div
                  className="absolute inset-0"
                  style={{
                    animation: phase === "lay" ? "pa-drop 620ms cubic-bezier(.2,.8,.2,1) both" : phase === "peel" ? "pa-peel 900ms cubic-bezier(.5,0,.8,.4) both" : undefined,
                    transformOrigin: "100% 100%",
                  }}
                >
                  {!afterPress && <img src={printLayerSrc} alt="" className="absolute inset-0 h-full w-full object-contain" />}
                  <span className="absolute left-[16%] right-[16%] top-[10%] h-[62%] rounded-md border border-white/30 bg-white/[0.10]" />
                </div>
              )}
              {phase === "done" && (
                <span className="pointer-events-none absolute inset-0 overflow-hidden">
                  <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent" style={{ animation: "pa-shine 900ms ease-out both" }} />
                </span>
              )}
            </div>
            {/* upper platen */}
            <div
              className="absolute inset-x-1 top-0 z-10 h-[86%] rounded-[26px] bg-gradient-to-b from-zinc-500 to-zinc-700 shadow-[0_24px_40px_-10px_rgba(0,0,0,.9)] ring-1 ring-white/15"
              style={{ transform: pressed ? "translateY(12%)" : "translateY(-112%)", transition: `transform ${pressed ? 420 : 380}ms cubic-bezier(.4,0,.2,1)` }}
            >
              <div className="absolute left-1/2 top-4 h-3 w-24 -translate-x-1/2 rounded-full bg-black/45" />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span key={count} className="text-7xl font-black tabular-nums text-amber-400 drop-shadow-[0_0_18px_rgba(251,191,36,.6)]" style={{ animation: "pa-pop 320ms ease-out both" }}>
                  {count}
                </span>
                <span className="mt-1 text-xs font-semibold tracking-widest text-white/70">160°C</span>
              </div>
            </div>
            {/* steam */}
            {(pressed || phase === "open") &&
              [-1, 1, -1, 1].map((s, i) => (
                <span
                  key={i}
                  className="absolute bottom-[18%] z-20 h-14 w-14 rounded-full bg-white/60 blur-xl"
                  style={{ left: s < 0 ? "-4%" : "86%", ["--dx" as string]: `${s * (26 + i * 9)}px`, animation: `pa-steam 1100ms ease-out ${i * 260}ms infinite` }}
                />
              ))}
            {phase === "done" && (
              <div className="absolute -top-2 left-1/2 z-30 -translate-x-1/2 rounded-full bg-emerald-500 px-5 py-2 text-lg font-extrabold text-white shadow-lg" style={{ animation: "pa-pop 420ms ease-out both" }}>
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
