import { useEffect, useRef } from "react";
import type { StickAxes } from "@/lib/tour/tourMath";

// On-screen thumb pad for turning and stepping through the tour. Bottom-LEFT,
// clear of the chat launcher in the bottom-right corner. Reports the raw knob
// position (x right, y up, inside the unit circle) through `onChange` on every
// move — no React re-render; the knob is moved by writing its transform
// directly. What the axes do (dead zone, turning, steps) is in tourMath.ts.
//
// It owns its pointer (setPointerCapture), so a second finger can drag the
// canvas to look around at the same time.

const BASE_PX = 128; // ≥ 96 px tap target
const KNOB_PX = 56;
const RADIUS = (BASE_PX - KNOB_PX) / 2;

interface JoystickProps {
  onChange: (axes: StickAxes) => void;
}

export default function Joystick({ onChange }: JoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);

  // iPhone: holding the pad must not start a text selection / callout, which
  // takes the touch away mid-walk. Pointer events still fire.
  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    base.addEventListener("touchstart", stop, { passive: false });
    return () => base.removeEventListener("touchstart", stop);
  }, []);

  const update = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    onChange({ x: dx / RADIUS, y: -dy / RADIUS });
  };

  const release = () => {
    pointerId.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    onChange({ x: 0, y: 0 });
  };

  return (
    <div
      ref={baseRef}
      role="application"
      aria-label="ჯოისტიკი: მარცხნივ-მარჯვნივ — მობრუნება, წინ-უკან — გადასვლა"
      className="absolute bottom-4 left-4 z-20 flex touch-none select-none items-center justify-center rounded-full border border-white/40 bg-black/25 backdrop-blur-[2px]"
      style={{ width: BASE_PX, height: BASE_PX, WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
      onPointerDown={(e) => {
        if (pointerId.current !== null) return;
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointerId.current) update(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerId === pointerId.current) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === pointerId.current) release();
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === pointerId.current) release();
      }}
    >
      <div
        ref={knobRef}
        className="pointer-events-none rounded-full border border-white/70 bg-white/45 shadow-md"
        style={{ width: KNOB_PX, height: KNOB_PX, transform: "translate(0px, 0px)" }}
      />
    </div>
  );
}
