import { useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { StickAxes } from "@/lib/tour/tourMath";

// Arrow buttons for the /showroom walk — the alternative to the joystick on
// phones (the visitor picks one; VideoWalk remembers it). Hold ↑ to walk,
// ↓ to step back, ← → to turn; several at once work. Reports the same axes
// as the joystick and the keyboard (full deflection), bottom-LEFT like the
// joystick, clear of the chat launcher.

const BTN = 52;

type Dir = "up" | "down" | "left" | "right";

interface DPadProps {
  onChange: (axes: StickAxes) => void;
}

export default function DPad({ onChange }: DPadProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const held = useRef(new Map<number, Dir>()); // pointerId → button

  const report = () => {
    const dirs = new Set(held.current.values());
    onChange({
      x: (dirs.has("right") ? 1 : 0) - (dirs.has("left") ? 1 : 0),
      y: (dirs.has("up") ? 1 : 0) - (dirs.has("down") ? 1 : 0),
    });
  };

  // iPhone: holding a button must not start a text selection / callout
  useEffect(() => {
    const el = rootRef.current;
    const map = held.current;
    if (!el) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchstart", stop, { passive: false });
    return () => {
      el.removeEventListener("touchstart", stop);
      map.clear();
      onChange({ x: 0, y: 0 });
    };
    // onChange is stable for the pad's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const button = (dir: Dir, label: string, Icon: typeof ChevronUp, style: React.CSSProperties) => (
    <button
      type="button"
      aria-label={label}
      className="absolute flex touch-none select-none items-center justify-center rounded-xl border border-white/40 bg-black/35 text-white backdrop-blur-[2px] active:bg-white/40"
      style={{ width: BTN, height: BTN, ...style }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        held.current.set(e.pointerId, dir);
        report();
      }}
      onPointerUp={(e) => {
        held.current.delete(e.pointerId);
        report();
      }}
      onPointerCancel={(e) => {
        held.current.delete(e.pointerId);
        report();
      }}
      onLostPointerCapture={(e) => {
        if (held.current.delete(e.pointerId)) report();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon className="h-7 w-7" aria-hidden />
    </button>
  );

  const size = BTN * 3 + 8;
  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="ისრები: ↑ სიარული, ↓ უკან, ← → მობრუნება"
      className="absolute bottom-4 left-4 z-20 select-none"
      style={{ width: size, height: size, WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
    >
      {button("up", "წინ", ChevronUp, { left: BTN + 4, top: 0 })}
      {button("left", "მარცხნივ", ChevronLeft, { left: 0, top: BTN + 4 })}
      {button("right", "მარჯვნივ", ChevronRight, { left: 2 * BTN + 8, top: BTN + 4 })}
      {button("down", "უკან", ChevronDown, { left: BTN + 4, top: 2 * BTN + 8 })}
    </div>
  );
}
