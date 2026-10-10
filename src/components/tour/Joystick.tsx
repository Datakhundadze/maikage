import { useRef } from "react";
import type { StickInput } from "@/lib/tour/walkMotion";

// On-screen thumb pad for walking (phones). Bottom-LEFT, clear of the chat
// launcher in the bottom-right corner. Reports a stick vector (forward /
// strafe, each −1…1) through `onChange` on every move — no React re-render;
// the knob is moved by writing its transform directly.
//
// It owns its pointer (setPointerCapture), so a second finger can drag the
// canvas to look around at the same time.

const BASE_PX = 128; // ≥ 96 px tap target
const KNOB_PX = 56;
const RADIUS = (BASE_PX - KNOB_PX) / 2;
const DEADZONE = 0.12;

interface JoystickProps {
  onChange: (input: StickInput) => void;
}

export default function Joystick({ onChange }: JoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);

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
    const sx = dx / RADIUS;
    const sy = dy / RADIUS;
    const mag = Math.hypot(sx, sy);
    // dead zone, then rescale so the response starts at 0 just outside it
    const k = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE) / mag;
    onChange({ forward: -sy * k, strafe: sx * k });
  };

  const release = () => {
    pointerId.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    onChange({ forward: 0, strafe: 0 });
  };

  return (
    <div
      ref={baseRef}
      role="application"
      aria-label="სიარულის ჯოისტიკი"
      className="absolute bottom-4 left-4 z-20 flex touch-none select-none items-center justify-center rounded-full border border-white/40 bg-black/25 backdrop-blur-[2px]"
      style={{ width: BASE_PX, height: BASE_PX }}
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
